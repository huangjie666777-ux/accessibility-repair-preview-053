import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FocusRecordDTO,
  InspectionState,
  PreviewAttribute,
  PreviewEntryDTO,
} from '../shared/messages.js';
import { SCOPE_NOTE } from '../shared/messages.js';
import { emptyState, getActiveTab, getTabKind, sendCommand } from './api.js';

const SOURCE_LABEL: Record<FocusRecordDTO['source'], string> = {
  tab: 'Tab',
  shiftTab: 'Shift+Tab',
  mouse: '鼠标',
  other: '其他',
};

const ISSUE_LABEL: Record<string, string> = {
  positiveTabindex: '正 tabindex',
  ariaHiddenAncestor: '进入 aria-hidden 区域',
  namelessControl: '按钮/链接无名称',
  shadowTree: 'Shadow DOM 未检查',
};

const ATTRIBUTE_LABEL: Record<PreviewAttribute, string> = {
  'aria-label': 'aria-label',
  tabindex: 'tabindex',
};

interface PreviewForm {
  seq: number;
  attribute: PreviewAttribute;
  action: 'set' | 'remove';
  value: string;
}

function formatStoredValue(value: string | null): string {
  if (value === null) return '不存在';
  if (value === '') return '空字符串';
  return `"${value}"`;
}

