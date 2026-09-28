import {
  type RehearsalAttr,
  type RehearsalConflictDTO,
  type RehearsalEntryDTO,
  type RehearsalResultDTO,
  type RehearsalStateDTO,
  type RehearsalUndoItemDTO,
  validateTabindexValue,
} from '../shared/messages.js';

interface StoredEntry {
  dto: RehearsalEntryDTO;
  ref: WeakRef<HTMLElement>;
}

export type NodeResolver = (seq: number) => HTMLElement | null;

function describeValue(value: string | null): string {
  return value === null ? '属性不存在' : value === '' ? '空字符串' : `"${value}"`;
}

/**
 * 无障碍修复预演：按节点身份（WeakRef）临时改写 aria-label / tabindex，
 * 整批预检、整批写入；撤销逐项核对本次写入值，绝不寻找替代节点。
 */
export class RehearsalManager {
  private entries: StoredEntry[] = [];
  private phase: 'editing' | 'applied' = 'editing';
  private lastResult: RehearsalResultDTO | null = null;
  private counter = 0;

  constructor(private resolveNode: NodeResolver) {}

  getState(): RehearsalStateDTO {
    for (const entry of this.entries) {
      const node = entry.ref.deref();
      entry.dto.nodeConnected = Boolean(node && node.isConnected);
    }
    return {
      phase: this.phase,
      entries: this.entries.map((entry) => ({ ...entry.dto })),
      lastResult: this.lastResult
        ? (JSON.parse(JSON.stringify(this.lastResult)) as RehearsalResultDTO)
        : null,
    };
  }

  add(
    seq: number,
    attr: RehearsalAttr,
    action: 'set' | 'remove',
    value: string | undefined,
    record: { tag: string; name: string },
  ): RehearsalStateDTO {
    this.ensureEditing();
    const node = this.resolveNode(seq);
    if (!node || !node.isConnected) {
      throw new Error('所选记录的原节点已移除，无法为其建立预演条目。');
    }
    if (this.entries.some((entry) => entry.ref.deref() === node && entry.dto.attr === attr)) {
      throw new Error('该节点的这一属性已存在有效条目，请直接编辑或删除原条目。');
    }
    const normalized = this.validateValue(attr, action, value);
    const original = node.getAttribute(attr);
    this.entries.push({
      dto: {
        id: this.nextId(),
        seq,
        tag: record.tag,
        name: record.name,
        attr,
        action,
        ...(action === 'set' ? { value: normalized } : {}),
        original,
        nodeConnected: true,
      },
      ref: new WeakRef(node),
    });
    this.lastResult = null;
    return this.getState();
  }

  update(id: string, action: 'set' | 'remove', value: string | undefined): RehearsalStateDTO {
    this.ensureEditing();
    const entry = this.entries.find((item) => item.dto.id === id);
    if (!entry) throw new Error('条目不存在，可能已被删除。');
    entry.dto.action = action;
    if (action === 'set') {
      entry.dto.value = this.validateValue(entry.dto.attr, action, value);
    } else {
      delete entry.dto.value;
    }
    this.lastResult = null;
    return this.getState();
  }

  remove(id: string): RehearsalStateDTO {
    this.ensureEditing();
    this.entries = this.entries.filter((entry) => entry.dto.id !== id);
    this.lastResult = null;
    return this.getState();
  }

  apply(): RehearsalStateDTO {
    this.ensureEditing();
    const conflicts: RehearsalConflictDTO[] = [];

    for (const entry of this.entries) {
      const { dto } = entry;
      const node = entry.ref.deref();
      if (!node || !node.isConnected) {
        conflicts.push({
          entryId: dto.id,
          seq: dto.seq,
          attr: dto.attr,
          reason: '节点已从文档移除（不使用同名节点替代）。',
        });
        continue;
      }
      const current = node.getAttribute(dto.attr);
      if (current !== dto.original) {
        conflicts.push({
          entryId: dto.id,
          seq: dto.seq,
          attr: dto.attr,
          reason: `建项时原值为 ${describeValue(dto.original)}，应用前当前值为 ${describeValue(current)}，属性已被页面改动。`,
        });
      }
    }

    if (conflicts.length > 0) {
      this.lastResult = { phase: 'failed', appliedAt: null, revertedAt: null, conflicts, undoItems: [] };
      return this.getState();
    }

    for (const entry of this.entries) {
      const node = entry.ref.deref();
      if (!node) continue;
      if (entry.dto.action === 'set') {
        node.setAttribute(entry.dto.attr, entry.dto.value ?? '');
      } else {
        node.removeAttribute(entry.dto.attr);
      }
    }
    this.phase = 'applied';
    this.lastResult = {
      phase: 'applied',
      appliedAt: new Date().toISOString(),
      revertedAt: null,
      conflicts: [],
      undoItems: [],
    };
    return this.getState();
  }

  undo(): RehearsalStateDTO {
    if (this.phase !== 'applied') {
      throw new Error('当前没有已生效的预演可撤销。');
    }
    const appliedAt = this.lastResult?.appliedAt ?? null;
    const undoItems: RehearsalUndoItemDTO[] = [];
    for (const entry of this.entries) {
      const { dto } = entry;
      const node = entry.ref.deref();
      if (!node || !node.isConnected) {
        undoItems.push({
          entryId: dto.id,
          seq: dto.seq,
          attr: dto.attr,
          outcome: 'skipped-node-gone',
          detail: '节点已移除，跳过且不寻找替代节点。',
        });
        continue;
      }
      const written = dto.action === 'set' ? (dto.value ?? '') : null;
      const current = node.getAttribute(dto.attr);
      if (current !== written) {
        undoItems.push({
          entryId: dto.id,
          seq: dto.seq,
          attr: dto.attr,
          outcome: 'conflict-changed',
          detail: `当前值为 ${describeValue(current)}，与本次写入值 ${describeValue(written)} 不一致，保留页面后续修改。`,
        });
        continue;
      }
      if (dto.original === null) {
        node.removeAttribute(dto.attr);
        undoItems.push({
          entryId: dto.id,
          seq: dto.seq,
          attr: dto.attr,
          outcome: 'removed-attr',
          detail: '已移除属性，恢复为建项时的“属性不存在”。',
        });
      } else {
        node.setAttribute(dto.attr, dto.original);
        undoItems.push({
          entryId: dto.id,
          seq: dto.seq,
          attr: dto.attr,
          outcome: 'restored',
          detail: `已恢复原值 ${describeValue(dto.original)}。`,
        });
      }
    }
    this.phase = 'editing';
    this.lastResult = {
      phase: 'reverted',
      appliedAt,
      revertedAt: new Date().toISOString(),
      conflicts: [],
      undoItems,
    };
    return this.getState();
  }

  private ensureEditing(): void {
    if (this.phase === 'applied') {
      throw new Error('预演已生效：请先撤销，再调整方案。');
    }
  }

  private validateValue(
    attr: RehearsalAttr,
    action: 'set' | 'remove',
    value: string | undefined,
  ): string {
    if (action === 'remove') return '';
    if (value === undefined) throw new Error('设置属性时必须提供目标值。');
    if (attr === 'tabindex') {
      const error = validateTabindexValue(value);
      if (error) throw new Error(error);
      return value.trim();
    }
    return value;
  }

  private nextId(): string {
    this.counter += 1;
    const rand =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `re-${Date.now().toString(36)}-${this.counter}-${rand}`;
  }
}
