import { useState, useEffect, useCallback } from "react";
import type { ScenarioType } from "~lib/pageAnalyzer";
import type { ExtractedPageContext } from "~lib/contextExtractor";
import { WorkflowPreviewModal, type WorkflowStep } from "./WorkflowPreviewModal";
import { createActiveWorkflow } from "~types/workflow";

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

// Page analysis result from content script
interface PageSummary {
  title: string;
  url: string;
  domain: string;
  formCount: number;
  buttonCount: number;
  inputCount: number;
  linkCount: number;
  tableCount: number;
  scenario: {
    scenario: ScenarioType;
    confidence: number;
    matchedPatterns: string[];
  } | null;
}

interface DetectedElement {
  type: "form" | "button" | "input" | "table" | "link";
  label: string;
  selector: string;
  automatable: boolean;
}

// Scenario-based automation suggestions
interface AutomationSuggestion {
  icon: string;
  title: string;
  description: string;
  timeSaved?: string;
  isAI?: boolean;
  complexity?: number;
  triggers?: string[];
  featured?: boolean;
}

const SCENARIO_SUGGESTIONS: Record<ScenarioType, AutomationSuggestion[]> = {
  logistics: [
    { icon: "📬", title: "Auto-Extract Tracking Numbers", description: "Scan page for tracking numbers and export", timeSaved: "15 min", isAI: true, featured: true },
    { icon: "🔔", title: "Delivery Status Alerts", description: "Monitor for status changes", timeSaved: "Passive", complexity: 1 },
  ],
  social: [
    { icon: "📅", title: "Smart Post Scheduling", description: "Schedule posts at optimal times", timeSaved: "2 hr/day", isAI: true, featured: true },
    { icon: "💬", title: "Auto-Reply Templates", description: "Respond to common messages", timeSaved: "30 min" },
  ],
  prediction: [
    { icon: "📈", title: "Odds Movement Alerts", description: "Track line changes in real-time", timeSaved: "Real-time", isAI: true, featured: true },
    { icon: "🔍", title: "Arbitrage Finder", description: "Find profit opportunities", timeSaved: "Continuous" },
  ],
  ecommerce: [
    { icon: "💰", title: "Price Drop Alerts", description: "Monitor for price changes", timeSaved: "$23 avg saved", isAI: true, featured: true },
    { icon: "🏷️", title: "Auto-Apply Coupons", description: "Find and apply discount codes", timeSaved: "$12 avg saved" },
  ],
  finance: [
    { icon: "📊", title: "Portfolio Rebalancing", description: "Alert when allocations drift", timeSaved: "Daily check", isAI: true, featured: true },
    { icon: "📰", title: "Earnings Alerts", description: "News and earnings notifications", timeSaved: "Real-time" },
  ],
  dataentry: [
    { icon: "✨", title: "Smart Form Fill", description: "Auto-fill from saved profiles", timeSaved: "5 min", isAI: true, triggers: ["📝 Form detected"], featured: true },
    { icon: "📤", title: "Extract to Spreadsheet", description: "Pull page data to sheets", timeSaved: "15 min" },
  ],
  custom: [
    { icon: "🎯", title: "Point and Automate", description: "Click elements to build automation", featured: true },
    { icon: "📝", title: "Describe What You Need", description: "Tell Lily what to automate" },
  ],
};

const SCENARIO_LABELS: Record<ScenarioType, { label: string; icon: string }> = {
  logistics: { label: "Logistics", icon: "📦" },
  social: { label: "Social Media", icon: "📱" },
  prediction: { label: "Prediction", icon: "🎰" },
  ecommerce: { label: "E-Commerce", icon: "🛒" },
  finance: { label: "Finance", icon: "💹" },
  dataentry: { label: "Data Entry", icon: "📝" },
  custom: { label: "Custom", icon: "🛠️" },
};

