import type {
  PreviewEntryDTO,
  PreviewEntryInput,
  PreviewOperationResult,
  PreviewState,
  PreviewAttribute,
} from '../shared/messages.js';

interface TrackedPreviewEntry {
  dto: PreviewEntryDTO;
  ref: WeakRef<HTMLElement>;
}

export interface PreviewResult {
  state: PreviewState;
  error?: string;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isIntegerAttributeValue(value: string): boolean {
  return /^(?:0|-?[1-9]\d*)$/.test(value.trim());
}

export function validatePreviewValue(attribute: PreviewAttribute, value: string): string | null {
  if (attribute === 'tabindex' && !isIntegerAttributeValue(value)) {
    return 'tabindex 必须是整数，例如 0、-1 或 3；不接受小数、字母或空值。';
  }
  return null;
}

export class AccessibilityPreview {
  private entries: TrackedPreviewEntry[] = [];
  private applied: TrackedPreviewEntry[] = [];
  private phase: 'draft' | 'active' = 'draft';
  private lastResult: PreviewOperationResult | null = null;

  constructor(
    private doc: Document,
    private resolveRecord: (seq: number) => { node: HTMLElement; tag: string; name: string } | null,
  ) {}

  getState(): PreviewState {
    return {
      phase: this.phase,
      entries: this.entries.map((entry) => ({ ...entry.dto })),
      lastResult: this.lastResult ? { ...this.lastResult } : null,
    };
  }

  addEntry(input: PreviewEntryInput): PreviewResult {
    if (this.phase === 'active') {
      return { state: this.getState(), error: '预演已生效，请先撤销后再调整方案。' };
    }
    const prepared = this.prepareEntry(input);
    if ('error' in prepared) return { state: this.getState(), error: prepared.error };
    this.entries.push(prepared.entry);
    this.lastResult = null;
    return { state: this.getState() };
  }

  updateEntry(id: string, input: PreviewEntryInput): PreviewResult {
    if (this.phase === 'active') {
      return { state: this.getState(), error: '预演已生效，请先撤销后再调整方案。' };
    }
    const index = this.entries.findIndex((entry) => entry.dto.id === id);
    if (index < 0) return { state: this.getState(), error: '要编辑的条目不存在。' };
    const prepared = this.prepareEntry(input, id);
    if ('error' in prepared) return { state: this.getState(), error: prepared.error };
    this.entries[index] = prepared.entry;
    this.lastResult = null;
    return { state: this.getState() };
  }

  deleteEntry(id: string): PreviewResult {
    if (this.phase === 'active') {
      return { state: this.getState(), error: '预演已生效，请先撤销后再删除条目。' };
    }
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.dto.id !== id);
    if (this.entries.length === before) return { state: this.getState(), error: '要删除的条目不存在。' };
    this.lastResult = null;
    return { state: this.getState() };
  }

  apply(): PreviewResult {
    if (this.phase === 'active') {
      return { state: this.getState(), error: '已有预演生效，请先撤销，不能叠加应用。' };
    }
    if (this.entries.length === 0) {
      return { state: this.getState(), error: '方案中还没有可应用的条目。' };
    }

    const checked: Array<{ entry: TrackedPreviewEntry; node: HTMLElement }> = [];
    const conflicts: PreviewOperationResult['items'] = [];
    const duplicateNodes: Record<PreviewAttribute, WeakSet<HTMLElement>> = {
      'aria-label': new WeakSet<HTMLElement>(),
      tabindex: new WeakSet<HTMLElement>(),
    };

    for (const entry of this.entries) {
      const resolved = this.resolveRecord(entry.dto.seq);
      const node = entry.ref.deref() ?? resolved?.node ?? null;
      const addConflict = (reason: string) =>
        conflicts.push({ entryId: entry.dto.id, seq: entry.dto.seq, attribute: entry.dto.attribute, status: 'conflict', reason });

      if (!node) {
        addConflict('建项节点已被垃圾回收，无法确认节点身份。');
        continue;
      }
      if (!node.isConnected) {
        addConflict('节点当前未连接到文档。');
        continue;
      }
      if (node.ownerDocument !== this.doc || node.getRootNode() !== this.doc) {
        addConflict('节点不在顶层普通文档中；本扩展不处理跨域框架或 Shadow DOM。');
        continue;
      }
      const validation = entry.dto.action === 'set'
        ? validatePreviewValue(entry.dto.attribute, entry.dto.value ?? '')
        : null;
      if (validation) {
        addConflict(validation);
        continue;
      }
      const currentValue = node.getAttribute(entry.dto.attribute);
      if (currentValue !== entry.dto.originalValue) {
        addConflict(
          `属性已变化：建项时 ${this.formatValue(entry.dto.originalValue)}，当前 ${this.formatValue(currentValue)}。`,
        );
        continue;
      }
      if (duplicateNodes[entry.dto.attribute].has(node)) {
        addConflict('同一节点的同一属性存在另一个有效条目。');
        continue;
      }
      duplicateNodes[entry.dto.attribute].add(node);
      checked.push({ entry, node });
    }

    if (conflicts.length > 0) {
      this.lastResult = { kind: 'apply', status: 'conflict', message: '预检发现冲突，本次整批未写入任何属性。', items: conflicts };
      return { state: this.getState() };
    }

    for (const { entry, node } of checked) {
      if (entry.dto.action === 'remove') {
        node.removeAttribute(entry.dto.attribute);
      } else {
        node.setAttribute(entry.dto.attribute, entry.dto.value ?? '');
      }
      entry.dto.status = 'active';
    }
    this.applied = checked.map(({ entry }) => entry);
    this.phase = 'active';
    this.lastResult = {
      kind: 'apply',
      status: 'applied',
      message: `已应用 ${checked.length} 个条目，可继续 Tab 巡检；撤销前不能再次应用。`,
      items: checked.map(({ entry }) => ({
        entryId: entry.dto.id,
        seq: entry.dto.seq,
        attribute: entry.dto.attribute,
        status: 'applied',
        reason: '已按方案写入。',
      })),
    };
    return { state: this.getState() };
  }

