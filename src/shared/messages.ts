export type InspectionStatus = 'idle' | 'running' | 'paused';

export type FocusSource = 'tab' | 'shiftTab' | 'mouse' | 'other';

export type NameSource =
  | 'aria-labelledby'
  | 'aria-label'
  | 'label'
  | 'text'
  | 'none';

export type IssueCode =
  | 'positiveTabindex'
  | 'ariaHiddenAncestor'
  | 'namelessControl'
  | 'shadowTree';

export interface IssueDTO {
  code: IssueCode;
  basis: string;
}

export interface FocusRecordDTO {
  seq: number;
  time: string;
  tag: string;
  name: string;
  nameSource: NameSource;
  source: FocusSource;
  issues: IssueDTO[];
  removed: boolean;
}

export interface InspectionState {
  status: InspectionStatus;
  records: FocusRecordDTO[];
  rehearsal: RehearsalStateDTO;
}

export type RehearsalAttr = 'aria-label' | 'tabindex';

/** set = 写入指定值（空字符串是合法值）；remove = 移除属性。 */
export type RehearsalAction = 'set' | 'remove';

export type RehearsalPhase = 'editing' | 'applied';

export interface RehearsalEntryDTO {
  id: string;
  seq: number;
  tag: string;
  name: string;
  attr: RehearsalAttr;
  action: RehearsalAction;
  /** action 为 set 时的目标值（空字符串与 undefined 明确区分）。 */
  value?: string;
  /** 建项时该属性的原值；null 表示属性不存在，'' 表示空字符串。 */
  original: string | null;
  /** 目标节点当前是否仍连接（按 WeakRef 节点身份判定）。 */
  nodeConnected: boolean;
}

export interface RehearsalConflictDTO {
  entryId: string;
  seq: number;
  attr: RehearsalAttr;
  reason: string;
}

export type RehearsalItemOutcome =
  | 'restored'
  | 'removed-attr'
  | 'skipped-node-gone'
  | 'conflict-changed';

export interface RehearsalUndoItemDTO {
  entryId: string;
  seq: number;
  attr: RehearsalAttr;
  outcome: RehearsalItemOutcome;
  detail: string;
}

export interface RehearsalResultDTO {
  phase: 'applied' | 'failed' | 'reverted' | null;
  appliedAt: string | null;
  revertedAt: string | null;
  conflicts: RehearsalConflictDTO[];
  undoItems: RehearsalUndoItemDTO[];
}

export interface RehearsalStateDTO {
  phase: RehearsalPhase;
  entries: RehearsalEntryDTO[];
  lastResult: RehearsalResultDTO | null;
}

export const emptyRehearsal: RehearsalStateDTO = {
  phase: 'editing',
  entries: [],
  lastResult: null,
};

/** tabindex 仅接受整数（允许前导/尾随空格由调用方先 trim）。 */
export function validateTabindexValue(value: string): string | null {
  if (!/^-?\d+$/.test(value.trim())) {
    return 'tabindex 必须是整数，例如 0、-1 或 1；不接受小数、字母或空值。';
  }
  return null;
}

export type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'GET_STATE' }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'CLEAR' }
  | { type: 'LOCATE'; seq: number }
  | { type: 'REHEARSAL_ADD'; seq: number; attr: RehearsalAttr; action: RehearsalAction; value?: string }
  | { type: 'REHEARSAL_UPDATE'; id: string; action: RehearsalAction; value?: string }
  | { type: 'REHEARSAL_REMOVE'; id: string }
  | { type: 'REHEARSAL_APPLY' }
  | { type: 'REHEARSAL_UNDO' };

export type RuntimeResponse = InspectionState & {
  ok?: boolean;
  located?: boolean;
  error?: string;
};

export const SCOPE_NOTE =
  '仅检查顶层普通文档中的 DOM；iframe 内部与 Shadow DOM 内部未检查。';
