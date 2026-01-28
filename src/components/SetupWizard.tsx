import { useState } from "react";

interface Props {
  onRetry: () => void;
}

export function SetupWizard({ onRetry }: Props) {
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const extensionId = chrome.runtime.id;

  const installCmd = `curl -fsSL https://raw.githubusercontent.com/unicreater/lily-assistant/main/native-host/install.sh | bash -s ${extensionId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          <p className="text-xs text-lily-muted mb-2">
            Open Terminal and paste this command:
          </p>
          <code className="block text-xs text-lily-text break-all mb-2 leading-relaxed">{installCmd}</code>
          <button
            onClick={handleCopy}
            className="w-full py-1.5 rounded bg-lily-accent/90 text-white text-xs font-medium hover:bg-lily-hover transition-colors"
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
        </div>

        <div className="glass-card rounded-lg p-3">
          <p className="text-xs text-lily-muted">
            After it finishes, <strong className="text-lily-text">fully quit Chrome</strong> (Cmd+Q / Alt+F4) and reopen it. This is only needed once.
          </p>
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
