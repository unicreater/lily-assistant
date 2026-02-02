import { useState, useEffect, useCallback } from "react";

interface Workflow {
  filename: string;
  name: string;
  description: string;
  steps: number;
  createdAt: string;
  lastRun?: string;
}

interface WorkflowDetail {
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
  lastRun?: string;
}

interface WorkflowStep {
  action: string;
  selector?: string;
  value?: string;
  url?: string;
  wait?: number;
}

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

type RecordingPhase = "idle" | "recording" | "review";

export function WorkflowsView() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDetail | null>(null);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle");
  const [recordingSteps, setRecordingSteps] = useState<WorkflowStep[]>([]);
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sendNative("listWorkflows");
      if (res?.ok) {
        setWorkflows(res.workflows || []);
      }
    } catch (e) {
      console.error("Failed to load workflows:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const loadWorkflowDetail = async (filename: string) => {
    try {
      const res = await sendNative("getWorkflow", { filename });
      if (res?.ok) {
        setWorkflowDetail(res.workflow);
        setSelectedWorkflow(filename);
      }
    } catch (e) {
      console.error("Failed to load workflow:", e);
    }
  };

  const deleteWorkflow = async (filename: string) => {
    const confirmed = window.confirm(`Delete workflow "${filename}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const res = await sendNative("deleteWorkflow", { filename });
      if (res?.ok) {
        setSelectedWorkflow(null);
        setWorkflowDetail(null);
        loadWorkflows();
      }
    } catch (e) {
      console.error("Failed to delete workflow:", e);
    }
  };

  const startRecording = () => {
    setRecordingPhase("recording");
    setRecordingSteps([]);
    setWorkflowName("");
    setWorkflowDescription("");
    // TODO: Send message to content script to start recording
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "startRecording" });
      }
    });
  };

  const stopRecording = async () => {
    // Get recorded steps from content script
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "stopRecording" }, async (response) => {
          const steps = response?.steps || [];
          setRecordingSteps(steps);
          setRecordingPhase("review");
        });
      } else {
        // No active tab - just go to review with empty steps
        setRecordingPhase("review");
      }
    });
  };

  const saveRecordedWorkflow = async () => {
    if (!workflowName.trim()) {
      alert("Please enter a workflow name");
      return;
    }

    const workflow: WorkflowDetail = {
      name: workflowName.trim(),
      description: workflowDescription.trim(),
      steps: recordingSteps,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const filename = workflowName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") + ".json";
    await sendNative("saveWorkflow", { filename, workflow });
    loadWorkflows();
    cancelRecording();
  };

  const cancelRecording = () => {
    setRecordingPhase("idle");
    setRecordingSteps([]);
    setWorkflowName("");
    setWorkflowDescription("");
  };

  const removeStep = (index: number) => {
    setRecordingSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const runWorkflow = async (filename: string) => {
    // TODO: Implement workflow playback via content script
    alert("Workflow playback coming soon!\n\nThis will replay the recorded steps on the current page.");
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "click":
        return "🖱️";
      case "fill":
      case "type":
        return "⌨️";
      case "navigate":
        return "🔗";
      case "wait":
        return "⏳";
      case "scroll":
        return "📜";
      default:
        return "▶️";
    }
  };

  if (selectedWorkflow && workflowDetail) {
    return (
      <div className="flex-1 flex flex-col min-h-0 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => {
              setSelectedWorkflow(null);
              setWorkflowDetail(null);
            }}
            className="text-lily-muted hover:text-lily-accent text-sm flex items-center gap-1"
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
            Back
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => runWorkflow(selectedWorkflow)}
              className="px-3 py-1.5 rounded-lg bg-lily-accent text-white text-xs hover:bg-lily-hover"
            >
              ▶️ Run
            </button>
            <button
              onClick={() => deleteWorkflow(selectedWorkflow)}
              className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-red-400"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Workflow info */}
        <div className="mb-4">
          <h3 className="text-lg font-semibold">{workflowDetail.name}</h3>
          <p className="text-xs text-lily-muted">
            Created {formatDate(workflowDetail.createdAt)} •{" "}
            {workflowDetail.steps.length} step{workflowDetail.steps.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-2">
            {workflowDetail.steps.map((step, i) => (
              <div key={i} className="glass-card rounded-lg p-3 flex items-start gap-3">
                <span className="text-lg">{getActionIcon(step.action)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium capitalize">{step.action}</div>
                  {step.selector && (
                    <div className="text-xs text-lily-muted truncate" title={step.selector}>
                      {step.selector}
                    </div>
                  )}
                  {step.value && (
                    <div className="text-xs text-lily-accent truncate" title={step.value}>
                      "{step.value}"
                    </div>
                  )}
                  {step.url && (
                    <div className="text-xs text-blue-400 truncate" title={step.url}>
                      {step.url}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Review phase - show recorded steps before saving
  if (recordingPhase === "review") {
    return (
      <div className="flex-1 flex flex-col min-h-0 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>🎬</span> Review Recording
          </h2>
          <button
            onClick={cancelRecording}
            className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-accent"
          >
            Cancel
          </button>
        </div>

        {/* Workflow name & description */}
        <div className="space-y-3 mb-4">
          <input
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            placeholder="Workflow name..."
            className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
          />
          <input
            type="text"
            value={workflowDescription}
            onChange={(e) => setWorkflowDescription(e.target.value)}
            placeholder="Description (optional)..."
            className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
          />
        </div>

        {/* Recorded steps */}
        <div className="flex-1 overflow-y-auto mb-4">
          {recordingSteps.length === 0 ? (
            <div className="text-sm text-lily-muted text-center py-8">
              No steps recorded.
              <br />
              <span className="text-xs">Recording may not have captured any actions.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-lily-muted mb-2">
                {recordingSteps.length} step{recordingSteps.length !== 1 ? "s" : ""} recorded. Click X to remove a step.
              </p>
              {recordingSteps.map((step, i) => (
                <div key={i} className="glass-card rounded-lg p-3 flex items-start gap-3">
                  <span className="text-lg">{getActionIcon(step.action)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium capitalize">{step.action}</div>
                    {step.selector && (
                      <div className="text-xs text-lily-muted truncate" title={step.selector}>
                        {step.selector}
                      </div>
                    )}
                    {step.value && (
                      <div className="text-xs text-lily-accent truncate" title={step.value}>
                        "{step.value}"
                      </div>
                    )}
                    {step.url && (
                      <div className="text-xs text-blue-400 truncate" title={step.url}>
                        {step.url}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => removeStep(i)}
                    className="text-lily-muted hover:text-red-400"
                    title="Remove step"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                      <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Save button */}
        <div className="flex gap-2">
          <button
            onClick={saveRecordedWorkflow}
            disabled={!workflowName.trim()}
            className="flex-1 px-4 py-2 rounded-lg bg-lily-accent text-white hover:bg-lily-hover disabled:opacity-50 transition-colors font-medium"
          >
            Save Workflow
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>🎬</span> Workflows
        </h2>
        {recordingPhase === "recording" ? (
          <button
            onClick={stopRecording}
            className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs hover:bg-red-600 animate-pulse"
          >
            ⏹️ Stop Recording
          </button>
        ) : (
          <button
            onClick={startRecording}
            className="px-3 py-1.5 rounded-lg bg-lily-accent text-white text-xs hover:bg-lily-hover"
          >
            ⏺️ Record
          </button>
        )}
      </div>

      {recordingPhase === "recording" && (
        <div className="mb-4 p-4 glass-card rounded-lg border border-red-500/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
            <span className="text-sm font-medium">Recording...</span>
          </div>
          <p className="text-xs text-lily-muted">
            Perform actions on the webpage. Click "Stop Recording" when done.
          </p>
          {recordingSteps.length > 0 && (
            <div className="mt-2 text-xs text-lily-muted">
              {recordingSteps.length} step{recordingSteps.length !== 1 ? "s" : ""} recorded
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-lily-muted mb-4">
        Record browser actions and replay them later. Useful for repetitive tasks.
      </p>

      {/* Workflows list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-sm text-lily-muted text-center py-8">Loading...</div>
        ) : workflows.length === 0 ? (
          <div className="text-sm text-lily-muted text-center py-8">
            No workflows yet. Click "Record" to create one.
            <br />
            <span className="text-xs">Or use /record in chat.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {workflows.map((workflow) => (
              <button
                key={workflow.filename}
                onClick={() => loadWorkflowDetail(workflow.filename)}
                className="w-full glass-card rounded-lg p-3 text-left hover:ring-1 hover:ring-lily-accent transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-medium">{workflow.name}</h3>
                    <p className="text-xs text-lily-muted mt-0.5">
                      {workflow.steps} step{workflow.steps !== 1 ? "s" : ""} •
                      Created {formatDate(workflow.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      runWorkflow(workflow.filename);
                    }}
                    className="px-2 py-1 rounded glass text-xs text-lily-accent hover:bg-lily-accent/20"
                    title="Run workflow"
                  >
                    ▶️
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-xs text-lily-muted mt-4 text-center">
        Workflows are stored in ~/lily/workflows/
      </div>
    </div>
  );
}
