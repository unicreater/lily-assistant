import { useEffect, useState } from "react";
import { ChatView } from "~components/ChatView";
import { ClaudeSetup } from "~components/ClaudeSetup";
import { OnboardingFlow } from "~components/OnboardingFlow";
import { SetupWizard } from "~components/SetupWizard";
import { StatusIndicator } from "~components/StatusIndicator";

import "~style.css";

type View = "loading" | "setup" | "claude-setup" | "onboarding" | "chat";

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

function SidePanel() {
  const [view, setView] = useState<View>("loading");
  const [connected, setConnected] = useState(false);
  const [hostInfo, setHostInfo] = useState<any>(null);

  const checkConnection = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "native", action: "ping" });
      if (res?.ok) {
        setConnected(true);
        setHostInfo(res);
        // Check Claude CLI installation and authentication
        if (!res.claudePath) {
          // CLI not installed - show setup wizard
          setView("setup");
        } else if (!res.authenticated) {
          // CLI installed but not authenticated - show login
          setView("claude-setup");
        } else {
          // Check if user has completed onboarding
          const onboardRes = await sendNative("hasOnboarded");
          if (onboardRes?.ok && !onboardRes.onboarded) {
            setView("onboarding");
          } else {
            // All good - show chat
            setView("chat");
          }
        }
      } else {
        setConnected(false);
        setView("setup");
      }
    } catch {
      setConnected(false);
      setView("setup");
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  return (
    <div className="h-screen bg-lily-bg text-lily-text font-sans flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 glass border-b-0">
        <h1 className="text-lg font-semibold">Lily</h1>
        <StatusIndicator connected={connected} />
      </header>
      <main className="flex-1 flex flex-col min-h-0">
        {view === "loading" && (
          <div className="flex items-center justify-center h-64">
            <span className="text-lily-muted">Connecting...</span>
          </div>
        )}
        {view === "setup" && <SetupWizard onRetry={checkConnection} />}
        {view === "claude-setup" && <ClaudeSetup onRetry={checkConnection} />}
        {view === "onboarding" && <OnboardingFlow onComplete={() => setView("chat")} />}
        {view === "chat" && <ChatView />}
      </main>
    </div>
  );
}

export default SidePanel;
