import { describe, expect, it, vi } from 'vitest';
import { getTabKind } from '../src/popup/api.js';

describe('getTabKind', () => {
  it.each([
    ['http://example.com/app', 'inspectable'],
    ['https://example.com/', 'inspectable'],
    ['chrome://extensions/', 'restricted'],
    ['chrome-web-store://popup', 'restricted'],
    ['file:///tmp/demo.html', 'restricted'],
    ['devtools://devtools/bundled/inspector.html', 'restricted'],
  ])('%s -> %s', (url, expected) => {
    expect(getTabKind({ url } as chrome.tabs.Tab)).toBe(expected);
  });
});
