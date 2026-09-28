import {
  type FocusRecordDTO,
  type FocusSource,
  type InspectionStatus,
  type IssueDTO,
  type IssueCode,
  type NameSource,
  type PreviewEntryInput,
} from '../shared/messages.js';
import { getAccessibleName } from './naming.js';
import { FocusOutline } from './highlight.js';
import { AccessibilityPreview, type PreviewResult } from './preview.js';

interface TrackedRecord {
  dto: FocusRecordDTO;
  ref: WeakRef<HTMLElement>;
}

function hasInclusiveAncestor(node: Node, predicate: (ancestor: HTMLElement) => boolean): boolean {
  let current: Node | null = node;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (predicate(current as HTMLElement)) return true;
    current = current.parentNode;
  }
  return false;
}

function isAriaHiddenAncestor(el: HTMLElement): boolean {
  return hasInclusiveAncestor(
    el,
    (ancestor) =>
      ancestor.hasAttribute('aria-hidden') &&
      ancestor.getAttribute('aria-hidden') !== 'false',
  );
}

/**
 * 真实 focusin 采集器：不拦截按键、不改变焦点。
 * 通过 capture 阶段监听，来源依据事件发生瞬间的按键状态判定。
 */
export class FocusRecorder {
  private records: TrackedRecord[] = [];
  private seq = 0;
  private status: InspectionStatus = 'idle';
  private pendingKey = false;
  private lastKeyWithShift = false;
  private pendingKeyTimer = 0;
  private pendingMouseUntil = 0;
  private outline: FocusOutline | null = null;

  private preview: AccessibilityPreview;

  constructor(private doc: Document = document) {
    this.preview = new AccessibilityPreview(this.doc, (seq) => this.resolveTrackedRecord(seq));
  }

  start(): void {
    if (this.status !== 'idle') return;
    this.status = 'running';
    this.doc.addEventListener('focusin', this.handleFocusIn, true);
    this.doc.addEventListener('keydown', this.handleKeyDown, true);
    this.doc.addEventListener('mousedown', this.handleMouseDown, true);
    this.doc.addEventListener('scroll', this.handleLayoutChange, true);
    this.doc.defaultView?.addEventListener('resize', this.handleLayoutChange, true);
  }

  pause(): void {
    if (this.status === 'running') this.status = 'paused';
  }

  resume(): void {
    if (this.status === 'paused') this.status = 'running';
  }

  clear(): void {
    this.status = 'idle';
    this.doc.removeEventListener('focusin', this.handleFocusIn, true);
    this.doc.removeEventListener('keydown', this.handleKeyDown, true);
    this.doc.removeEventListener('mousedown', this.handleMouseDown, true);
    this.doc.removeEventListener('scroll', this.handleLayoutChange, true);
    this.doc.defaultView?.removeEventListener('resize', this.handleLayoutChange, true);
    this.records = [];
    this.seq = 0;
    this.preview = new AccessibilityPreview(this.doc, (seq) => this.resolveTrackedRecord(seq));
    this.outline?.destroy();
    this.outline = null;
  }

  stop(): void {
    this.status = 'idle';
    this.doc.removeEventListener('focusin', this.handleFocusIn, true);
    this.doc.removeEventListener('keydown', this.handleKeyDown, true);
    this.doc.removeEventListener('mousedown', this.handleMouseDown, true);
    this.doc.removeEventListener('scroll', this.handleLayoutChange, true);
    this.doc.defaultView?.removeEventListener('resize', this.handleLayoutChange, true);
    this.clear();
  }

  getState() {
    this.refreshRemovedFlags();
    const records = this.records.map((item) => item.dto);
    return { status: this.status, records, preview: this.preview.getState() };
  }

  addPreviewEntry(input: PreviewEntryInput): PreviewResult {
    return this.preview.addEntry(input);
  }

  updatePreviewEntry(id: string, input: PreviewEntryInput): PreviewResult {
    return this.preview.updateEntry(id, input);
  }

  deletePreviewEntry(id: string): PreviewResult {
    return this.preview.deleteEntry(id);
  }

