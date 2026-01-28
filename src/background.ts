// Background service worker -- native messaging bridge
const HOST_NAME = "com.lily.host";

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

let port: chrome.runtime.Port | null = null;
const pending = new Map<string, PendingRequest>();
let reqCounter = 0;

function connect(): chrome.runtime.Port {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);

  port.onMessage.addListener((msg: any) => {
    const { id, ...rest } = msg;
    const entry = pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve(rest);
    }
  });

  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || "Native host disconnected";
    // Reject all pending
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(error));
    }
    pending.clear();
    port = null;
  });

  return port;
}

function sendNative(action: string, payload: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = `req_${++reqCounter}_${Date.now()}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Native host timeout (65s)"));
    }, 65000);

    pending.set(id, { resolve, reject, timer });

    try {
      const p = connect();
      p.postMessage({ id, action, payload });
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}

// Listen for messages from side panel
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "native") {
    sendNative(msg.action, msg.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

// Open side panel on action click
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });

export {};
