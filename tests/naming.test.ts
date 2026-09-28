import { describe, expect, it, beforeEach } from 'vitest';
import { getAccessibleName } from '../src/content/naming.js';

function setDom(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe('getAccessibleName', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('优先使用 aria-labelledby 引用文本', () => {
    document.body.innerHTML =
      '<span id="r">引用文本</span><button aria-labelledby="r" aria-label="标签">内部</button>';
    const button = document.querySelector('button')!;
    expect(getAccessibleName(button)).toEqual({ name: '引用文本', nameSource: 'aria-labelledby' });
  });

  it('其次使用 aria-label', () => {
    const el = setDom('<button aria-label="明确标签">内部</button>');
    expect(getAccessibleName(el)).toEqual({ name: '明确标签', nameSource: 'aria-label' });
  });

  it('使用关联 label（for 属性）且不读取 value', () => {
    document.body.innerHTML =
      '<label for="i">邮箱</label><input id="i" value="secret@example.com" />';
    const input = document.querySelector('input')!;
    expect(getAccessibleName(input)).toEqual({ name: '邮箱', nameSource: 'label' });
  });

  it('回退到元素自身文本', () => {
    const el = setDom('<button>  提交\n订单 </button>');
    expect(getAccessibleName(el)).toEqual({ name: '提交 订单', nameSource: 'text' });
  });

  it('无名称时返回 none', () => {
    const el = setDom('<a href="#"></a>');
    expect(getAccessibleName(el)).toEqual({ name: '', nameSource: 'none' });
  });
});
