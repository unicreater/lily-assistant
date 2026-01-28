import { useState, useRef, useEffect } from "react";
import { BriefingView } from "~components/BriefingView";
import { GoalsView } from "~components/GoalsView";

interface Message {
  role: "user" | "assistant";
  text: string;
}

type Tab = "chat" | "briefing" | "goals";

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

export function ChatView() {
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    try {
      const res = await sendNative("chat", { text });
      if (res?.ok) {
        setMessages((prev) => [...prev, { role: "assistant", text: res.response }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${res?.error || "Unknown"}` }]);
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "briefing", label: "Briefing" },
    { key: "goals", label: "Goals" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-lily-border glass">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "text-lily-accent border-b-2 border-lily-accent"
                : "text-lily-muted hover:text-lily-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "briefing" && <BriefingView />}
      {tab === "goals" && <GoalsView />}

      {tab === "chat" && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-sm text-lily-muted text-center mt-8">
                Send a message to start talking with Lily.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-lg p-3 text-sm ${
                  m.role === "user"
                    ? "glass-card ml-8"
                    : "glass mr-8"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            ))}
            {loading && (
              <div className="glass mr-8 rounded-lg p-3 text-sm text-lily-muted">
                Thinking...
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-3 glass border-t-0">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Lily..."
                rows={1}
                className="flex-1 glass-card text-lily-text rounded-lg px-3 py-2 text-sm resize-none outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="px-4 py-2 rounded-lg bg-lily-accent text-white text-sm font-medium hover:bg-lily-hover disabled:opacity-50 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
