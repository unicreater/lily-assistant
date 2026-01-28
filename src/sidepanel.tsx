import { useEffect, useState } from "react";
import { ChatView } from "~components/ChatView";
import { SetupWizard } from "~components/SetupWizard";
import { StatusIndicator } from "~components/StatusIndicator";

import "~style.css";

type View = "loading" | "setup" | "chat";

function SidePanel() {
  const [view, setView] = useState<View>("loading");
  const [connected, setConnected] = useState(false);
  const [hostInfo, setHostInfo] = useState<any>(null);

  const checkConnection = async () => {
    console.log("[Lily SidePanel] checkConnection called");
    try {
      console.log("[Lily SidePanel] sending ping...");
      const res = await chrome.runtime.sendMessage({ type: "native", action: "ping" });
      console.log("[Lily SidePanel] ping response:", JSON.stringify(res));
      if (res?.ok) {
        setConnected(true);
        setHostInfo(res);
        setView("chat");
      } else {
        setConnected(false);
        setView("setup");
      }
    } catch (err: any) {
      console.error("[Lily SidePanel] ping error:", err?.message || err);
      setConnected(false);
      setView("setup");
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  return (
    <div className="min-h-screen bg-lily-bg text-lily-text font-sans flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 glass border-b-0">
        <h1 className="text-lg font-semibold">Lily</h1>
        <StatusIndicator connected={connected} />
      </header>
      <main className="flex-1 overflow-y-auto">
        {view === "loading" && (
          <div className="flex items-center justify-center h-64">
            <span className="text-lily-muted">Connecting...</span>
          </div>
        )}
        {view === "setup" && <SetupWizard onRetry={checkConnection} />}
        {view === "chat" && <ChatView />}
      </main>
    </div>
  );
}

export default SidePanel;
