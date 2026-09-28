import { describe, expect, it, beforeEach } from 'vitest';
import { FocusRecorder } from '../src/content/recorder.js';
import { RehearsalManager } from '../src/content/rehearsal.js';

function focus(el: Element | null): void {
  el?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

function setup(): { recorder: FocusRecorder; rehearsal: RehearsalManager }
function setup(html: string, tags: string[]): {
  recorder: FocusRecorder;
  rehearsal: RehearsalManager;
  els: HTMLElement[];
}
function setup(html = '', selectors: string[] = []) {
  document.body.innerHTML = html;
  const recorder = new FocusRecorder();
  recorder.start();
  selectors.forEach((selector) => focus(document.querySelector(selector)));
  const rehearsal = new RehearsalManager((seq) => recorder.resolveNode(seq));
  const els = selectors.map((selector) => document.querySelector(selector) as HTMLElement);
  return { recorder, rehearsal, els };
}

describe('RehearsalManager', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('建项区分属性不存在与空字符串', () => {
    const { rehearsal } = setup(
      '<button id="a" aria-label="">a</button><button id="b">b</button>',
      ['#a', '#b'],
    );
    rehearsal.add(1, 'aria-label', 'set', '新名', { tag: 'button', name: 'a' });
    rehearsal.add(2, 'aria-label', 'set', '', { tag: 'button', name: 'b' });
    const state = rehearsal.getState();
    expect(state.entries[0].original).toBe('');
    expect(state.entries[1].original).toBeNull();
  });

  it('同一节点同一属性只能有一个有效条目，不同属性/节点可以', () => {
    const { rehearsal } = setup(
      '<button id="a">a</button><button id="b">b</button>',
      ['#a', '#b'],
    );
    rehearsal.add(1, 'aria-label', 'set', 'x', { tag: 'button', name: 'a' });
    expect(() => rehearsal.add(1, 'aria-label', 'remove', undefined, { tag: 'button', name: 'a' })).toThrow();
    rehearsal.add(1, 'tabindex', 'set', '0', { tag: 'button', name: 'a' });
    rehearsal.add(2, 'aria-label', 'set', 'y', { tag: 'button', name: 'b' });
    expect(rehearsal.getState().entries).toHaveLength(3);
  });

  it('tabindex 仅接受整数并给出明确提示', () => {
    const { rehearsal } = setup('<button id="a">a</button>', ['#a']);
    for (const bad of ['1.5', 'abc', '', '  ', '0x1', '-']) {
      expect(() => rehearsal.add(1, 'tabindex', 'set', bad, { tag: 'button', name: 'a' })).toThrow(
        /整数/,
      );
    }
    rehearsal.add(1, 'tabindex', 'set', ' -1 ', { tag: 'button', name: 'a' });
    expect(rehearsal.getState().entries[0].value).toBe('-1');
  });

  it('整批预检通过后写入 set 与 remove，结果标记已生效', () => {
    const { rehearsal, els } = setup(
      '<button id="a" tabindex="3">a</button><a id="b" href="#" aria-label="旧">b</a>',
      ['#a', '#b'],
    );
    rehearsal.add(1, 'tabindex', 'set', '0', { tag: 'button', name: 'a' });
    rehearsal.add(2, 'aria-label', 'remove', undefined, { tag: 'a', name: 'b' });
    const state = rehearsal.apply();
    expect(state.phase).toBe('applied');
    expect(els[0].getAttribute('tabindex')).toBe('0');
    expect(els[1].hasAttribute('aria-label')).toBe(false);
  });

  it('应用前属性被页面改动：列明原因且整批不写入', () => {
    const { rehearsal, els } = setup(
      '<button id="a">a</button><button id="b">b</button>',
      ['#a', '#b'],
    );
    rehearsal.add(1, 'aria-label', 'set', '新名', { tag: 'button', name: 'a' });
    rehearsal.add(2, 'tabindex', 'set', '0', { tag: 'button', name: 'b' });
    els[0].setAttribute('aria-label', '页面抢先写入');
    const state = rehearsal.apply();
    expect(state.phase).toBe('editing');
    expect(state.lastResult?.phase).toBe('failed');
    expect(state.lastResult?.conflicts[0].reason).toMatch(/属性已被页面改动/);
    expect(els[0].getAttribute('aria-label')).toBe('页面抢先写入');
    expect(els[1].hasAttribute('tabindex')).toBe(false);
  });

  it('应用前节点已移除：整批不写入，且不碰同名替代节点', () => {
    const { rehearsal, els } = setup(
      '<div id="h"><button id="a">同名</button><button id="b">b</button></div>',
      ['#a', '#b'],
    );
    rehearsal.add(1, 'aria-label', 'set', '修复', { tag: 'button', name: '同名' });
    rehearsal.add(2, 'tabindex', 'set', '0', { tag: 'button', name: 'b' });
    els[0].remove();
    document.getElementById('h')!.appendChild(document.createElement('button')).textContent = '同名';
    const state = rehearsal.apply();
    expect(state.lastResult?.conflicts[0].reason).toMatch(/节点已从文档移除/);
    const buttons = document.querySelectorAll('button');
    expect(buttons[0].hasAttribute('aria-label')).toBe(false);
    expect(els[1].hasAttribute('tabindex')).toBe(false);
  });

  it('撤销按本次写入值逐项恢复：属性不存在/空串/原值/remove', () => {
    const { rehearsal, els } = setup(
      '<button id="a">a</button>'
      + '<button id="b" aria-label="">b</button>'
      + '<button id="c" aria-label="旧名">c</button>'
      + '<button id="d" tabindex="2">d</button>',
      ['#a', '#b', '#c', '#d'],
    );
    rehearsal.add(1, 'aria-label', 'set', '名', { tag: 'button', name: 'a' });
    rehearsal.add(2, 'aria-label', 'set', '新', { tag: 'button', name: 'b' });
    rehearsal.add(3, 'aria-label', 'set', '改名', { tag: 'button', name: 'c' });
    rehearsal.add(4, 'tabindex', 'remove', undefined, { tag: 'button', name: 'd' });
    rehearsal.apply();
    const state = rehearsal.undo();
    expect(els[0].hasAttribute('aria-label')).toBe(false);
    expect(els[1].getAttribute('aria-label')).toBe('');
    expect(els[2].getAttribute('aria-label')).toBe('旧名');
    expect(els[3].getAttribute('tabindex')).toBe('2');
    const outcomes = state.lastResult?.undoItems.map((item) => item.outcome);
    expect(outcomes).toEqual(['removed-attr', 'restored', 'restored', 'restored']);
  });

  it('撤销时页面已改动当前值则保留改动并报告冲突', () => {
    const { rehearsal, els } = setup('<button id="a">a</button>', ['#a']);
    rehearsal.add(1, 'tabindex', 'set', '0', { tag: 'button', name: 'a' });
    rehearsal.apply();
    els[0].setAttribute('tabindex', '5');
    const state = rehearsal.undo();
    expect(els[0].getAttribute('tabindex')).toBe('5');
    expect(state.lastResult?.undoItems[0]).toMatchObject({ outcome: 'conflict-changed' });
  });

  it('撤销时节点已移除则跳过且不寻找替代节点', () => {
    const { rehearsal, els } = setup(
      '<div id="h"><button id="a">同名</button></div>',
      ['#a'],
    );
    rehearsal.add(1, 'aria-label', 'set', '修复', { tag: 'button', name: '同名' });
    rehearsal.apply();
    els[0].remove();
    const replacement = document.createElement('button');
    replacement.textContent = '同名';
    document.getElementById('h')!.appendChild(replacement);
    const state = rehearsal.undo();
    expect(replacement.hasAttribute('aria-label')).toBe(false);
    expect(state.lastResult?.undoItems[0]).toMatchObject({ outcome: 'skipped-node-gone' });
  });

  it('已生效期间锁定方案；撤销后可调整并再次应用', () => {
    const { rehearsal } = setup('<button id="a">a</button>', ['#a']);
    rehearsal.add(1, 'aria-label', 'set', '名', { tag: 'button', name: 'a' });
    rehearsal.apply();
    expect(() => rehearsal.add(1, 'tabindex', 'set', '0', { tag: 'button', name: 'a' })).toThrow();
    expect(() => rehearsal.update(rehearsal.getState().entries[0].id, 'remove', undefined)).toThrow();
    expect(() => rehearsal.apply()).toThrow();
    rehearsal.undo();
    rehearsal.update(rehearsal.getState().entries[0].id, 'set', '新名');
    expect(rehearsal.apply().phase).toBe('applied');
  });

  it('编辑与删除条目', () => {
    const { rehearsal } = setup('<button id="a">a</button>', ['#a']);
    rehearsal.add(1, 'aria-label', 'set', '名', { tag: 'button', name: 'a' });
    const id = rehearsal.getState().entries[0].id;
    rehearsal.update(id, 'set', '改名');
    expect(rehearsal.getState().entries[0].value).toBe('改名');
    rehearsal.update(id, 'remove', undefined);
    expect(rehearsal.getState().entries[0].action).toBe('remove');
    rehearsal.remove(id);
    expect(rehearsal.getState().entries).toHaveLength(0);
  });
});
