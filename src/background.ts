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

  const newPort = chrome.runtime.connectNative(HOST_NAME);

  newPort.onMessage.addListener((msg: any) => {
    const { id, ...rest } = msg;
    const entry = pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve(rest);
    }
  });

  newPort.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || "Native host disconnected";
    console.error("[Lily] Native host disconnected:", error);
    // Reject all pending requests
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(error));
    }
    pending.clear();
    port = null;
  });

  port = newPort;
  return port;
}

async function sendNative(action: string, payload: any = {}): Promise<any> {
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
    } catch (e: any) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }

    // If the port disconnected synchronously during connect(),
    // the pending map is already cleared and reject was called.
    // But if it happens in the next microtask, we need a safety check.
    setTimeout(() => {
      if (pending.has(id) && !port) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error("Native host connection failed"));
      }
    }, 100);
  });
}

// Listen for messages from side panel
console.log("[Lily BG] Background script loaded");

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  console.log("[Lily BG] Received message:", JSON.stringify(msg));
  if (msg?.type === "native") {
    sendNative(msg.action, msg.payload)
      .then((result) => {
        sendResponse(result);
      })
      .catch((err) => {
        console.error("[Lily] sendNative error:", err.message);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // keep channel open for async response
  }
});

// Open side panel on action click
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });

export {};