// Components
function ComplexityDots({ level }: { level: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i <= level ? "bg-lily-accent" : "bg-lily-border"}`}
        />
      ))}
    </div>
  );
}

function AutomationCard({
  suggestion,
  onActivate
}: {
  suggestion: AutomationSuggestion;
  onActivate: (suggestion: AutomationSuggestion) => void;
}) {
  return (
    <div
      className={`glass-card rounded-xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-lily-accent relative overflow-hidden ${
        suggestion.featured ? "border-lily-accent bg-gradient-to-br from-purple-500/10 to-cyan-500/5" : ""
      }`}
    >
      {suggestion.featured && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 via-cyan-500 to-pink-500" />
      )}

      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg glass flex items-center justify-center text-lg flex-shrink-0">
          {suggestion.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-lily-text leading-tight mb-1">
            {suggestion.title}
          </h4>
          <p className="text-xs text-lily-muted leading-relaxed">
            {suggestion.description}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {suggestion.timeSaved && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-green-500/15 text-green-400">
            ⏱ {suggestion.timeSaved}
          </span>
        )}
        {suggestion.isAI && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-300">
            ✨ AI-Powered
          </span>
        )}
        {suggestion.complexity && <ComplexityDots level={suggestion.complexity} />}
      </div>

      {suggestion.triggers && (
        <div className="flex gap-2 mb-3">
          {suggestion.triggers.map((trigger, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] glass text-lily-muted">
              {trigger}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onActivate(suggestion)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30 hover:-translate-y-0.5 transition-all"
        >
          Activate
        </button>
      </div>
    </div>
  );
}

function DetectedElementCard({ element }: { element: DetectedElement }) {
  const iconMap = { form: "📝", button: "🔘", input: "✏️", table: "📊", link: "🔗" };
  return (
    <div className="flex items-center gap-3 p-3 glass-card rounded-lg">
      <div className="w-8 h-8 rounded-lg glass flex items-center justify-center text-sm">
        {iconMap[element.type]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-lily-text truncate">{element.label}</div>
        <div className="text-[10px] text-lily-muted capitalize">{element.type}</div>
      </div>
      {element.automatable && (
        <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-[10px] text-green-400">
          Automatable
        </span>
      )}
    </div>
  );
}

export function PageAnalysisView() {
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [detectedElements, setDetectedElements] = useState<DetectedElement[]>([]);
  const [highlightsActive, setHighlightsActive] = useState(false);
  const [selectedAutomation, setSelectedAutomation] = useState<AutomationSuggestion | null>(null);
  const [pageContext, setPageContext] = useState<ExtractedPageContext | null>(null);

  // Clear highlights when component unmounts or when navigating away
  useEffect(() => {
    return () => {
      clearHighlights();
    };
  }, []);

  const handleActivate = useCallback((suggestion: AutomationSuggestion) => {
    setSelectedAutomation(suggestion);
  }, []);

  const [activating, setActivating] = useState(false);

  const handleConfirmWorkflow = useCallback(async (steps: WorkflowStep[]) => {
    if (!selectedAutomation) return;
    setActivating(true);

    try {
      // Get current tab info
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const pageUrl = tab?.url || "";
      const pageTitle = tab?.title || "";

      // Create the workflow payload
      const workflow = createActiveWorkflow(
        selectedAutomation.title,
        steps,
        pageUrl,
        pageTitle,
        selectedAutomation.title,
        {
          frequency: 5, // Default 5 minute interval
          notificationChannels: { browserPush: true },
        }
      );

      console.log('[Lily] Activating workflow:', workflow);

      // Save to native host
      const result = await sendNative("activateWorkflow", { workflow });

      if (result?.ok) {
        console.log('[Lily] Workflow activated with ID:', result.id);
        setSelectedAutomation(null);
        // Show success message
        const successDiv = document.createElement("div");
        successDiv.className = "fixed bottom-4 right-4 px-4 py-2 bg-green-500/90 text-white text-sm rounded-lg shadow-lg z-[9999]";
        successDiv.textContent = `✓ Workflow activated! View in Active tab.`;
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.remove(), 3000);
      } else {
        console.error('[Lily] Failed to activate workflow:', result?.error);
        alert(`Failed to activate: ${result?.error || "Unknown error"}`);
      }
    } catch (e: any) {
      console.error('[Lily] Error activating workflow:', e);
      alert(`Error: ${e.message}`);
    } finally {
      setActivating(false);
    }
  }, [selectedAutomation]);

  const clearHighlights = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: "clearAnalysisHighlights" });
      }
      setHighlightsActive(false);
    } catch {}
  }, []);

  const analyzePage = useCallback(async () => {
    setAnalyzing(true);
    setError(null);

    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error("No active tab found");
      }

      // Clear any existing highlights first
      await chrome.tabs.sendMessage(tab.id, { type: "clearAnalysisHighlights" }).catch(() => {});

      // Call content script for page summary
      const response = await chrome.tabs.sendMessage(tab.id, { type: "getPageSummary" });

      if (!response?.ok) {
        throw new Error(response?.error || "Failed to analyze page");
      }

      setSummary(response.summary);

      // Extract full page context (currencies, percentages, symbols, etc.)
      const contextResponse = await chrome.tabs.sendMessage(tab.id, { type: "extractPageContext" });
      if (contextResponse?.ok) {
        setPageContext(contextResponse.context);
        console.log('[Lily UI] Page context extracted:', contextResponse.context);
      }

      // Get detailed page elements for highlighting
      const elementsResponse = await chrome.tabs.sendMessage(tab.id, { type: "getPageElements" });

      const elements: DetectedElement[] = [];
      const highlightTargets: Array<{ selector: string; type: string; label: string; index: number }> = [];

      if (elementsResponse?.ok && elementsResponse.elements) {
        let index = 1;
        elementsResponse.elements.forEach((el: any) => {
          elements.push({
            type: el.type,
            label: el.label,
            selector: el.selector,
            automatable: true,
          });
          highlightTargets.push({
            selector: el.selector,
            type: el.type,
            label: el.label,
            index: index++,
          });
        });
      }

      // Fallback: Also get form fields for more detail
      if (elements.length === 0) {
        const formResponse = await chrome.tabs.sendMessage(tab.id, { type: "getFormFields" });
        if (formResponse?.ok && formResponse.forms) {
          formResponse.forms.forEach((form: any) => {
            elements.push({
              type: "form",
              label: form.title || form.id || `Form with ${form.fields?.length || 0} fields`,
              selector: form.selector,
              automatable: true,
            });
          });
        }
      }

      // Show highlights on the page
      if (highlightTargets.length > 0) {
        await chrome.tabs.sendMessage(tab.id, {
          type: "showAnalysisHighlights",
          targets: highlightTargets
        });
        setHighlightsActive(true);
      }

      setDetectedElements(elements);
      setAnalyzed(true);
    } catch (e: any) {
      setError(e.message || "Failed to analyze page");
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const detectedScenario: ScenarioType = summary?.scenario?.scenario || "custom";
  const suggestions = SCENARIO_SUGGESTIONS[detectedScenario] || SCENARIO_SUGGESTIONS.custom;
  const scenarioInfo = SCENARIO_LABELS[detectedScenario];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header with Analyze Button */}
      <div className="px-4 py-3 glass border-b border-white/5 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-lily-text">Page Intelligence</h2>
          <div className="flex items-center gap-2">
            {highlightsActive && (
              <button
                onClick={clearHighlights}
                className="px-3 py-1.5 rounded-lg text-xs font-medium glass text-lily-muted hover:text-lily-text transition-all"
                title="Clear highlights from page"
              >
                Hide
              </button>
            )}
            <button
              onClick={analyzePage}
              disabled={analyzing}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                analyzing
                  ? "bg-lily-muted/20 text-lily-muted cursor-wait"
                  : "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30 hover:-translate-y-0.5"
              }`}
            >
              {analyzing ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing...
                </span>
              ) : analyzed ? (
                "Re-analyze"
              ) : (
                "🔍 Analyze Page"
              )}
            </button>
          </div>
        </div>
        {highlightsActive && (
          <div className="mt-2 text-[10px] text-green-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Highlights visible on page
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* Error State */}
        {error && (
          <div className="p-4 glass-card rounded-xl border border-red-500/30 bg-red-500/10">
            <div className="flex items-center gap-2 text-red-400">
              <span>⚠️</span>
              <span className="text-sm">{error}</span>
            </div>
            <p className="text-xs text-lily-muted mt-2">
              Make sure you're on a regular webpage (not chrome:// pages) and try again.
            </p>
          </div>
        )}

        {/* Not Analyzed State */}
        {!analyzed && !analyzing && !error && (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl glass mx-auto mb-4 flex items-center justify-center text-3xl">
              🔍
            </div>
            <h3 className="text-base font-semibold text-lily-text mb-2">
              Analyze Current Page
            </h3>
            <p className="text-sm text-lily-muted max-w-xs mx-auto mb-6">
              Click the button above to scan this page for automation opportunities, forms, and interactive elements.
            </p>
            <div className="flex flex-wrap justify-center gap-2 text-xs text-lily-muted">
              <span className="px-2 py-1 glass rounded-full">📝 Forms</span>
              <span className="px-2 py-1 glass rounded-full">🔘 Buttons</span>
              <span className="px-2 py-1 glass rounded-full">📊 Tables</span>
              <span className="px-2 py-1 glass rounded-full">🔗 Links</span>
            </div>
          </div>
        )}

        {/* Analyzing State */}
        {analyzing && (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl glass mx-auto mb-4 flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-lily-accent/30 border-t-lily-accent rounded-full animate-spin" />
            </div>
            <h3 className="text-base font-semibold text-lily-text mb-2">
              Analyzing Page...
            </h3>
            <p className="text-sm text-lily-muted">
              Scanning for forms, buttons, tables, and automation opportunities.
            </p>
          </div>
        )}

        {/* Analysis Results */}
        {analyzed && summary && (
          <>
            {/* Page Context */}
            <div className="flex items-center gap-2 px-3 py-2 glass rounded-lg text-[11px] text-lily-muted">
              <span className="text-sm">{scenarioInfo.icon}</span>
              <span className="flex-1 truncate">{summary.url}</span>
              <span className="px-2 py-0.5 rounded-full bg-lily-accent text-[10px] font-semibold text-white uppercase tracking-wider">
                {scenarioInfo.label}
              </span>
            </div>

            {/* Hero Section */}
            <div className="relative text-center py-6 px-4 glass-card rounded-xl overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-purple-500/10 to-transparent pointer-events-none" />
              <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full bg-gradient-radial from-purple-500/30 to-transparent blur-2xl" />

              <div className="relative z-10">
                <div className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent leading-none mb-1">
                  {summary.formCount + summary.buttonCount + summary.tableCount}
                </div>
                <div className="text-sm text-lily-muted mb-3">Interactive Elements Found</div>

                {summary.scenario && summary.scenario.confidence > 0.3 && (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-[13px] font-medium text-purple-300">
                    <span>✨</span>
                    <span>Detected: {scenarioInfo.label} site ({Math.round(summary.scenario.confidence * 100)}% match)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Detected Elements */}
            {detectedElements.length > 0 && (
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-lily-text mb-3">
                  Detected Elements
                </h3>
                <div className="space-y-2">
                  {detectedElements.map((el, i) => (
                    <DetectedElementCard key={i} element={el} />
                  ))}
                </div>
              </div>
            )}

            {/* Automation Suggestions */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-lily-text">
                  Suggested Automations
                </h3>
                <span className="text-[10px] text-lily-muted">
                  Based on {scenarioInfo.label}
                </span>
              </div>
              <div className="space-y-3">
                {suggestions.map((suggestion, i) => (
                  <AutomationCard key={i} suggestion={suggestion} onActivate={handleActivate} />
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-lily-text mb-3">
                Quick Actions
              </h3>
              <div className="flex flex-wrap gap-2">
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-xs text-lily-muted hover:text-lily-text hover:border-lily-accent transition-all">
                  📋 Copy Page Data
                </button>
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-xs text-lily-muted hover:text-lily-text hover:border-lily-accent transition-all">
                  📊 Export to Sheet
                </button>
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-xs text-lily-muted hover:text-lily-text hover:border-lily-accent transition-all">
                  🔄 Create Workflow
                </button>
              </div>
            </div>

            {/* Page Stats */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Forms", value: summary.formCount, icon: "📝" },
                { label: "Buttons", value: summary.buttonCount, icon: "🔘" },
                { label: "Inputs", value: summary.inputCount, icon: "✏️" },
                { label: "Tables", value: summary.tableCount, icon: "📊" },
              ].map((stat) => (
                <div key={stat.label} className="text-center p-3 glass rounded-lg">
                  <div className="text-lg mb-1">{stat.icon}</div>
                  <div className="text-lg font-bold text-lily-text">{stat.value}</div>
                  <div className="text-[10px] text-lily-muted">{stat.label}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Workflow Preview Modal */}
      {selectedAutomation && (
        <WorkflowPreviewModal
          suggestion={selectedAutomation}
          pageContext={pageContext}
          onConfirm={handleConfirmWorkflow}
          onCancel={() => setSelectedAutomation(null)}
        />
      )}
    </div>
  );
}
