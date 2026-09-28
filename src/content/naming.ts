import type { NameSource } from '../shared/messages.js';

const MAX_TEXT_LENGTH = 120;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function cssEscapeId(id: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(id);
  return id.replace(/[^a-zA-Z0-9_-]/g, (ch) => String.fromCharCode(92) + ch);
}

function textFromIds(el: HTMLElement): string {
  const attr = el.getAttribute('aria-labelledby');
  if (!attr) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  const parts: string[] = [];
  for (const id of attr.split(/\s+/)) {
    if (!id) continue;
    const referenced = root.getElementById?.(id);
    if (referenced) {
      const text = collapse(referenced.textContent ?? '');
      if (text) parts.push(text);
    }
  }
  return parts.join(' ');
}

function textFromLabel(el: HTMLElement): string {
  const labels: string[] = [];
  const labeled = el as HTMLElement & { labels?: NodeListOf<HTMLElement> };
  if (labeled.labels && labeled.labels.length > 0) {
    labeled.labels.forEach((labelEl) => {
      const text = collapse(labelEl.textContent ?? '');
      if (text) labels.push(text);
    });
  } else {
    const wrapping = el.closest('label');
    if (wrapping) {
      const text = collapse(wrapping.textContent ?? '');
      if (text) labels.push(text);
    }
    if (el.id) {
      const explicit = el.ownerDocument.querySelector(`label[for="${cssEscapeId(el.id)}"]`);
      if (explicit) {
        const text = collapse(explicit.textContent ?? '');
        if (text) labels.push(text);
      }
    }
  }
  return labels.join(' ');
}

/**
 * 按规定优先级解析可访问名称，绝不读取输入控件的 value。
 */
export function getAccessibleName(el: HTMLElement): { name: string; nameSource: NameSource } {
  const labelledby = textFromIds(el);
  if (labelledby) return { name: labelledby, nameSource: 'aria-labelledby' };

  const ariaLabel = collapse(el.getAttribute('aria-label') ?? '');
  if (ariaLabel) return { name: ariaLabel, nameSource: 'aria-label' };

  const labelText = textFromLabel(el);
  if (labelText) return { name: labelText, nameSource: 'label' };

  const text = collapse(el.textContent ?? '');
  if (text) return { name: text, nameSource: 'text' };

  return { name: '', nameSource: 'none' };
}