  applyPreview(): PreviewResult {
    return this.preview.apply();
  }

  undoPreview(): PreviewResult {
    return this.preview.undo();
  }

  locate(seq: number): boolean {
    const item = this.records.find((entry) => entry.dto.seq === seq);
    if (!item) return false;
    const node = item.ref.deref();
    if (!node || !node.isConnected) {
      item.dto.removed = true;
      return false;
    }
    item.dto.removed = false;
    if (!this.outline) this.outline = new FocusOutline(this.doc);
    try {
      node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch {
      // jsdom 等环境不支持 scrollIntoView 时忽略。
    }
    this.outline.track(node);
    return true;
  }

  private handleLayoutChange = (): void => {
    // 描边层通过 rAF 自行跟随，滚动/缩放监听用于兼容位置突变。
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') {
      this.pendingKey = true;
      this.lastKeyWithShift = event.shiftKey;
      this.doc.defaultView?.clearTimeout(this.pendingKeyTimer);
      this.pendingKeyTimer = this.doc.defaultView?.setTimeout(() => {
        this.pendingKey = false;
      }, 500) as unknown as number;
    }
  };

  private handleMouseDown = (): void => {
    // 点击聚焦紧随 mousedown 发生；时间窗内的 focusin 判定为鼠标来源。
    this.pendingKey = false;
    this.pendingMouseUntil = Date.now() + 800;
  };

  private handleFocusIn = (event: FocusEvent): void => {
    if (this.status !== 'running') return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.kfiIgnore !== undefined) return;
    // 忽略扩展自身注入的 UI 内的焦点（当前实现无注入 UI，保留防护）。
    if (target.closest?.('[data-kfi-ignore]')) return;

    const source: FocusSource = this.pendingKey
      ? this.lastKeyWithShift
        ? 'shiftTab'
        : 'tab'
      : Date.now() <= this.pendingMouseUntil
        ? 'mouse'
        : 'other';

    this.pendingKey = false;
    this.pendingMouseUntil = 0;
    this.doc.defaultView?.clearTimeout(this.pendingKeyTimer);

    const { name, nameSource } = getAccessibleName(target);
    const issues = this.detectIssues(target, nameSource);
    const dto: FocusRecordDTO = {
      seq: ++this.seq,
      time: new Date().toISOString(),
      tag: target.tagName.toLowerCase(),
      name,
      nameSource,
      source,
      issues,
      removed: false,
    };
    this.records.push({ dto, ref: new WeakRef(target) });
  };

  private detectIssues(el: HTMLElement, nameSource: NameSource): IssueDTO[] {
    const issues: IssueDTO[] = [];
    const add = (code: IssueCode, basis: string) => issues.push({ code, basis });

    const tabindexValue = el.getAttribute('tabindex');
    if (tabindexValue !== null && Number.parseInt(tabindexValue, 10) > 0) {
      add(
        'positiveTabindex',
        `事件发生时元素具有正 tabindex="${tabindexValue}"，会打断自然 Tab 顺序。`,
      );
    }

    if (isAriaHiddenAncestor(el)) {
      add(
        'ariaHiddenAncestor',
        '事件发生时焦点元素自身或祖先带有 aria-hidden（非 "false"），焦点进入了对辅助技术隐藏的区域。',
      );
    }

    const tag = el.tagName.toLowerCase();
    if ((tag === 'button' || tag === 'a') && nameSource === 'none') {
      add(
        'namelessControl',
        '事件发生时 button/a 按 aria-labelledby、aria-label、关联 label、元素文本均无名称。',
      );
    }

    return issues;
  }

  private refreshRemovedFlags(): void {
    for (const item of this.records) {
      const node = item.ref.deref();
      item.dto.removed = !node || !node.isConnected;
    }
  }

  private resolveTrackedRecord(seq: number): { node: HTMLElement; tag: string; name: string } | null {
    const item = this.records.find((entry) => entry.dto.seq === seq);
    if (!item) return null;
    const node = item.ref.deref();
    return node && node.isConnected
      ? { node, tag: item.dto.tag, name: item.dto.name }
      : null;
  }
}
