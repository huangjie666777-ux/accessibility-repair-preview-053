import type { RuntimeMessage, RuntimeResponse } from '../shared/messages.js';
import { FocusRecorder } from './recorder.js';
import { RehearsalManager } from './rehearsal.js';

declare global {
  interface Window {
    __kfiRecorder?: FocusRecorder;
  }
}

// 重复注入保护：重复 START 不会重复监听。
const recorder = (window.__kfiRecorder ??= new FocusRecorder());
const rehearsal = new RehearsalManager((seq) => recorder.resolveNode(seq));

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  let located: boolean | undefined;
  let error: string | undefined;
  try {
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
        located = recorder.locate(message.seq);
        break;
      case 'REHEARSAL_ADD': {
        const snapshot = recorder.getRecordSnapshot(message.seq);
        if (!snapshot) throw new Error('所选记录不存在，请先巡检产生记录。');
        rehearsal.add(message.seq, message.attr, message.action, message.value, snapshot);
        break;
      }
      case 'REHEARSAL_UPDATE':
        rehearsal.update(message.id, message.action, message.value);
        break;
      case 'REHEARSAL_REMOVE':
        rehearsal.remove(message.id);
        break;
      case 'REHEARSAL_APPLY':
        rehearsal.apply();
        break;
      case 'REHEARSAL_UNDO':
        rehearsal.undo();
        break;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  sendResponse({
    ...recorder.getState(),
    rehearsal: rehearsal.getState(),
    ok: !error,
    located,
    ...(error ? { error } : {}),
  });
  // 整页导航会卸载窗口，记录器随之销毁，天然实现“导航后清空并停止”。
  return false;
});
