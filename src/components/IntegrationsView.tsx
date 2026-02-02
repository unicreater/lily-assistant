import { useState, useEffect, useCallback } from "react";

interface McpServer {
  name: string;
  status: string;
  description?: string;
}

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: "available" | "configured" | "unavailable";
  hasReadme?: boolean;
  builtIn?: boolean;
}

interface IntegrationsViewProps {
  onStartAuthChat?: (integrationName: string, prompt: string) => void;
}

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

// Toast notification component
function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg animate-fade-in flex items-center gap-2 z-50 ${
      type === "success" ? "bg-green-500/90 text-white" : "bg-red-500/90 text-white"
    }`}>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 hover:opacity-70">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
          <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
        </svg>
      </button>
    </div>
  );
}

// Login prompts for each integration - triggers OAuth flow
const LOGIN_PROMPTS: Record<string, string> = {
  "google-workspace": "Connect to my Google account. List my recent emails to verify the connection works.",
  "atlassian": "Connect to my Atlassian account. List my recent Jira issues to verify the connection works.",
  "ms365": "Connect to my Microsoft 365 account. Show my recent emails to verify the connection works.",
  "parallel-search": "Search the web for 'hello world' to verify the connection works.",
};

// Built-in integrations that don't need MCP setup
const BUILTIN_INTEGRATIONS: Integration[] = [
  {
    id: "clipboard",
    name: "Clipboard",
    description: "Read and write clipboard content",
    icon: "📋",
    status: "available",
    builtIn: true,
  },
  {
    id: "active-tab",
    name: "Active Tab",
    description: "Read content from current browser tab",
    icon: "🌐",
    status: "available",
    builtIn: true,
  },
];

export function IntegrationsView({ onStartAuthChat }: IntegrationsViewProps) {
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [runningSetup, setRunningSetup] = useState(false);
  // Auth/setup completion flow
  const [authInProgress, setAuthInProgress] = useState(false);
  const [setupInProgress, setSetupInProgress] = useState(false);
  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      // Load MCP integrations from ~/lily/integrations/
      const res = await sendNative("listIntegrations");
      if (res?.ok) {
        // Combine MCP integrations with built-in ones
        setIntegrations([...res.integrations, ...BUILTIN_INTEGRATIONS]);
      } else {
        // Fallback to built-in only
        setIntegrations(BUILTIN_INTEGRATIONS);
      }

      // Also load MCP status for the header
      const mcpRes = await sendNative("getMcpStatus");
      if (mcpRes?.ok) {
        setMcpServers(mcpRes.servers || []);
      }
    } catch (e) {
      console.error("Failed to load integrations:", e);
      setIntegrations(BUILTIN_INTEGRATIONS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  const runSetup = async (integration: Integration) => {
    if (integration.builtIn) return;

    setRunningSetup(true);
    try {
      const res = await sendNative("runIntegrationSetup", {
        integrationId: integration.id,
      });
      if (res?.ok) {
        // Show setup in progress state
        setSetupInProgress(true);
      } else {
        console.error("Failed to run setup:", res?.error);
        setToast({ message: `Failed to run setup: ${res?.error || "Unknown error"}`, type: "error" });
      }
    } catch (e) {
      console.error("Failed to run setup:", e);
      setToast({ message: "Failed to open Terminal for setup", type: "error" });
    } finally {
      setRunningSetup(false);
    }
  };

  // Handle auth button click - opens Terminal for OAuth
  const runAuth = async (integration: Integration) => {
    setRunningSetup(true);
    try {
      const res = await sendNative("runIntegrationAuth", {
        integrationId: integration.id,
      });
      if (res?.ok) {
        // Show auth in progress state
        setAuthInProgress(true);
      } else {
        console.error("Failed to run auth:", res?.error);
        setToast({ message: `Failed to start auth: ${res?.error || "Unknown error"}`, type: "error" });
      }
    } catch (e) {
      console.error("Failed to run auth:", e);
      setToast({ message: "Failed to open Terminal for auth", type: "error" });
    } finally {
      setRunningSetup(false);
    }
  };

  // Called when user clicks "I've Connected" after OAuth
  const handleAuthComplete = async () => {
    setRunningSetup(true);
    try {
      // Refresh the persistent process to pick up new tokens
      await sendNative("refreshProcess");

      // Refresh integration status
      await loadIntegrations();

      setAuthInProgress(false);

      // Check if now connected
      const updated = integrations.find(i => i.id === selectedIntegration?.id);
      if (updated?.status === "configured" || selectedIntegration?.status === "configured") {
        setToast({ message: `${selectedIntegration?.name} connected successfully!`, type: "success" });
      } else {
        setToast({ message: "Connection refreshed. Try using the integration now.", type: "success" });
      }
    } catch (e) {
      console.error("Failed to refresh after auth:", e);
      setToast({ message: "Process refreshed. Try using the integration now.", type: "success" });
      setAuthInProgress(false);
    } finally {
      setRunningSetup(false);
    }
  };

  // Called when user clicks "I've Finished Setup"
  const handleSetupComplete = async () => {
    setRunningSetup(true);
    try {
      // Refresh process to load new MCP
      await sendNative("refreshProcess");

      // Refresh status
      await loadIntegrations();

      setSetupInProgress(false);

      // Check result
      const updatedList = await sendNative("listIntegrations");
      const updated = updatedList?.integrations?.find((i: Integration) => i.id === selectedIntegration?.id);

      if (updated?.status === "configured") {
        setToast({ message: `${selectedIntegration?.name} installed successfully!`, type: "success" });
      } else {
        setToast({ message: "Setup may not have completed. Check Terminal for errors.", type: "error" });
      }
    } catch (e) {
      console.error("Failed to refresh after setup:", e);
      setToast({ message: "Error refreshing status", type: "error" });
      setSetupInProgress(false);
    } finally {
      setRunningSetup(false);
    }
  };

  // Detail view for a selected integration
  if (selectedIntegration) {
    const isMcp = !selectedIntegration.builtIn;

    return (
      <div className="flex-1 flex flex-col min-h-0 p-4">
        <button
          onClick={() => setSelectedIntegration(null)}
          className="text-lily-muted hover:text-lily-accent text-sm flex items-center gap-1 mb-4"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path
              fillRule="evenodd"
              d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
              clipRule="evenodd"
            />
          </svg>
          Back to Integrations
        </button>

        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">{selectedIntegration.icon}</span>
          <div>
            <h3 className="text-lg font-semibold">{selectedIntegration.name}</h3>
            <p className="text-sm text-lily-muted">{selectedIntegration.description}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto glass-card rounded-lg p-4">
          {isMcp ? (
            <div className="space-y-4">
              {selectedIntegration.status === "configured" ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-green-400"></span>
                    <span className="text-green-400 text-sm font-medium">MCP Configured</span>
                  </div>

                  {authInProgress ? (
                    // Auth in progress - show "I've Connected" button
                    <>
                      <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                        <p className="text-sm text-yellow-400 font-medium mb-2">
                          Complete OAuth in your browser
                        </p>
                        <p className="text-xs text-lily-muted">
                          1. A Terminal window opened with the auth flow<br />
                          2. Follow the prompts and sign in via your browser<br />
                          3. Once complete, click the button below
                        </p>
                      </div>

                      <button
                        onClick={handleAuthComplete}
                        disabled={runningSetup}
                        className="w-full px-4 py-3 rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
                      >
                        {runningSetup ? (
                          <>
                            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Refreshing...
                          </>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                            </svg>
                            I've Connected
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => setAuthInProgress(false)}
                        className="w-full px-4 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-text transition-colors text-sm"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    // Normal state - show Connect Account button
                    <>
                      <p className="text-sm text-lily-muted">
                        The MCP server is registered. Click below to authenticate your {selectedIntegration.name} account.
                      </p>

                      <button
                        onClick={() => runAuth(selectedIntegration)}
                        disabled={runningSetup}
                        className="w-full px-4 py-3 rounded-lg bg-lily-accent text-white hover:bg-lily-hover disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd" />
                        </svg>
                        {runningSetup ? "Opening Terminal..." : "Connect Account"}
                      </button>

                      <p className="text-xs text-lily-muted">
                        This opens Terminal to complete OAuth. After signing in, click "I've Connected" to activate.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {setupInProgress ? (
                    // Setup in progress - show "I've Finished Setup" button
                    <>
                      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                        <p className="text-sm text-blue-400 font-medium mb-2">
                          Complete setup in Terminal
                        </p>
                        <p className="text-xs text-lily-muted">
                          1. A Terminal window opened with the setup script<br />
                          2. Follow the prompts to complete installation<br />
                          3. When finished, click the button below
                        </p>
                      </div>

                      <button
                        onClick={handleSetupComplete}
                        disabled={runningSetup}
                        className="w-full px-4 py-3 rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
                      >
                        {runningSetup ? (
                          <>
                            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Checking...
                          </>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                            </svg>
                            I've Finished Setup
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => setSetupInProgress(false)}
                        className="w-full px-4 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-text transition-colors text-sm"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    // Normal state - show Run Setup button
                    <>
                      <div>
                        <h4 className="text-sm font-semibold text-lily-accent mb-2">Setup Instructions</h4>
                        <p className="text-sm text-lily-muted mb-3">
                          Click the button below to open Terminal with the setup script. Follow the prompts to configure this integration.
                        </p>
                      </div>

                      <button
                        onClick={() => runSetup(selectedIntegration)}
                        disabled={runningSetup}
                        className="w-full px-4 py-3 rounded-lg bg-lily-accent text-white hover:bg-lily-hover disabled:opacity-50 transition-colors font-medium"
                      >
                        {runningSetup ? "Opening Terminal..." : "Run Setup"}
                      </button>

                      <div className="text-xs text-lily-muted space-y-1">
                        <p>The setup script will:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>Check for required dependencies</li>
                          <li>Ask for configuration options</li>
                          <li>Register the MCP server with Claude</li>
                        </ul>
                      </div>
                    </>
                  )}
                </>
              )}

              {selectedIntegration.hasReadme && (
                <div className="pt-3 border-t border-lily-border">
                  <p className="text-xs text-lily-muted">
                    For detailed documentation, see the README in ~/lily/integrations/{selectedIntegration.id}/
                  </p>
                </div>
              )}
            </div>
          ) : selectedIntegration.id === "clipboard" ? (
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-lily-accent">Clipboard Access</h4>
              <p className="text-sm">
                Clipboard integration is built-in. Use these commands:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex gap-2">
                  <code className="bg-lily-border/30 px-1 rounded">/paste</code>
                  <span className="text-lily-muted">Send clipboard content to Lily</span>
                </li>
                <li className="flex gap-2">
                  <code className="bg-lily-border/30 px-1 rounded">/copy</code>
                  <span className="text-lily-muted">Copy Lily's last response</span>
                </li>
              </ul>
              <p className="text-sm text-lily-muted">No additional setup required.</p>
            </div>
          ) : selectedIntegration.id === "active-tab" ? (
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-lily-accent">Active Tab Access</h4>
              <p className="text-sm">
                Active tab integration is built-in. Use these commands:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex gap-2">
                  <code className="bg-lily-border/30 px-1 rounded">/page</code>
                  <span className="text-lily-muted">Analyze current page content</span>
                </li>
                <li className="flex gap-2">
                  <code className="bg-lily-border/30 px-1 rounded">/summarize</code>
                  <span className="text-lily-muted">Summarize current article</span>
                </li>
              </ul>
              <p className="text-sm text-lily-muted">
                The extension will request permission to read the current tab when needed.
              </p>
            </div>
          ) : null}
        </div>

        {/* Re-run setup option for configured integrations */}
        {isMcp && selectedIntegration.status === "configured" && !authInProgress && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => runSetup(selectedIntegration)}
              disabled={runningSetup}
              className="flex-1 px-4 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-accent transition-colors text-sm"
            >
              {runningSetup ? "Opening..." : "Reconfigure"}
            </button>
            <button
              onClick={loadIntegrations}
              className="px-4 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-accent transition-colors text-sm"
            >
              Refresh Status
            </button>
          </div>
        )}

        {/* Toast notification */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    );
  }

  // Main list view
  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <span>🔌</span> Integrations
      </h2>

      <p className="text-xs text-lily-muted mb-4">
        Connect external services to give Lily more capabilities. Click on an integration to set it up.
      </p>

      {/* MCP Status Summary */}
      {mcpServers.length > 0 && (
        <div className="mb-4 p-3 glass-card rounded-lg">
          <h3 className="text-sm font-semibold mb-2 text-lily-accent">Active MCP Servers</h3>
          <div className="space-y-1">
            {mcpServers.map((server, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-green-400"></span>
                <span>{server.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Integrations list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-sm text-lily-muted text-center py-8">Loading...</div>
        ) : integrations.length === 0 ? (
          <div className="text-sm text-lily-muted text-center py-8">
            No integrations available. Check ~/lily/integrations/
          </div>
        ) : (
          <div className="space-y-2">
            {integrations.map((integration) => (
              <button
                key={integration.id}
                onClick={() => setSelectedIntegration(integration)}
                className="w-full glass-card rounded-lg p-3 text-left hover:ring-1 hover:ring-lily-accent transition-all"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{integration.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium">{integration.name}</h3>
                      {integration.status === "configured" && (
                        <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded text-[10px]">
                          Connected
                        </span>
                      )}
                      {integration.builtIn && (
                        <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded text-[10px]">
                          Built-in
                        </span>
                      )}
                      {!integration.builtIn && integration.status !== "configured" && (
                        <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px]">
                          MCP
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-lily-muted mt-0.5">{integration.description}</p>
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="w-4 h-4 text-lily-muted"
                  >
                    <path
                      fillRule="evenodd"
                      d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-xs text-lily-muted mt-4 text-center">
        Learn more about{" "}
        <a
          href="https://docs.anthropic.com/en/docs/claude-code/mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="text-lily-accent hover:underline"
        >
          MCP integrations
        </a>
      </div>

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
