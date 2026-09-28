import { beforeEach, describe, expect, it } from 'vitest';
import { AccessibilityPreview, validatePreviewValue } from '../src/content/preview.js';

describe('AccessibilityPreview', () => {
  let first: HTMLButtonElement;
  let second: HTMLButtonElement;
  let nodes: Map<number, HTMLElement>;
  let preview: AccessibilityPreview;

  beforeEach(() => {
    document.body.innerHTML = '<button id="a">原名</button><a id="b" tabindex="1">x</a>';
    first = document.getElementById('a') as HTMLButtonElement;
    second = document.getElementById('b') as HTMLAnchorElement;
    nodes = new Map([[1, first], [2, first], [3, second]]);
    preview = new AccessibilityPreview(document, (seq) => {
      const node = nodes.get(seq);
      return node ? { node, tag: node.tagName.toLowerCase(), name: node.textContent ?? '' } : null;
    });
  });

  it('区分 aria-label 不存在与空字符串，并支持移除 tabindex', () => {
    expect(validatePreviewValue('aria-label', '')).toBeNull();
    expect(validatePreviewValue('tabindex', '1.5')).toContain('整数');
    preview.addEntry({ seq: 1, attribute: 'aria-label', action: 'set', value: '' });
    preview.addEntry({ seq: 3, attribute: 'tabindex', action: 'remove', value: null });

    const result = preview.apply();
    expect(result.error).toBeUndefined();
    expect(first.getAttribute('aria-label')).toBe('');
    expect(first.hasAttribute('aria-label')).toBe(true);
    expect(second.hasAttribute('tabindex')).toBe(false);
  });

  it('重复记录绑定同一节点时，同一属性只允许一个有效条目', () => {
    preview.addEntry({ seq: 1, attribute: 'aria-label', action: 'set', value: 'A' });
    const duplicate = preview.addEntry({ seq: 2, attribute: 'aria-label', action: 'set', value: 'B' });
    expect(duplicate.error).toContain('同一节点');
    expect(preview.getState().entries).toHaveLength(1);
  });

  it('应用前发现属性变化或节点脱离，整批不写入', () => {
    preview.addEntry({ seq: 1, attribute: 'aria-label', action: 'set', value: 'A' });
    preview.addEntry({ seq: 3, attribute: 'tabindex', action: 'set', value: '0' });
    first.setAttribute('aria-label', '网站修改');

    const result = preview.apply();
    expect(result.state.lastResult?.status).toBe('conflict');
    expect(result.state.lastResult?.items[0].reason).toContain('属性已变化');
    expect(second.getAttribute('tabindex')).toBe('1');
  });

  it('撤销时仅恢复仍等于写入值的属性，外部修改和缺失节点会报告冲突', () => {
    preview.addEntry({ seq: 1, attribute: 'aria-label', action: 'set', value: '临时' });
    preview.addEntry({ seq: 3, attribute: 'tabindex', action: 'set', value: '0' });
    preview.apply();
    first.setAttribute('aria-label', '网站新值');
    second.remove();

    const undo = preview.undo();
    expect(undo.state.lastResult?.status).toBe('conflict');
    expect(first.getAttribute('aria-label')).toBe('网站新值');
    expect(undo.state.lastResult?.items.map((item) => item.status).sort()).toEqual(['conflict', 'removed']);
    expect(preview.getState().phase).toBe('draft');
  });

  it('已生效期间不能编辑、删除或叠加应用', () => {
    preview.addEntry({ seq: 1, attribute: 'aria-label', action: 'set', value: '临时' });
    preview.apply();
    const id = preview.getState().entries[0].id;
    expect(preview.apply().error).toContain('不能叠加');
    expect(preview.updateEntry(id, { seq: 1, attribute: 'aria-label', action: 'set', value: 'x' }).error).toContain('先撤销');
    expect(preview.deleteEntry(id).error).toContain('先撤销');
  });
});
