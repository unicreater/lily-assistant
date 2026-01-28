import { useState } from "react";

interface Props {
  onRetry: () => void;
}

export function SetupWizard({ onRetry }: Props) {
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [checking, setChecking] = useState(false);
  const extensionId = chrome.runtime.id;

  const installCmd = `curl -fsSL https://raw.githubusercontent.com/unicreater/lily-assistant/main/native-host/install.sh | bash`;

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
      <h2 className="text-lg font-semibold text-lily-accent">Setup Required</h2>
      <p className="text-sm text-lily-muted">
        Lily needs a local bridge to connect to Claude. This takes about 1 minute.
      </p>

      <div className="space-y-3">
        <div className="glass-card rounded-lg p-3">
          <p className="text-xs text-lily-muted mb-1">Step 1 — Open Terminal and run this</p>
          <p className="text-[10px] text-lily-muted mb-2">
            Downloads and installs the Lily native host. Requires Node.js and Claude CLI.
          </p>
          <div className="flex items-start gap-2">
            <code className="text-xs text-lily-text flex-1 break-all">{installCmd}</code>
            <button
              onClick={() => copy(installCmd, setCopiedInstall)}
              className="text-xs px-2 py-1 rounded bg-lily-accent/90 text-white hover:bg-lily-hover shrink-0"
            >
              {copiedInstall ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="glass-card rounded-lg p-3">
          <p className="text-xs text-lily-muted mb-1">Step 2 — When prompted, paste your Extension ID</p>
          <div className="flex items-center gap-2">
            <code className="text-sm text-lily-accent select-all flex-1">{extensionId}</code>
            <button
              onClick={() => copy(extensionId, setCopiedId)}
              className="text-xs px-2 py-1 rounded bg-lily-accent/90 text-white hover:bg-lily-hover shrink-0"
            >
              {copiedId ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="glass-card rounded-lg p-3">
          <p className="text-xs text-lily-muted">Step 3 — Restart Chrome, then click below</p>
        </div>
      </div>

      <button
        onClick={handleRetry}
        disabled={checking}
        className="w-full py-2 rounded-lg bg-lily-accent/90 text-white font-medium hover:bg-lily-hover transition-colors disabled:opacity-50"
      >
        {checking ? "Checking..." : "Retry Connection"}
      </button>
    </div>
  );
}