export function App() {
  const [tabKind, setTabKind] = useState<'inspectable' | 'restricted' | 'unknown'>('unknown');
  const [state, setState] = useState<InspectionState>(emptyState);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PreviewForm | null>(null);

  const refresh = useCallback(async () => {
    const tab = await getActiveTab();
    const kind = getTabKind(tab);
    setTabKind(kind);
    if (kind !== 'inspectable') {
      setState(emptyState);
      setError('');
      return;
    }
    try {
      const next = await sendCommand(tab, { type: 'GET_STATE' });
      setState(next);
      setError(next.error ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const command = async (message: Parameters<typeof sendCommand>[1]) => {
    try {
      const tab = await getActiveTab();
      const next = await sendCommand(tab, message);
      setState(next);
      setError(next.error ?? '');
      return next.error === undefined;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const startEntry = (record: FocusRecordDTO, entry?: PreviewEntryDTO) => {
    if (state.preview.phase === 'active') return;
    setEditingId(entry?.id ?? null);
    setForm({
      seq: record.seq,
      attribute: entry?.attribute ?? 'aria-label',
      action: entry?.action ?? 'set',
      value: entry && entry.action === 'set' ? entry.value ?? '' : '',
    });
    setError('');
  };

  const editEntry = (entry: PreviewEntryDTO) => {
    const record = state.records.find((item) => item.seq === entry.seq);
    if (record) startEntry(record, entry);
  };

  const submitEntry = async () => {
    if (!form) return;
    if (form.action === 'set' && form.attribute === 'tabindex' && !/^(?:0|-?[1-9]\d*)$/.test(form.value.trim())) {
      setError('tabindex 必须是整数，例如 0、-1 或 3；不接受小数、字母或空值。');
      return;
    }
    const entry = {
      seq: form.seq,
      attribute: form.attribute,
      action: form.action,
      value: form.action === 'remove' ? null : form.value,
    };
    const ok = editingId
      ? await command({ type: 'PREVIEW_UPDATE', id: editingId, entry })
      : await command({ type: 'PREVIEW_ADD', entry });
    if (ok) {
      setForm(null);
      setEditingId(null);
    }
  };

  const locate = async (seq: number) => command({ type: 'LOCATE', seq });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ records: state.records, preview: state.preview }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `focus-inspection-${new Date().toISOString()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const visibleRecords = useMemo(
    () => (issuesOnly ? state.records.filter((record) => record.issues.length > 0) : state.records),
    [issuesOnly, state.records],
  );
  const previewActive = state.preview.phase === 'active';
  const result = state.preview.lastResult;

  return (
    <main className="app">
      <h1>键盘焦点巡检</h1>

      {tabKind === 'restricted' && (
        <p className="error" role="alert">
          当前为受限页面（如 chrome://、扩展商店、file:// 等）。扩展仅能在 http/https
          标签页中注入并巡检。
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <section className="controls">
        <button type="button" disabled={state.status === 'running' || tabKind !== 'inspectable'}
          onClick={() => void command(state.status === 'paused' ? { type: 'RESUME' } : { type: 'START' })}>
          {state.status === 'paused' ? '继续' : '开始巡检'}
        </button>
        <button type="button" disabled={state.status !== 'running'} onClick={() => void command({ type: 'PAUSE' })}>暂停</button>
        <button type="button" disabled={state.status === 'idle' || state.records.length === 0 || previewActive} onClick={() => void command({ type: 'CLEAR' })}>清空</button>
        <button type="button" disabled={state.records.length === 0} onClick={exportJson}>导出 JSON</button>
      </section>

      <p className="status">
        状态：<strong>{state.status === 'running' ? '巡检中' : state.status === 'paused' ? '已暂停' : '未开始'}</strong>
        ｜共 {state.records.length} 条，问题 {state.records.filter((r) => r.issues.length).length} 条
      </p>

      <label className="filter">
        <input type="checkbox" checked={issuesOnly} onChange={(event) => setIssuesOnly(event.target.checked)} />
        只看问题项
      </label>

      <ol className="records">
        {visibleRecords.map((record) => (
          <li key={record.seq} className="record-row">
            <div className="record">
              <div className="record-main">
                <span className="seq">#{record.seq}</span>
                <span className="meta">{new Date(record.time).toLocaleTimeString()} · {SOURCE_LABEL[record.source]} · {record.tag}</span>
                <span className="name">{record.name || '（无名称）'}</span>
                <span className="name-source">名称依据：{record.nameSource}</span>
                {record.issues.length > 0 && (
                  <span className="issues">{record.issues.map((issue) => <span className="issue" key={issue.code} title={issue.basis}>{ISSUE_LABEL[issue.code] ?? issue.code}</span>)}</span>
                )}
                {record.removed && <span className="removed">原元素已移除</span>}
              </div>
              <div className="record-actions">
                <button type="button" onClick={() => void locate(record.seq)}>定位</button>
                <button type="button" disabled={record.removed || previewActive} onClick={() => startEntry(record)}>建修复</button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="preview-panel">
        <h2>无障碍修复预演</h2>
        <p className={`preview-phase ${previewActive ? 'phase-active' : 'phase-draft'}`}>
          {previewActive ? '已生效：可继续 Tab 巡检；撤销前不能叠加应用或编辑方案。' : '待应用：从任意仍连接的记录建立临时属性修复。'}
        </p>

        {form && (
          <div className="preview-form">
            <label>目标记录
              <select value={form.seq} disabled={previewActive} onChange={(e) => setForm({ ...form, seq: Number(e.target.value) })}>
                {state.records.filter((r) => !r.removed).map((r) => <option key={r.seq} value={r.seq}>#{r.seq} {r.name || '（无名称）'}</option>)}
              </select>
            </label>
            <label>属性
              <select value={form.attribute} disabled={previewActive} onChange={(e) => setForm({ ...form, attribute: e.target.value as PreviewAttribute })}>
                <option value="aria-label">aria-label</option>
                <option value="tabindex">tabindex</option>
              </select>
            </label>
            <label>操作
              <select value={form.action} disabled={previewActive} onChange={(e) => setForm({ ...form, action: e.target.value as 'set' | 'remove' })}>
                <option value="set">设置值</option>
                <option value="remove">移除属性</option>
              </select>
            </label>
            {form.action === 'set' && (
              <label>新值
                <input value={form.value} disabled={previewActive} placeholder={form.attribute === 'aria-label' ? '可输入空字符串' : '整数，如 0'}
                  onChange={(e) => setForm({ ...form, value: e.target.value })} />
              </label>
            )}
            <div className="form-actions">
              <button type="button" onClick={() => void submitEntry()}>{editingId ? '保存修改' : '加入方案'}</button>
              <button type="button" onClick={() => { setForm(null); setEditingId(null); }}>取消</button>
            </div>
          </div>
        )}

        <ul className="preview-entries">
          {state.preview.entries.map((entry) => (
            <li key={entry.id} className={`entry status-${entry.status}`}>
              <div>
                <strong>#{entry.seq} {entry.recordName || `（${entry.tag} 无名称）`}</strong>
                <span>{ATTRIBUTE_LABEL[entry.attribute]}：{entry.action === 'remove' ? '移除' : `设置为 ${formatStoredValue(entry.value)}`}</span>
                <span>原值：{formatStoredValue(entry.originalValue)}</span>
                <span>{entry.status === 'active' ? '已生效' : '待应用'}</span>
              </div>
              {!previewActive && <div><button type="button" onClick={() => editEntry(entry)}>编辑</button><button type="button" className="danger" onClick={() => void command({ type: 'PREVIEW_DELETE', id: entry.id })}>删除</button></div>}
            </li>
          ))}
        </ul>

        <div className="controls">
          <button type="button" disabled={previewActive || state.preview.entries.length === 0} onClick={() => void command({ type: 'PREVIEW_APPLY' })}>整批预检并应用</button>
          <button type="button" disabled={!previewActive} onClick={() => void command({ type: 'PREVIEW_UNDO' })}>撤销预演</button>
        </div>

        {result && (
          <div className={`result result-${result.status}`}>
            <strong>{result.message}</strong>
            <ul>{result.items.map((item) => <li key={`${item.entryId}-${item.attribute}`} className={`item item-${item.status}`}>#{item.seq} {ATTRIBUTE_LABEL[item.attribute]}：{item.reason}</li>)}</ul>
          </div>
        )}
      </section>

      <p className="scope">{SCOPE_NOTE}预演仅在当前标签页和当前文档生命周期内保存；整页导航后旧方案失效，不自动改新页面。</p>
    </main>
  );
}
