import { useState, useCallback } from "react";
import type { ActiveWorkflow, ActiveWorkflowStep, TestStepResult } from "~types/workflow";

interface WorkflowTestRunnerProps {
  workflow: ActiveWorkflow;
  onClose: () => void;
}

type StepTestState = 'idle' | 'running' | 'success' | 'error';

interface StepState {
  state: StepTestState;
  result?: any;
  error?: string;
  duration?: number;
}

export function WorkflowTestRunner({ workflow, onClose }: WorkflowTestRunnerProps) {
  const [stepStates, setStepStates] = useState<Record<string, StepState>>({});
  const [testingAll, setTestingAll] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);

  const executeStep = useCallback(async (step: ActiveWorkflowStep): Promise<TestStepResult> => {
    const startTime = Date.now();

    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        throw new Error("No active tab found");
      }

      // Check if we're on the correct page
      const currentUrl = tab.url || "";
      const workflowDomain = new URL(workflow.pageUrl).hostname;
      const currentDomain = new URL(currentUrl).hostname;

      if (currentDomain !== workflowDomain) {
        throw new Error(`Navigate to ${workflowDomain} first`);
      }

      // Send message to content script to execute the step
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "executeWorkflowStep",
        step: {
          id: step.id,
          action: step.action,
          description: step.description,
          mechanics: step.mechanics,
        },
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Step execution failed");
      }

      return {
        stepId: step.id,
        success: true,
        result: response.result,
        extractedData: response.extractedData,
        duration: Date.now() - startTime,
      };
    } catch (e: any) {
      return {
        stepId: step.id,
        success: false,
        error: e.message,
        duration: Date.now() - startTime,
      };
    }
  }, [workflow.pageUrl]);

  const testStep = useCallback(async (step: ActiveWorkflowStep) => {
    setStepStates(prev => ({
      ...prev,
      [step.id]: { state: 'running' },
    }));

    const result = await executeStep(step);

    setStepStates(prev => ({
      ...prev,
      [step.id]: {
        state: result.success ? 'success' : 'error',
        result: result.extractedData || result.result,
        error: result.error,
        duration: result.duration,
      },
    }));

    return result;
  }, [executeStep]);

  const testAllSteps = useCallback(async () => {
    setTestingAll(true);

    // Reset all states
    setStepStates({});

    for (let i = 0; i < workflow.steps.length; i++) {
      setCurrentStepIndex(i);
      const step = workflow.steps[i];
      const result = await testStep(step);

      // If a step fails, stop execution
      if (!result.success) {
        break;
      }

      // Small delay between steps for visual feedback
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    setCurrentStepIndex(null);
    setTestingAll(false);
  }, [workflow.steps, testStep]);

  const getStepStateConfig = (state: StepTestState) => {
    switch (state) {
      case 'running':
        return { icon: '🔄', color: 'text-blue-400', bg: 'bg-blue-500/15' };
      case 'success':
        return { icon: '✓', color: 'text-green-400', bg: 'bg-green-500/15' };
      case 'error':
        return { icon: '✕', color: 'text-red-400', bg: 'bg-red-500/15' };
      default:
        return { icon: '', color: 'text-gray-400', bg: 'bg-gray-500/10' };
    }
  };

  const allPassed = workflow.steps.every(s => stepStates[s.id]?.state === 'success');
  const anyTested = Object.keys(stepStates).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md glass-card rounded-2xl overflow-hidden shadow-2xl shadow-purple-500/20 border border-white/10 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl glass flex items-center justify-center text-xl">
              🧪
            </div>
            <div>
              <h3 className="text-base font-semibold text-lily-text">
                Test Workflow
              </h3>
              <p className="text-xs text-lily-muted">{workflow.workflowName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg glass flex items-center justify-center text-lily-muted hover:text-lily-text transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 custom-scrollbar">
          {/* Instructions */}
          <div className="text-xs text-lily-muted mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <span className="text-amber-400 font-medium">Note:</span> Make sure you're on{" "}
            <span className="text-lily-text font-medium">{workflow.pageDomain}</span>{" "}
            before testing.
          </div>

          {/* Steps List */}
          <div className="space-y-2">
            {workflow.steps.map((step, index) => {
              const stepState = stepStates[step.id] || { state: 'idle' as StepTestState };
              const config = getStepStateConfig(stepState.state);
              const isCurrentStep = testingAll && currentStepIndex === index;

              return (
                <div
                  key={step.id}
                  className={`rounded-xl glass overflow-hidden transition-all ${
                    isCurrentStep ? 'ring-2 ring-blue-500' : ''
                  }`}
                >
                  {/* Step Row */}
                  <div className="flex items-start gap-3 p-3">
                    {/* Step number */}
                    <div className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold ${
                      stepState.state === 'success' ? 'bg-green-500' :
                      stepState.state === 'error' ? 'bg-red-500' :
                      stepState.state === 'running' ? 'bg-blue-500' :
                      'bg-gradient-to-br from-purple-500 to-pink-500'
                    }`}>
                      {stepState.state === 'running' ? (
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : stepState.state === 'success' ? (
                        '✓'
                      ) : stepState.state === 'error' ? (
                        '✕'
                      ) : (
                        index + 1
                      )}
                    </div>

                    {/* Step icon */}
                    <div className="flex-shrink-0 w-7 h-7 rounded-lg glass flex items-center justify-center text-sm">
                      {step.icon}
                    </div>

                    {/* Step content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-lily-text leading-tight">
                        {step.action}
                      </div>
                      <div className="text-[11px] text-lily-muted mt-0.5 leading-relaxed truncate">
                        {step.description}
                      </div>
                    </div>

                    {/* Test button */}
                    <button
                      onClick={() => testStep(step)}
                      disabled={testingAll || stepState.state === 'running'}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                        stepState.state === 'running' || testingAll
                          ? 'bg-gray-500/20 text-gray-500 cursor-not-allowed'
                          : 'glass text-lily-text hover:bg-white/10'
                      }`}
                    >
                      {stepState.state === 'running' ? 'Testing...' : 'Test'}
                    </button>
                  </div>

                  {/* Result Display */}
                  {(stepState.result || stepState.error) && (
                    <div className={`px-3 pb-3 pt-0`}>
                      <div className={`text-[11px] p-2 rounded-lg ${config.bg}`}>
                        {stepState.error ? (
                          <div className="text-red-400">
                            <span className="font-medium">Error:</span> {stepState.error}
                          </div>
                        ) : stepState.result ? (
                          <div className={config.color}>
                            <span className="font-medium">Result:</span>{" "}
                            {typeof stepState.result === 'object'
                              ? JSON.stringify(stepState.result, null, 2)
                              : String(stepState.result)}
                          </div>
                        ) : null}
                        {stepState.duration && (
                          <div className="text-lily-muted mt-1">
                            Duration: {stepState.duration}ms
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary */}
          {anyTested && (
            <div className={`mt-4 p-3 rounded-lg ${allPassed ? 'bg-green-500/15 border border-green-500/30' : 'bg-gray-500/10'}`}>
              {allPassed ? (
                <div className="text-green-400 text-sm font-medium flex items-center gap-2">
                  <span>✓</span> All steps passed! Workflow is ready.
                </div>
              ) : (
                <div className="text-lily-muted text-sm">
                  {Object.values(stepStates).filter(s => s.state === 'success').length} of{" "}
                  {workflow.steps.length} steps tested
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-white/5 bg-black/20 flex-shrink-0">
          <div className="text-xs text-lily-muted">
            {workflow.steps.length} steps
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg glass text-sm font-medium text-lily-muted hover:text-lily-text transition-colors"
            >
              Close
            </button>
            <button
              onClick={testAllSteps}
              disabled={testingAll}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                testingAll
                  ? 'bg-gray-500/30 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30 hover:-translate-y-0.5'
              }`}
            >
              {testingAll ? 'Testing...' : 'Test All'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
