import { useState } from "react";

interface Props {
  onRetry: () => void;
}

export function ClaudeSetup({ onRetry }: Props) {
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedLogin, setCopiedLogin] = useState(false);
  const [checking, setChecking] = useState(false);

  const installCmd = "npm install -g @anthropic-ai/claude-code";
  const loginCmd = "claude login";

  const copy = (text: string, setter: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  const handleRetry = async () => {
    setChecking(true);
    await onRetry();
    setChecking(false);
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold text-lily-accent">Claude CLI Setup</h2>
      <p className="text-sm text-lily-muted">
        Lily uses Claude CLI to power conversations. Let's set it up.
      </p>

      <div className="space-y-3">
        <div className="glass-card rounded-lg p-3">
          <p className="text-xs text-lily-muted mb-2">
            Step 1 — Install Claude CLI
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-lily-text flex-1 break-all">{installCmd}</code>
            <button
              onClick={() => copy(installCmd, setCopiedInstall)}
              className="text-xs px-2 py-1 rounded bg-lily-accent/90 text-white hover:bg-lily-hover shrink-0"
            >
              {copiedInstall ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="glass-card rounded-lg p-3">
          <p className="text-xs text-lily-muted mb-2">
            Step 2 — Login to Claude
          </p>
          <p className="text-[10px] text-lily-muted mb-2">
            This opens a browser window to authenticate with your Anthropic account.
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-lily-text flex-1">{loginCmd}</code>
            <button
              onClick={() => copy(loginCmd, setCopiedLogin)}
              className="text-xs px-2 py-1 rounded bg-lily-accent/90 text-white hover:bg-lily-hover shrink-0"
            >
              {copiedLogin ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="glass-card rounded-lg p-3">
          <p className="text-xs text-lily-muted">
            Step 3 — After login completes, click below
          </p>
        </div>
      </div>

      <button
        onClick={handleRetry}
        disabled={checking}
        className="w-full py-2 rounded-lg bg-lily-accent/90 text-white font-medium hover:bg-lily-hover transition-colors disabled:opacity-50"
      >
        {checking ? "Checking..." : "I've logged in to Claude"}
      </button>
    </div>
  );
}
