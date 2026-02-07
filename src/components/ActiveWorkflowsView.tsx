import { useState, useEffect, useCallback } from "react";
import type { ActiveWorkflow, WorkflowStatus, StepStatus } from "~types/workflow";
import { WorkflowTestRunner } from "./WorkflowTestRunner";

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

const STATUS_CONFIG: Record<WorkflowStatus, { color: string; bg: string; label: string; icon: string }> = {
  pending: { color: "text-gray-400", bg: "bg-gray-500/15", label: "Pending", icon: "⏳" },
  running: { color: "text-blue-400", bg: "bg-blue-500/15", label: "Running", icon: "🔄" },
  paused: { color: "text-amber-400", bg: "bg-amber-500/15", label: "Paused", icon: "⏸️" },
  completed: { color: "text-green-400", bg: "bg-green-500/15", label: "Completed", icon: "✓" },
  failed: { color: "text-red-400", bg: "bg-red-500/15", label: "Failed", icon: "✕" },
};

const STEP_STATUS_CONFIG: Record<StepStatus, { color: string; bg: string }> = {
  pending: { color: "text-gray-400", bg: "bg-gray-500/20" },
  running: { color: "text-blue-400", bg: "bg-blue-500/20" },
  completed: { color: "text-green-400", bg: "bg-green-500/20" },
  failed: { color: "text-red-400", bg: "bg-red-500/20" },
  skipped: { color: "text-gray-500", bg: "bg-gray-500/10" },
};

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${config.bg} ${config.color}`}>
      <span>{config.icon}</span>
      {config.label}
    </span>
  );
}

interface ActiveWorkflowCardProps {
  workflow: ActiveWorkflow;
  isExpanded: boolean;
  onToggle: () => void;
  onDeactivate: () => void;
  onTest: () => void;
}

function ActiveWorkflowCard({ workflow, isExpanded, onToggle, onDeactivate, onTest }: ActiveWorkflowCardProps) {
  const completedSteps = workflow.steps.filter(s => s.status === "completed").length;
  const totalSteps = workflow.steps.length;

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      {/* Header */}
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={onToggle}
      >
        <div className="w-10 h-10 rounded-lg glass flex items-center justify-center text-lg flex-shrink-0">
          {workflow.steps[0]?.icon || "⚡"}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-lily-text truncate">
              {workflow.workflowName}
            </h4>
            <StatusBadge status={workflow.status} />
          </div>

          <div className="text-[11px] text-lily-muted truncate mb-2">
            {workflow.pageDomain} • Activated {formatRelativeTime(workflow.activatedAt)}
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-lily-border rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all"
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-lily-muted flex-shrink-0">
              {completedSteps}/{totalSteps}
            </span>
          </div>
        </div>

        <button className="text-lily-muted text-xs">
          {isExpanded ? "▼" : "▶"}
        </button>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-white/5 p-4 space-y-4">
          {/* Info */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-lily-muted">Page:</span>
              <span className="text-lily-text ml-1 truncate">{workflow.pageTitle || workflow.pageUrl}</span>
            </div>
            <div>
              <span className="text-lily-muted">Runs:</span>
              <span className="text-lily-text ml-1">{workflow.runCount}</span>
            </div>
            {workflow.lastRunAt && (
              <div>
                <span className="text-lily-muted">Last run:</span>
                <span className="text-lily-text ml-1">{formatRelativeTime(workflow.lastRunAt)}</span>
              </div>
            )}
            {workflow.error && (
              <div className="col-span-2">
                <span className="text-red-400">Error:</span>
                <span className="text-red-300 ml-1">{workflow.error}</span>
              </div>
            )}
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-lily-muted">
              Steps
            </h5>
            {workflow.steps.map((step, idx) => {
              const stepConfig = STEP_STATUS_CONFIG[step.status];
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-2 p-2 rounded-lg ${stepConfig.bg}`}
                >
                  <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-lily-muted">
                    {idx + 1}
                  </span>
                  <span className="text-sm">{step.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-medium ${stepConfig.color}`}>
                      {step.action}
                    </div>
                    {step.error && (
                      <div className="text-[10px] text-red-400 truncate">{step.error}</div>
                    )}
                  </div>
                  <span className={`text-[10px] ${stepConfig.color}`}>
                    {step.status === "completed" ? "✓" : step.status === "failed" ? "✕" : ""}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={(e) => { e.stopPropagation(); onTest(); }}
              className="flex-1 px-3 py-2 rounded-lg glass text-xs font-medium text-lily-text hover:bg-white/10 transition-colors"
            >
              🧪 Test
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDeactivate(); }}
              className="px-3 py-2 rounded-lg glass text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Deactivate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ActiveWorkflowsView() {
  const [workflows, setWorkflows] = useState<ActiveWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingWorkflow, setTestingWorkflow] = useState<ActiveWorkflow | null>(null);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sendNative("listActiveWorkflows");
      if (res?.ok) {
        setWorkflows(res.workflows || []);
      }
    } catch (e) {
      console.error("Failed to load active workflows:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleDeactivate = async (id: string) => {
    const confirmed = window.confirm("Deactivate this workflow? It will stop monitoring.");
    if (!confirmed) return;

    try {
      const res = await sendNative("deactivateWorkflow", { id });
      if (res?.ok) {
        loadWorkflows();
      }
    } catch (e) {
      console.error("Failed to deactivate workflow:", e);
    }
  };

  const handleTest = async (workflow: ActiveWorkflow) => {
    // Open the WorkflowTestRunner modal
    setTestingWorkflow(workflow);
  };

  // Group by status
  const running = workflows.filter(w => w.status === "running");
  const pending = workflows.filter(w => w.status === "pending");
  const paused = workflows.filter(w => w.status === "paused");
  const completed = workflows.filter(w => w.status === "completed");
  const failed = workflows.filter(w => w.status === "failed");

  const groups = [
    { title: "Running", workflows: running, icon: "🔄" },
    { title: "Pending", workflows: pending, icon: "⏳" },
    { title: "Paused", workflows: paused, icon: "⏸️" },
    { title: "Completed", workflows: completed, icon: "✓" },
    { title: "Failed", workflows: failed, icon: "✕" },
  ].filter(g => g.workflows.length > 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Test Runner Modal */}
      {testingWorkflow && (
        <WorkflowTestRunner
          workflow={testingWorkflow}
          onClose={() => setTestingWorkflow(null)}
        />
      )}

      {/* Header */}
      <div className="px-4 py-3 glass border-b border-white/5 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-lily-text">Active Workflows</h2>
          <button
            onClick={loadWorkflows}
            className="px-3 py-1.5 rounded-lg text-xs font-medium glass text-lily-muted hover:text-lily-text transition-all"
          >
            Refresh
          </button>
        </div>
        {workflows.length > 0 && (
          <div className="mt-2 text-[10px] text-lily-muted">
            {workflows.length} workflow{workflows.length !== 1 ? "s" : ""} • {running.length} running
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {loading ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl glass mx-auto mb-4 flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-lily-accent/30 border-t-lily-accent rounded-full animate-spin" />
            </div>
            <h3 className="text-base font-semibold text-lily-text mb-2">Loading...</h3>
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl glass mx-auto mb-4 flex items-center justify-center text-3xl">
              📋
            </div>
            <h3 className="text-base font-semibold text-lily-text mb-2">No Active Workflows</h3>
            <p className="text-sm text-lily-muted max-w-xs mx-auto">
              Activate a workflow from the Page Intelligence tab to start tracking.
            </p>
          </div>
        ) : (
          <>
            {groups.map(group => (
              <div key={group.title}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-lily-muted mb-2 flex items-center gap-1.5">
                  <span>{group.icon}</span>
                  {group.title} ({group.workflows.length})
                </h3>
                <div className="space-y-2">
                  {group.workflows.map(workflow => (
                    <ActiveWorkflowCard
                      key={workflow.id}
                      workflow={workflow}
                      isExpanded={expandedId === workflow.id}
                      onToggle={() => setExpandedId(expandedId === workflow.id ? null : workflow.id)}
                      onDeactivate={() => handleDeactivate(workflow.id)}
                      onTest={() => handleTest(workflow)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
