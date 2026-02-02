import { useState, useEffect } from "react";

interface Session {
  id: string;
  title: string;
  started: string;
  lastActive?: string;
  claudeSessionId?: string;
}

interface Props {
  onResume: (sessionId: string) => void;
}

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "long" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

export function HistoryView({ onResume }: Props) {
  const [history, setHistory] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await sendNative("getHistory");
      if (res?.ok) {
        setHistory(res.history || []);
      }
    } catch (e) {
      console.error("Failed to load history:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-lily-muted text-sm">Loading history...</span>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <p className="text-lily-muted text-sm text-center">
          No chat history yet.
        </p>
        <p className="text-lily-muted text-xs text-center mt-2">
          Your conversations will appear here after you end a session.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <p className="text-xs text-lily-muted px-1 mb-2">
        Click a conversation to resume it
      </p>
      {history.map((session) => (
        <button
          key={session.id}
          onClick={() => onResume(session.id)}
          className="w-full text-left glass-card rounded-lg p-3 hover:bg-lily-accent/10 transition-colors"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <p className="text-sm text-lily-text truncate">
                {session.title || "Untitled Chat"}
              </p>
              {session.claudeSessionId && (
                <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded text-[10px] whitespace-nowrap" title="Can resume with full context">
                  ● Resumable
                </span>
              )}
            </div>
            <span className="text-xs text-lily-muted whitespace-nowrap">
              {formatDate(session.lastActive || session.started)}
            </span>
          </div>
          <p className="text-xs text-lily-muted mt-1">
            Started {formatDate(session.started)}
          </p>
        </button>
      ))}
    </div>
  );
}
