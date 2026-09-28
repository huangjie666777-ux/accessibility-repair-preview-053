import type { RuntimeMessage, RuntimeResponse } from '../shared/messages.js';
import { FocusRecorder } from './recorder.js';

declare global {
  interface Window {
    __kfiRecorder?: FocusRecorder;
  }
}

// 重复注入保护：重复 START 不会重复监听。
const recorder = (window.__kfiRecorder ??= new FocusRecorder());

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'PING':
      break;
    case 'GET_STATE':
      break;
    case 'START':
      recorder.start();
      break;
    case 'PAUSE':
      recorder.pause();
      break;
    case 'RESUME':
      recorder.resume();
      break;
    case 'CLEAR':
      recorder.clear();
      break;
    case 'LOCATE':
      return sendResponse({ ...recorder.getState(), ok: true, located: recorder.locate(message.seq) });
  }
  const response: RuntimeResponse = { ...recorder.getState(), ok: true };
  sendResponse(response);
  // 整页导航会卸载窗口，记录器随之销毁，天然实现“导航后清空并停止”。
  return false;
});