  undo(): PreviewResult {
    if (this.phase !== 'active') return { state: this.getState(), error: '当前没有已生效的预演。' };
    const items: PreviewOperationResult['items'] = [];
    let restored = 0;

    for (const entry of this.applied) {
      const node = entry.ref.deref();
      const base = {
        entryId: entry.dto.id,
        seq: entry.dto.seq,
        attribute: entry.dto.attribute,
      };
      if (!node) {
        items.push({ ...base, status: 'removed', reason: '节点已移除并被回收，已跳过；不会寻找同名替代节点。' });
        continue;
      }
      if (!node.isConnected) {
        items.push({ ...base, status: 'removed', reason: '节点已脱离文档，已跳过；不会寻找同名替代节点。' });
        continue;
      }
      const writtenValue = entry.dto.action === 'remove' ? null : entry.dto.value ?? '';
      const currentValue = node.getAttribute(entry.dto.attribute);
      if (currentValue !== writtenValue) {
        items.push({
          ...base,
          status: 'conflict',
          reason: `网站后续已修改属性：本次写入 ${this.formatValue(writtenValue)}，当前 ${this.formatValue(currentValue)}，已保留当前值。`,
        });
        continue;
      }
      if (entry.dto.originalValue === null) {
        node.removeAttribute(entry.dto.attribute);
      } else {
        node.setAttribute(entry.dto.attribute, entry.dto.originalValue);
      }
      entry.dto.status = 'draft';
      restored += 1;
      items.push({ ...base, status: 'restored', reason: `已恢复为 ${this.formatValue(entry.dto.originalValue)}。` });
    }

    this.applied = [];
    this.phase = 'draft';
    const conflicts = items.filter((item) => item.status !== 'restored').length;
    this.lastResult = {
      kind: 'undo',
      status: conflicts > 0 ? 'conflict' : 'restored',
      message: conflicts > 0
        ? `撤销完成：恢复 ${restored} 项，${conflictsOrRemoved(conflicts, items)}，可调整后再次应用。`
        : '全部条目已安全恢复原值，可调整方案后再次应用。',
      items,
    };
    return { state: this.getState() };
  }

  private prepareEntry(input: PreviewEntryInput, ignoreId?: string): { entry: TrackedPreviewEntry } | { error: string } {
    const resolved = this.resolveRecord(input.seq);
    const node = resolved?.node ?? null;
    if (!node) return { error: '所选记录的节点已不存在，不能建立预演条目。' };
    if (!node.isConnected) return { error: '所选节点当前未连接到文档。' };
    if (node.ownerDocument !== this.doc || node.getRootNode() !== this.doc) {
      return { error: '仅支持顶层普通文档中的 HTMLElement，不支持框架或 Shadow DOM。' };
    }
    const value = input.action === 'set' ? (input.value ?? '') : null;
    if (value !== null) {
      const validation = validatePreviewValue(input.attribute, value);
      if (validation) return { error: validation };
    }
    const duplicate = this.entries.find((entry) => {
      if (entry.dto.id === ignoreId) return false;
      if (entry.dto.attribute !== input.attribute) return false;
      const other = entry.ref.deref() ?? this.resolveRecord(entry.dto.seq)?.node ?? null;
      return other === node;
    });
    if (duplicate) return { error: '同一节点的同一属性已经有一个有效条目，请编辑原条目。' };

    const dto: PreviewEntryDTO = {
      id: input.id ?? createId(),
      seq: input.seq,
      tag: resolved?.tag ?? node.tagName.toLowerCase(),
      recordName: resolved?.name ?? '',
      attribute: input.attribute,
      action: input.action,
      value,
      originalValue: node.getAttribute(input.attribute),
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
    return { entry: { dto, ref: new WeakRef(node) } };
  }

  private formatValue(value: string | null): string {
    if (value === null) return '属性不存在';
    if (value === '') return '空字符串';
    return `"${value}"`;
  }
}

function conflictsOrRemoved(count: number, items: PreviewOperationResult['items']): string {
  const removed = items.filter((item) => item.status === 'removed').length;
  const changed = count - removed;
  const parts: string[] = [];
  if (removed > 0) parts.push(`${removed} 项节点缺失已跳过`);
  if (changed > 0) parts.push(`${changed} 项被网站后续修改而保留`);
  return parts.join('，');
}
