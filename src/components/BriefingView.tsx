import { useState } from "react";

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

export function BriefingView() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBriefing = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await sendNative("briefing");
      if (res?.ok) {
        setBriefing(res.response);
      } else {
        setError(res?.error || "Failed to get briefing");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Daily Briefing</h2>
        <button
          onClick={fetchBriefing}
          disabled={loading}
          className="text-xs px-3 py-1 rounded bg-lily-accent text-white hover:bg-lily-hover disabled:opacity-50"
        >
          {loading ? "Loading..." : briefing ? "Refresh" : "Generate"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {briefing && (
        <div className="glass-card rounded-lg p-4 text-sm whitespace-pre-wrap">
          {briefing}
        </div>
      )}
      {!briefing && !loading && (
        <p className="text-sm text-lily-muted">Click Generate to get your daily briefing.</p>
      )}
    </div>
  );
}
