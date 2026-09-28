import { useEffect, useState } from 'react';
import {
  type FocusRecordDTO,
  type RehearsalAttr,
  type RehearsalEntryDTO,
  type RehearsalStateDTO,
  type RuntimeMessage,
  validateTabindexValue,
} from '../shared/messages.js';

type Draft = {
  mode: 'add' | 'edit';
  id?: string;
  seq?: number;
  attr: RehearsalAttr;
  action: 'set' | 'remove';
  value: string;
};

const ATTR_LABEL: Record<RehearsalAttr, string> = {
  'aria-label': 'aria-label',
  tabindex: 'tabindex',
};

function originalText(original: string | null): string {
  if (original === null) return '建项时：属性不存在';
  if (original === '') return '建项时：空字符串';
  return `建项时原值："${original}"`;
}

interface Props {
  rehearsal: RehearsalStateDTO;
  records: FocusRecordDTO[];
  busy: boolean;
  onCommand: (message: RuntimeMessage) => Promise<void>;
  draftSignal: { seq: number; attr: RehearsalAttr; nonce: number } | null;
}

export function RehearsalPanel({ rehearsal, records, busy, onCommand, draftSignal }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');

  const applied = rehearsal.phase === 'applied';

  useEffect(() => {
    if (!draftSignal || applied) return;
    setFormError('');
    setDraft({
      mode: 'add',
      seq: draftSignal.seq,
      attr: draftSignal.attr,
      action: 'set',
      value: draftSignal.attr === 'tabindex' ? '0' : '',
    });
  }, [draftSignal, applied]);

  const startAdd = (seq: number, attr: RehearsalAttr) => {
    setFormError('');
    setDraft({ mode: 'add', seq, attr, action: 'set', value: '' });
  };

  const startEdit = (entry: RehearsalEntryDTO) => {
    setFormError('');
    setDraft({
      mode: 'edit',
      id: entry.id,
      attr: entry.attr,
      action: entry.action,
      value: entry.action === 'set' ? (entry.value ?? '') : '',
    });
  };

  const submit = async () => {
    if (!draft) return;
    if (draft.action === 'set' && draft.attr === 'tabindex') {
      const error = validateTabindexValue(draft.value);
      if (error) {
        setFormError(error);
        return;
      }
    }
    const value = draft.action === 'set' ? draft.value : undefined;
    try {
      if (draft.mode === 'add' && draft.seq !== undefined) {
        await onCommand({ type: 'REHEARSAL_ADD', seq: draft.seq, attr: draft.attr, action: draft.action, value });
      } else if (draft.mode === 'edit' && draft.id) {
        await onCommand({ type: 'REHEARSAL_UPDATE', id: draft.id, action: draft.action, value });
      }
      setDraft(null);
      setFormError('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const result = rehearsal.lastResult;
  const recordName = (seq: number) =>
    records.find((record) => record.seq === seq)?.name ?? '';

  return (
    <section className="rehearsal">
      <h2>无障碍修复预演</h2>
      <p className="hint">
        从巡检记录选择节点建立方案，整批预检通过后才写入；不修改网站源码，可随时撤销。
        {applied ? ' 当前预演已生效，撤销前不能叠加应用或改方案。' : ' 当前为待应用方案。'}
      </p>

      <div className="rehearsal-actions">
        <button
          type="button"
          disabled={busy || applied || rehearsal.entries.length === 0}
          onClick={() => void onCommand({ type: 'REHEARSAL_APPLY' })}
        >
          应用预演
        </button>
        <button
          type="button"
          disabled={busy || !applied}
          onClick={() => void onCommand({ type: 'REHEARSAL_UNDO' })}
        >
          撤销预演
        </button>
        <span className={`phase phase-${rehearsal.phase}`}>
          {applied ? '● 已生效' : '○ 待应用'}
        </span>
      </div>

      {result?.phase === 'failed' && (
        <div className="result result-failed" role="alert">
          <strong>应用被阻止：</strong>发现 {result.conflicts.length} 项冲突，整批未写入任何属性。
          <ul>
            {result.conflicts.map((conflict) => (
              <li key={conflict.entryId}>
                #{conflict.seq} · {ATTR_LABEL[conflict.attr]}：{conflict.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result?.phase === 'applied' && (
        <div className="result result-applied">预演已生效，可继续用 Tab 巡检验证效果。</div>
      )}
      {result?.phase === 'reverted' && (
        <div className="result result-reverted" role="status">
          <strong>已撤销预演：</strong>
          <ul>
            {result.undoItems.map((item) => (
              <li key={item.entryId} className={`undo undo-${item.outcome}`}>
                #{item.seq} · {ATTR_LABEL[item.attr]}：{item.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft && (
        <div className="draft" role="group" aria-label="编辑预演条目">
          <div className="draft-row">
            <strong>
              {draft.mode === 'add' ? `为 #${draft.seq} 添加` : '编辑'} {ATTR_LABEL[draft.attr]}
            </strong>
          </div>
          <label className="draft-row">
            <input
              type="radio"
              name="draft-action"
              checked={draft.action === 'set'}
              onChange={() => setDraft({ ...draft, action: 'set' })}
            />
            设置为
          </label>
          {draft.action === 'set' && (
            <input
              className="draft-value"
              type="text"
              value={draft.value}
              placeholder={draft.attr === 'tabindex' ? '整数，如 0 / -1' : '可访问名称，允许空字符串'}
              onChange={(event) => {
                setDraft({ ...draft, value: event.target.value });
                setFormError('');
              }}
            />
          )}
          <label className="draft-row">
            <input
              type="radio"
              name="draft-action"
              checked={draft.action === 'remove'}
              onChange={() => {
                setDraft({ ...draft, action: 'remove' });
                setFormError('');
              }}
            />
            移除该属性
          </label>
          {formError && <p className="error">{formError}</p>}
          <div className="draft-actions">
            <button type="button" onClick={() => void submit()}>
              保存条目
            </button>
            <button type="button" onClick={() => { setDraft(null); setFormError(''); }}>
              取消
            </button>
          </div>
        </div>
      )}

      {rehearsal.entries.length === 0 ? (
        <p className="hint">尚无条目。点击下方巡检记录中的「加 aria-label」「加 tabindex」建项。</p>
      ) : (
        <ul className="entries">
          {rehearsal.entries.map((entry) => {
            const liveName = recordName(entry.seq);
            return (
              <li key={entry.id} className={`entry ${entry.nodeConnected ? '' : 'entry-gone'}`}>
                <div className="entry-head">
                  <span className="entry-title">
                    #{entry.seq} {entry.tag} · {ATTR_LABEL[entry.attr]}
                  </span>
                  {!entry.nodeConnected && <span className="removed">节点已移除</span>}
                </div>
                <div className="entry-detail">
                  {(liveName || entry.name) && <span>「{liveName || entry.name}」</span>}
                  {' '}
                  {entry.action === 'set'
                    ? entry.value === ''
                      ? '设置为空字符串'
                      : `设置为 "${entry.value}"`
                    : '移除属性'}
                </div>
                <div className="entry-detail muted">{originalText(entry.original)}</div>
                <div className="entry-actions">
                  <button type="button" disabled={applied} onClick={() => startEdit(entry)}>
                    编辑
                  </button>
                  <button
                    type="button"
                    disabled={applied}
                    onClick={() => void onCommand({ type: 'REHEARSAL_REMOVE', id: entry.id })}
                  >
                    删除条目
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
