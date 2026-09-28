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
}

export type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'GET_STATE' }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'CLEAR' }
  | { type: 'LOCATE'; seq: number };

export type RuntimeResponse = InspectionState & { ok?: boolean; located?: boolean };

export const SCOPE_NOTE =
  '仅检查顶层普通文档中的 DOM；iframe 内部与 Shadow DOM 内部未检查。';
