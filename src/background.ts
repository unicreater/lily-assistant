// Background service worker -- native messaging bridge
const HOST_NAME = "com.lily.host";
const TIMEOUT_MS = 180000; // 3 minutes for longer responses

type StreamCallback = (chunk: string) => void;
type EventCallback = (event: any) => void;

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
  onStream?: StreamCallback;
  onEvent?: EventCallback;
  accumulated?: string; // For streaming responses
};

let port: chrome.runtime.Port | null = null;
const pending = new Map<string, PendingRequest>();
let reqCounter = 0;

function connect(): chrome.runtime.Port {
  if (port) return port;

  console.log("[Lily] Connecting to native host:", HOST_NAME);
  const newPort = chrome.runtime.connectNative(HOST_NAME);

  newPort.onMessage.addListener((msg: any) => {
    console.log("[Lily] Native message received:", JSON.stringify(msg).slice(0, 200));
    const { id, type, chunk, status, tool, event, ...rest } = msg;
    const entry = pending.get(id);
    if (!entry) return;

    // Handle rich Claude events (new persistent process mode)
    if (type === "claude-event" && event) {
      if (entry.onEvent) {
        entry.onEvent(event);
      }

      // Also extract text for legacy streaming support
      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            entry.accumulated = (entry.accumulated || "") + block.text;
            if (entry.onStream) {
              entry.onStream(block.text);
            }
          }
          // Report tool usage
          if (block.type === "tool_use" && entry.onStream) {
            entry.onStream(`__STATUS__${JSON.stringify({ status: "tool", tool: block.name })}__STATUS__`);
          }
        }
      }

      // Capture final result
      if (event.type === "result") {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve({ ok: true, response: event.result, type: "done", ...rest });
        return;
      }

      // Handle errors
      if (event.type === "error" || event.type === "cancelled") {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve({ ok: false, cancelled: event.type === "cancelled", error: event.error || "Cancelled" });
        return;
      }

      return; // Don't resolve yet for other event types
    }

    // Handle stderr messages (for debugging)
    if (type === "claude-stderr") {
      console.warn("[Lily] Claude stderr:", msg.text);
      return;
    }

    // Handle legacy streaming chunks
    if (type === "stream" && chunk) {
      entry.accumulated = (entry.accumulated || "") + chunk;
      if (entry.onStream) {
        entry.onStream(chunk);
      }
      return; // Don't resolve yet, wait for "done"
    }

    // Handle status updates (tool usage, thinking, etc.)
    if (type === "status") {
      if (entry.onStream) {
        // Send status as a special marker
        entry.onStream(`__STATUS__${JSON.stringify({ status, tool })}__STATUS__`);
      }
      return; // Don't resolve yet
    }

    // Handle completion (type === "done" or no type for non-streaming)
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(rest);
  });

  newPort.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || "Native host disconnected";
    console.error("[Lily] Native host disconnected:", error);
    console.error("[Lily] Extension ID:", chrome.runtime.id);
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

async function sendNative(
  action: string,
  payload: any = {},
  onStream?: StreamCallback,
  onEvent?: EventCallback
): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = `req_${++reqCounter}_${Date.now()}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Native host timeout (180s)"));
    }, TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer, onStream, onEvent, accumulated: "" });

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
console.log("[Lily BG] Extension ID:", chrome.runtime.id);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[Lily BG] Received message:", JSON.stringify(msg).slice(0, 200));
  if (msg?.type === "native") {
    // For streaming chat, we need to forward chunks back to the tab
    const streamCallback: StreamCallback | undefined =
      msg.payload?.stream && sender.tab?.id
        ? (chunk: string) => {
            chrome.tabs.sendMessage(sender.tab!.id!, {
              type: "streamChunk",
              chunk,
            });
          }
        : msg.payload?.stream
          ? (chunk: string) => {
              // For side panel (no tab id), broadcast to all extension views
              chrome.runtime.sendMessage({
                type: "streamChunk",
                chunk,
              }).catch(() => {}); // Ignore if no listeners
            }
          : undefined;

    // For streaming chat, also forward rich events
    const eventCallback: EventCallback | undefined =
      msg.payload?.stream
        ? (event: any) => {
            // Broadcast Claude events to all extension views
            chrome.runtime.sendMessage({
              type: "claudeEvent",
              event,
            }).catch(() => {}); // Ignore if no listeners
          }
        : undefined;

    sendNative(msg.action, msg.payload, streamCallback, eventCallback)
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
