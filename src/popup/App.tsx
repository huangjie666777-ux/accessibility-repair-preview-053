import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FocusRecordDTO, InspectionState } from '../shared/messages.js';
import { SCOPE_NOTE } from '../shared/messages.js';
import { emptyState, getActiveTab, getTabKind, sendCommand } from './api.js';
import { RehearsalPanel } from './RehearsalPanel.js';

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

export function App() {
  const [tabKind, setTabKind] = useState<'inspectable' | 'restricted' | 'unknown'>('unknown');
  const [state, setState] = useState<InspectionState>(emptyState);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [error, setError] = useState('');
  const [draftSignal, setDraftSignal] = useState<{
    seq: number;
    attr: 'aria-label' | 'tabindex';
    nonce: number;
  } | null>(null);

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
      setState({ status: next.status, records: next.records, rehearsal: next.rehearsal });
      setError('');
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
      if (next.error) {
        setError(next.error);
      } else {
        setState({ status: next.status, records: next.records, rehearsal: next.rehearsal });
        setError('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const locate = async (seq: number) => {
    await command({ type: 'LOCATE', seq });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state.records, null, 2)], {
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

  return (
    <main className="app">
      <h1>键盘焦点巡检</h1>

      {tabKind === 'restricted' && (
        <p className="error" role="alert">
          当前为受限页面（如 chrome://、扩展商店、file:// 等）。扩展仅能在 http/https
          标签页中注入并巡检。
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <section className="controls">
        <button
          type="button"
          disabled={state.status === 'running' || tabKind !== 'inspectable'}
          onClick={() => void command(state.status === 'paused' ? { type: 'RESUME' } : { type: 'START' })}
        >
          {state.status === 'paused' ? '继续' : '开始巡检'}
        </button>
        <button
          type="button"
          disabled={state.status !== 'running'}
          onClick={() => void command({ type: 'PAUSE' })}
        >
          暂停
        </button>
        <button
          type="button"
          disabled={state.status === 'idle' || state.records.length === 0}
          onClick={() => void command({ type: 'CLEAR' })}
        >
          清空
        </button>
        <button type="button" disabled={state.records.length === 0} onClick={exportJson}>
          导出 JSON
        </button>
      </section>

      <p className="status">
        状态：
        <strong>
          {state.status === 'running' ? '巡检中' : state.status === 'paused' ? '已暂停' : '未开始'}
        </strong>
        ｜共 {state.records.length} 条，问题 {state.records.filter((r) => r.issues.length).length} 条
      </p>

      <label className="filter">
        <input
          type="checkbox"
          checked={issuesOnly}
          onChange={(event) => setIssuesOnly(event.target.checked)}
        />
        只看问题项
      </label>

      <ol className="records">
        {visibleRecords.map((record) => (
          <li key={record.seq}>
            <div
              className="record"
              role="button"
              tabIndex={0}
              onClick={() => void locate(record.seq)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void locate(record.seq);
                }
              }}
            >
              <span className="seq">#{record.seq}</span>
              <span className="meta">
                {new Date(record.time).toLocaleTimeString()} · {SOURCE_LABEL[record.source]} ·{' '}
                {record.tag}
              </span>
              <span className="name">{record.name || '（无名称）'}</span>
              <span className="name-source">名称依据：{record.nameSource}</span>
              {record.issues.length > 0 && (
                <span className="issues">
                  {record.issues.map((issue) => (
                    <span className="issue" key={issue.code} title={issue.basis}>
                      {ISSUE_LABEL[issue.code] ?? issue.code}
                    </span>
                  ))}
                </span>
              )}
              {record.removed && <span className="removed">原元素已移除</span>}
            </div>
            <span className="record-actions">
              <button
                type="button"
                className="mini"
                disabled={record.removed || state.rehearsal.phase === 'applied'}
                onClick={() =>
                  setDraftSignal({ seq: record.seq, attr: 'aria-label', nonce: Date.now() })
                }
                title="为该节点建立 aria-label 预演条目"
              >
                加 aria-label
              </button>
              <button
                type="button"
                className="mini"
                disabled={record.removed || state.rehearsal.phase === 'applied'}
                onClick={() =>
                  setDraftSignal({ seq: record.seq, attr: 'tabindex', nonce: Date.now() })
                }
                title="为该节点建立 tabindex 预演条目"
              >
                加 tabindex
              </button>
            </span>
          </li>
        ))}
      </ol>

      <RehearsalPanel
        rehearsal={state.rehearsal}
        records={state.records}
        busy={tabKind !== 'inspectable'}
        onCommand={command}
        draftSignal={draftSignal}
      />

      <p className="scope">{SCOPE_NOTE}整页导航后自动停止并清空。</p>
    </main>
  );
}
