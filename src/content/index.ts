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
  let result: ReturnType<FocusRecorder['getState']>;
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
      if (recorder.getState().preview.phase === 'active') {
        return sendResponse({
          ...recorder.getState(),
          ok: false,
          error: '预演仍在生效，请先撤销后再清空，避免丢失恢复信息。',
        });
      }
      recorder.clear();
      break;
    case 'LOCATE':
      return sendResponse({ ...recorder.getState(), ok: true, located: recorder.locate(message.seq) });
    case 'PREVIEW_ADD': {
      const previewResult = recorder.addPreviewEntry(message.entry);
      return sendResponse({ ...recorder.getState(), preview: previewResult.state, ok: !previewResult.error, error: previewResult.error });
    }
    case 'PREVIEW_UPDATE': {
      const previewResult = recorder.updatePreviewEntry(message.id, message.entry);
      return sendResponse({ ...recorder.getState(), preview: previewResult.state, ok: !previewResult.error, error: previewResult.error });
    }
    case 'PREVIEW_DELETE': {
      const previewResult = recorder.deletePreviewEntry(message.id);
      return sendResponse({ ...recorder.getState(), preview: previewResult.state, ok: !previewResult.error, error: previewResult.error });
    }
    case 'PREVIEW_APPLY': {
      const previewResult = recorder.applyPreview();
      return sendResponse({ ...recorder.getState(), preview: previewResult.state, ok: !previewResult.error, error: previewResult.error });
    }
    case 'PREVIEW_UNDO': {
      const previewResult = recorder.undoPreview();
      return sendResponse({ ...recorder.getState(), preview: previewResult.state, ok: !previewResult.error, error: previewResult.error });
    }
  }
  result = recorder.getState();
  const response: RuntimeResponse = { ...result, ok: true };
  sendResponse(response);
  // 整页导航会卸载窗口，记录器随之销毁，天然实现“导航后清空并停止”。
  return false;
});
