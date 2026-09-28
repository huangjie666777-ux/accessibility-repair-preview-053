import type {
  InspectionState,
  RuntimeMessage,
  RuntimeResponse,
} from '../shared/messages.js';

export type TabKind = 'inspectable' | 'restricted';

export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export function getTabKind(tab: chrome.tabs.Tab): TabKind {
  return /^https?:\/\//i.test(tab.url ?? '') ? 'inspectable' : 'restricted';
}

async function ping(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  const alive = await ping(tabId);
  if (alive) return;
  if (typeof chrome.scripting === 'undefined') {
    throw new Error('当前 Chrome 版本不支持动态注入。');
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch {
    throw new Error('无法注入内容脚本：当前页面可能受限，请在普通 http/https 页面重试。');
  }
}

export async function sendCommand(
  tab: chrome.tabs.Tab,
  message: RuntimeMessage,
): Promise<RuntimeResponse> {
  if (tab.id === undefined) throw new Error('当前标签页不可用。');
  if (getTabKind(tab) === 'restricted') {
    throw new Error('受限页面：扩展仅能在 http/https 标签页中运行。请切换到普通网页后重试。');
  }
  // 仅显式开始（或恢复/控制）时才注入；GET_STATE 只探测，不注入，
  // 满足“仅在用户启动后注入”。
  if (message.type === 'GET_STATE') {
    const alive = await ping(tab.id);
    if (!alive) return { ...emptyState, ok: true };
  } else {
    await ensureContentScript(tab.id);
  }
  return (await chrome.tabs.sendMessage(tab.id, message)) as RuntimeResponse;
}

export const emptyState: InspectionState = {
  status: 'idle',
  records: [],
  preview: { phase: 'draft', entries: [], lastResult: null },
};
