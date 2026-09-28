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

export type PreviewAttribute = 'aria-label' | 'tabindex';

export type PreviewEntryStatus = 'draft' | 'active';

export interface PreviewEntryDTO {
  id: string;
  seq: number;
  tag: string;
  recordName: string;
  attribute: PreviewAttribute;
  action: 'set' | 'remove';
  value: string | null;
  originalValue: string | null;
  status: PreviewEntryStatus;
  createdAt: string;
}

export interface PreviewResultItem {
  entryId: string;
  seq: number;
  attribute: PreviewAttribute;
  status: 'applied' | 'restored' | 'conflict' | 'removed';
  reason: string;
}

export interface PreviewOperationResult {
  kind: 'apply' | 'undo';
  status: 'applied' | 'restored' | 'conflict';
  message: string;
  items: PreviewResultItem[];
}

export interface PreviewState {
  phase: 'draft' | 'active';
  entries: PreviewEntryDTO[];
  lastResult: PreviewOperationResult | null;
}

export interface InspectionState {
  status: InspectionStatus;
  records: FocusRecordDTO[];
  preview: PreviewState;
}

export type PreviewEntryInput = Omit<
  PreviewEntryDTO,
  'id' | 'tag' | 'recordName' | 'originalValue' | 'status' | 'createdAt'
> & { id?: string };

export type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'GET_STATE' }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'CLEAR' }
  | { type: 'LOCATE'; seq: number }
  | { type: 'PREVIEW_ADD'; entry: PreviewEntryInput }
  | { type: 'PREVIEW_UPDATE'; id: string; entry: PreviewEntryInput }
  | { type: 'PREVIEW_DELETE'; id: string }
  | { type: 'PREVIEW_APPLY' }
  | { type: 'PREVIEW_UNDO' };

export type RuntimeResponse = InspectionState & {
  ok?: boolean;
  located?: boolean;
  error?: string;
};

export const SCOPE_NOTE =
  '仅检查顶层普通文档中的 DOM；iframe 内部与 Shadow DOM 内部未检查。';
