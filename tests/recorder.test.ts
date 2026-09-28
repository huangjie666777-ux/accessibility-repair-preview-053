import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { FocusRecorder } from '../src/content/recorder.js';

function focus(el: Element | null): void {
  el?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

function pressTab(shift = false): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true }));
}

describe('FocusRecorder', () => {
  let recorder: FocusRecorder;

  beforeEach(() => {
    document.body.innerHTML = '';
    recorder = new FocusRecorder();
    recorder.start();
  });

  afterEach(() => {
    recorder.stop();
    vi.useRealTimers();
  });

  it('重复 start 不重复监听', () => {
    recorder.start();
    recorder.start();
    document.body.innerHTML = '<button>a</button>';
    focus(document.querySelector('button'));
    expect(recorder.getState().records).toHaveLength(1);
  });

  it('区分 Tab、Shift+Tab、鼠标与其他来源', () => {
    document.body.innerHTML =
      '<button id="a">a</button><button id="b">b</button><button id="c">c</button><button id="d">d</button>';

    pressTab();
    focus(document.getElementById('a'));
    pressTab(true);
    focus(document.getElementById('b'));
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    focus(document.getElementById('c'));
    focus(document.getElementById('d'));

    const sources = recorder.getState().records.map((r) => r.source);
    expect(sources).toEqual(['tab', 'shiftTab', 'mouse', 'other']);
  });

  it('暂停时不记录，继续后恢复', () => {
    document.body.innerHTML = '<button id="a">a</button><button id="b">b</button>';
    pressTab();
    focus(document.getElementById('a'));
    recorder.pause();
    pressTab();
    focus(document.getElementById('b'));
    expect(recorder.getState().records).toHaveLength(1);
    recorder.resume();
    pressTab();
    focus(document.getElementById('b'));
    expect(recorder.getState().records).toHaveLength(2);
  });

  it('标记正 tabindex、aria-hidden 祖先与无名称按钮/链接，并给出依据', () => {
    document.body.innerHTML =
      '<a href="#" tabindex="2">x</a>'
      + '<div aria-hidden="true"><button id="h">h</button></div>'
      + '<button id="n"></button>';

    focus(document.querySelector('a'));
    focus(document.getElementById('h'));
    focus(document.getElementById('n'));

    const state = recorder.getState();
    expect(state.records[0].issues.map((i) => i.code)).toContain('positiveTabindex');
    expect(state.records[1].issues.map((i) => i.code)).toContain('ariaHiddenAncestor');
    expect(state.records[2].issues.map((i) => i.code)).toContain('namelessControl');
    for (const record of state.records) {
      for (const issue of record.issues) expect(issue.basis.length).toBeGreaterThan(5);
    }
  });

  it('名称与问题为事件时快照：之后改名不影响历史', () => {
    document.body.innerHTML = '<button id="b">原名</button>';
    pressTab();
    const button = document.getElementById('b')!;
    focus(button);
    button.textContent = '新名';
    expect(recorder.getState().records[0].name).toBe('原名');
  });

  it('元素删除后标记移除，插回同一节点可重新定位；相似新节点不串绑', () => {
    document.body.innerHTML = '<div id="h"><button id="b">动态</button></div>';
    focus(document.getElementById('b'));
    const original = document.getElementById('b')!;
    original.remove();
    expect(recorder.getState().records[0].removed).toBe(true);
    expect(recorder.locate(1)).toBe(false);

    document.getElementById('h')!.appendChild(original);
    expect(recorder.locate(1)).toBe(true);
    expect(recorder.getState().records[0].removed).toBe(false);

    original.remove();
    const lookalike = original.cloneNode(true) as HTMLElement;
    document.getElementById('h')!.appendChild(lookalike);
    expect(recorder.getState().records[0].removed).toBe(true);
  });

  it('清空会移除记录与定位状态', () => {
    document.body.innerHTML = '<button id="b">x</button>';
    focus(document.getElementById('b'));
    recorder.clear();
    expect(recorder.getState()).toEqual({
      status: 'idle',
      records: [],
      preview: { phase: 'draft', entries: [], lastResult: null },
    });
    expect(document.querySelector('[data-kfi-ignore]')).toBeNull();
  });

  it('忽略扩展自身注入元素的焦点', () => {
    document.body.innerHTML = '<div data-kfi-ignore="true"><button id="x">x</button></div>';
    focus(document.getElementById('x'));
    expect(recorder.getState().records).toHaveLength(0);
  });

  it('预演生效后新记录读取当前属性，历史记录保持原样', () => {
    document.body.innerHTML = '<button id="p"></button>';
    pressTab();
    const button = document.getElementById('p')!;
    focus(button);
    recorder.addPreviewEntry({
      seq: 1,
      attribute: 'aria-label',
      action: 'set',
      value: '预演名称',
    });
    recorder.applyPreview();

    pressTab();
    focus(button);
    const state = recorder.getState();
    expect(state.records[0].name).toBe('');
    expect(state.records[1].name).toBe('预演名称');
    expect(state.preview.phase).toBe('active');
  });
});
