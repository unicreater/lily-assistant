import { useState } from "react";

interface Props {
  onRetry: () => void;
}

export function ClaudeSetup({ onRetry }: Props) {
  const [loggingIn, setLoggingIn] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoggingIn(true);
    setError(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: "native", action: "login" });
      if (res?.ok) {
        // Login window opened, user needs to complete in browser
        setLoggingIn(false);
      } else {
        setError(res?.error || "Failed to start login");
        setLoggingIn(false);
      }
    } catch (e) {
      setError("Failed to connect to native host");
      setLoggingIn(false);
    }
  };

  const handleCheckStatus = async () => {
    setChecking(true);
    setError(null);
    await onRetry();
    setChecking(false);
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold text-lily-accent">Login to Claude</h2>
      <p className="text-sm text-lily-muted">
        Lily is connected! Now authenticate with Claude to start chatting.
      </p>

      <div className="glass-card rounded-lg p-4 space-y-3">
        <button
          onClick={handleLogin}
          disabled={loggingIn}
          className="w-full py-2.5 rounded-lg bg-lily-accent text-white font-medium hover:bg-lily-hover transition-colors disabled:opacity-50"
        >
          {loggingIn ? "Opening Terminal..." : "Open Claude Login"}
        </button>

        <p className="text-xs text-lily-muted text-center">
          Terminal will open. Follow the prompts to authenticate.
        </p>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <div className="pt-2">
        <button
          onClick={handleCheckStatus}
          disabled={checking}
          className="w-full py-2 rounded-lg border border-lily-accent/30 text-lily-accent font-medium hover:bg-lily-accent/10 transition-colors disabled:opacity-50"
        >
          {checking ? "Checking..." : "I've completed login"}
        </button>
      </div>
    </div>
  );
}
