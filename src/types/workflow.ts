// Active Workflow Types for Lily Extension

import type { WorkflowStep, WorkflowStepMechanics } from "~lib/workflowTemplates";

export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowConfig {
  frequency?: number;              // Poll interval in minutes
  notifyOn?: string[];             // Notification triggers
  thresholds?: Record<string, any>;
  notificationChannels?: {
    browserPush?: boolean;
    email?: boolean;
    slack?: boolean;
  };
}

export interface ActiveWorkflowStep {
  id: string;
  action: string;
  description: string;
  icon: string;
  order: number;
  status: StepStatus;
  lastExecuted?: string;           // ISO timestamp
  result?: any;                    // Step execution result
  error?: string;                  // Error message if failed
  mechanics?: WorkflowStepMechanics;
}

export interface ActiveWorkflow {
  id: string;                      // Unique ID (wf_timestamp)
  workflowName: string;            // Human-readable name
  templateId?: string;             // Optional template reference
  pageUrl: string;                 // URL where activated
  pageTitle: string;               // Page title for context
  pageDomain: string;              // Domain for grouping
  config: WorkflowConfig;          // User configuration
  steps: ActiveWorkflowStep[];     // Steps with individual status
  status: WorkflowStatus;          // Overall status
  activatedAt: string;             // ISO timestamp
  lastRunAt?: string;              // Last execution timestamp
  nextScheduledRun?: string;       // Next scheduled run
  runCount: number;                // Total execution count
  error?: string;                  // Overall error if failed
}

export interface TestStepResult {
  stepId: string;
  success: boolean;
  result?: any;
  error?: string;
  duration?: number;               // Execution time in ms
  extractedData?: any;             // Data extracted during test
}

export interface WorkflowTestSession {
  workflowId: string;
  steps: TestStepResult[];
  startedAt: string;
  completedAt?: string;
  allPassed: boolean;
}

// Native host action payloads
export interface ActivateWorkflowPayload {
  workflow: Omit<ActiveWorkflow, 'id' | 'activatedAt' | 'runCount'>;
}

export interface UpdateWorkflowStatusPayload {
  id: string;
  status?: WorkflowStatus;
  stepId?: string;
  stepStatus?: StepStatus;
  error?: string;
  result?: any;
}

export interface TestWorkflowStepPayload {
  workflowId: string;
  stepId: string;
  pageUrl: string;
}

// Helper function to create ActiveWorkflowStep from WorkflowStep
export function toActiveStep(step: WorkflowStep): ActiveWorkflowStep {
  return {
    ...step,
    status: 'pending',
  };
}

// Helper function to create a new ActiveWorkflow
export function createActiveWorkflow(
  name: string,
  steps: WorkflowStep[],
  pageUrl: string,
  pageTitle: string,
  templateId?: string,
  config?: WorkflowConfig
): Omit<ActiveWorkflow, 'id' | 'activatedAt'> {
  const url = new URL(pageUrl);
  return {
    workflowName: name,
    templateId,
    pageUrl,
    pageTitle,
    pageDomain: url.hostname,
    config: config || {},
    steps: steps.map(toActiveStep),
    status: 'pending',
    runCount: 0,
  };
}
