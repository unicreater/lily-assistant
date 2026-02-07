/**
 * Workflow Templates with Context Mapping
 *
 * Defines step templates for each automation type and how they
 * map to extracted page context.
 */

import type { ExtractedPageContext } from "./contextExtractor";

// ============================================================================
// TYPES
// ============================================================================

export interface WorkflowStepConfig {
  key: string;
  label: string;
  type: "number" | "select" | "checkbox" | "radio" | "text";
  options?: { value: string; label: string }[];
  default: any;
}

export interface WorkflowStepMechanics {
  target?: {
    selector: string;
    description: string;
    count?: number;
  };
  method: {
    type: "poll" | "observe" | "extract" | "compare" | "notify";
    description: string;
    interval?: number;
  };
  extraction?: {
    type: "currency" | "percentage" | "text" | "number" | "status";
    description: string;
    storage?: string;
  };
  logic?: string;
  config: WorkflowStepConfig[];
}

export interface WorkflowStep {
  id: string;
  action: string;
  descriptionTemplate: string;
  description: string;  // Rendered with context
  icon: string;
  order: number;
  mechanics: WorkflowStepMechanics;
}

export interface WorkflowTemplate {
  id: string;
  title: string;
  description: string;
  icon: string;
  contextMapping: Record<string, string>;  // Maps to ExtractedPageContext paths
  steps: Omit<WorkflowStep, 'description'>[];
}

// ============================================================================
// NOTIFICATION CONFIG
// ============================================================================

export interface NotificationConfig {
  channels: {
    browserPush: boolean;
    email: boolean;
    slack: boolean;
    webhook: boolean;
  };
  content: {
    titleTemplate: string;
    bodyTemplate: string;
  };
  frequency: "immediate" | "hourly" | "daily";
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  channels: {
    browserPush: true,
    email: false,
    slack: false,
    webhook: false,
  },
  content: {
    titleTemplate: "🔔 {automationName}",
    bodyTemplate: "{message}",
  },
  frequency: "immediate",
};

// ============================================================================
// WORKFLOW TEMPLATES
// ============================================================================

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  "portfolio-rebalancing": {
    id: "portfolio-rebalancing",
    title: "Portfolio Rebalancing",
    description: "Alert when allocations drift",
    icon: "📊",
    contextMapping: {
      portfolioValue: "currencies[0]",
      holdings: "percentages",
      symbols: "symbols",
    },
    steps: [
      {
        id: "monitor",
        action: "Monitor Portfolio",
        descriptionTemplate: "Track {portfolioValue} value, checking every {frequency} for changes",
        icon: "👁️",
        order: 1,
        mechanics: {
          target: {
            selector: "{portfolioValueSelector}",
            description: "Portfolio value element",
          },
          method: {
            type: "poll",
            description: "Periodically fetch and parse the value",
            interval: 5,
          },
          extraction: {
            type: "currency",
            description: "Parse currency value → store as number",
            storage: "Save to local history for trend analysis",
          },
          config: [
            {
              key: "frequency",
              label: "Check frequency",
              type: "select",
              options: [
                { value: "1", label: "Every minute" },
                { value: "5", label: "Every 5 minutes" },
                { value: "15", label: "Every 15 minutes" },
                { value: "60", label: "Every hour" },
              ],
              default: "5",
            },
          ],
        },
      },
      {
        id: "calculate",
        action: "Calculate Allocation",
        descriptionTemplate: "Current: {holdingsList}. Compare against target allocation.",
        icon: "📐",
        order: 2,
        mechanics: {
          target: {
            selector: "{holdingsSelector}",
            description: "Holding card elements",
            count: 5,
          },
          method: {
            type: "extract",
            description: "For each holding: extract symbol + percentage + value",
          },
          extraction: {
            type: "percentage",
            description: "Parse percentage values from each holding",
          },
          config: [
            {
              key: "targetAllocation",
              label: "Target allocation",
              type: "text",
              default: "",  // Will be populated from context
            },
          ],
        },
      },
      {
        id: "detect",
        action: "Detect Drift",
        descriptionTemplate: "Alert when any position drifts more than ±{threshold}% from target",
        icon: "⚠️",
        order: 3,
        mechanics: {
          method: {
            type: "compare",
            description: "Compare actual vs target for each position",
          },
          logic: "IF abs(actual - target) > threshold THEN trigger alert",
          config: [
            {
              key: "threshold",
              label: "Drift threshold",
              type: "number",
              default: 5,
            },
          ],
        },
      },
      {
        id: "notify",
        action: "Send Notification",
        descriptionTemplate: "Alert when rebalancing is needed",
        icon: "🔔",
        order: 4,
        mechanics: {
          method: {
            type: "notify",
            description: "Send alert through configured channels",
          },
          config: [
            {
              key: "channels",
              label: "Notification channels",
              type: "checkbox",
              options: [
                { value: "browserPush", label: "Browser push" },
                { value: "email", label: "Email" },
                { value: "slack", label: "Slack" },
              ],
              default: ["browserPush"],
            },
            {
              key: "frequency",
              label: "Alert frequency",
              type: "radio",
              options: [
                { value: "immediate", label: "Once per drift" },
                { value: "daily", label: "Daily digest" },
              ],
              default: "immediate",
            },
          ],
        },
      },
    ],
  },

  "price-drop-alert": {
    id: "price-drop-alert",
    title: "Price Drop Alert",
    description: "Monitor for price changes",
    icon: "💰",
    contextMapping: {
      productName: "products[0].name",
      currentPrice: "products[0].price",
      priceSelector: "products[0].selector",
    },
    steps: [
      {
        id: "track",
        action: "Track Product",
        descriptionTemplate: "Monitor {productName} at {currentPrice}",
        icon: "👁️",
        order: 1,
        mechanics: {
          target: {
            selector: "{priceSelector}",
            description: "Price element",
          },
          method: {
            type: "poll",
            description: "Check price at regular intervals",
            interval: 60,
          },
          extraction: {
            type: "currency",
            description: "Parse price value",
            storage: "Save price history",
          },
          config: [
            {
              key: "frequency",
              label: "Check frequency",
              type: "select",
              options: [
                { value: "15", label: "Every 15 minutes" },
                { value: "60", label: "Every hour" },
                { value: "360", label: "Every 6 hours" },
                { value: "1440", label: "Daily" },
              ],
              default: "60",
            },
          ],
        },
      },
      {
        id: "detect",
        action: "Detect Price Change",
        descriptionTemplate: "Alert when price drops below {targetPrice} or by {dropPercent}%",
        icon: "📉",
        order: 2,
        mechanics: {
          method: {
            type: "compare",
            description: "Compare current price against target or original",
          },
          logic: "IF currentPrice < targetPrice OR priceDropPercent > threshold",
          config: [
            {
              key: "targetPrice",
              label: "Target price",
              type: "number",
              default: 0,
            },
            {
              key: "dropPercent",
              label: "Or drop percentage",
              type: "number",
              default: 15,
            },
          ],
        },
      },
      {
        id: "notify",
        action: "Send Alert",
        descriptionTemplate: "Notify with current price and savings",
        icon: "🔔",
        order: 3,
        mechanics: {
          method: {
            type: "notify",
            description: "Send price drop notification",
          },
          config: [
            {
              key: "channels",
              label: "Channels",
              type: "checkbox",
              options: [
                { value: "browserPush", label: "Browser push" },
                { value: "email", label: "Email" },
              ],
              default: ["browserPush"],
            },
          ],
        },
      },
    ],
  },

  "delivery-tracking": {
    id: "delivery-tracking",
    title: "Delivery Tracking",
    description: "Monitor shipment status",
    icon: "📬",
    contextMapping: {
      trackingNumber: "identifiers[0].value",
      carrier: "identifiers[0].carrier",
      status: "statuses[0].status",
      deliveryDate: "dates[0].value",
    },
    steps: [
      {
        id: "track",
        action: "Track Shipment",
        descriptionTemplate: "Monitor {carrier} package {trackingNumber}",
        icon: "📋",
        order: 1,
        mechanics: {
          target: {
            selector: "body",
            description: "Tracking page",
          },
          method: {
            type: "poll",
            description: "Check carrier tracking page",
            interval: 30,
          },
          config: [
            {
              key: "frequency",
              label: "Check frequency",
              type: "select",
              options: [
                { value: "30", label: "Every 30 minutes" },
                { value: "60", label: "Every hour" },
                { value: "180", label: "Every 3 hours" },
              ],
              default: "60",
            },
          ],
        },
      },
      {
        id: "status",
        action: "Check Status Updates",
        descriptionTemplate: "Current: {status} • ETA: {deliveryDate}",
        icon: "🔄",
        order: 2,
        mechanics: {
          method: {
            type: "extract",
            description: "Parse status and estimated delivery",
          },
          extraction: {
            type: "status",
            description: "Extract status text and date",
          },
          config: [],
        },
      },
      {
        id: "notify",
        action: "Alert on Changes",
        descriptionTemplate: "Notify on: {alertTriggers}",
        icon: "🔔",
        order: 3,
        mechanics: {
          method: {
            type: "notify",
            description: "Send status change alerts",
          },
          config: [
            {
              key: "alertTriggers",
              label: "Alert on",
              type: "checkbox",
              options: [
                { value: "outForDelivery", label: "Out for Delivery" },
                { value: "delivered", label: "Delivered" },
                { value: "exception", label: "Exception/Delay" },
              ],
              default: ["outForDelivery", "delivered", "exception"],
            },
            {
              key: "channels",
              label: "Channels",
              type: "checkbox",
              options: [
                { value: "browserPush", label: "Browser push" },
                { value: "email", label: "Email" },
              ],
              default: ["browserPush"],
            },
          ],
        },
      },
    ],
  },

  "engagement-tracker": {
    id: "engagement-tracker",
    title: "Engagement Tracker",
    description: "Monitor post performance",
    icon: "📊",
    contextMapping: {
      likes: "metrics[0].value",
      reposts: "metrics[1].value",
      replies: "metrics[2].value",
    },
    steps: [
      {
        id: "track",
        action: "Track Post",
        descriptionTemplate: "Monitor engagement starting at {likes} likes, {reposts} reposts",
        icon: "📌",
        order: 1,
        mechanics: {
          method: {
            type: "poll",
            description: "Track engagement metrics",
            interval: 15,
          },
          config: [
            {
              key: "frequency",
              label: "Check frequency",
              type: "select",
              options: [
                { value: "5", label: "Every 5 minutes" },
                { value: "15", label: "Every 15 minutes" },
                { value: "60", label: "Every hour" },
              ],
              default: "15",
            },
          ],
        },
      },
      {
        id: "measure",
        action: "Measure Growth",
        descriptionTemplate: "Track hourly changes in likes, reposts, and replies",
        icon: "📈",
        order: 2,
        mechanics: {
          method: {
            type: "compare",
            description: "Calculate engagement growth rate",
          },
          config: [],
        },
      },
      {
        id: "notify",
        action: "Milestone Alerts",
        descriptionTemplate: "Notify at {likeMilestone} likes, {repostMilestone} reposts, or viral growth",
        icon: "🔔",
        order: 3,
        mechanics: {
          method: {
            type: "notify",
            description: "Alert on engagement milestones",
          },
          config: [
            {
              key: "likeMilestone",
              label: "Like milestone",
              type: "number",
              default: 5000,
            },
            {
              key: "repostMilestone",
              label: "Repost milestone",
              type: "number",
              default: 1000,
            },
            {
              key: "viralThreshold",
              label: "Viral growth rate",
              type: "number",
              default: 100, // per hour
            },
          ],
        },
      },
    ],
  },

  "smart-form-fill": {
    id: "smart-form-fill",
    title: "Smart Form Fill",
    description: "Auto-fill from profile",
    icon: "✨",
    contextMapping: {
      fieldCount: "formFields.length",
      requiredCount: "formFields.filter(f => f.required).length",
      fields: "formFields",
    },
    steps: [
      {
        id: "detect",
        action: "Detect Fields",
        descriptionTemplate: "Found {fieldCount} fields ({requiredCount} required)",
        icon: "🔍",
        order: 1,
        mechanics: {
          method: {
            type: "extract",
            description: "Scan form for input fields",
          },
          extraction: {
            type: "text",
            description: "Extract field names, types, and requirements",
          },
          config: [],
        },
      },
      {
        id: "profile",
        action: "Load Profile",
        descriptionTemplate: "Use profile: {profileName}",
        icon: "👤",
        order: 2,
        mechanics: {
          method: {
            type: "extract",
            description: "Load saved profile data",
          },
          config: [
            {
              key: "profileName",
              label: "Select profile",
              type: "select",
              options: [
                { value: "personal", label: "Personal" },
                { value: "work", label: "Work" },
                { value: "custom", label: "Custom..." },
              ],
              default: "personal",
            },
          ],
        },
      },
      {
        id: "fill",
        action: "Fill Fields",
        descriptionTemplate: "Auto-populate matching fields, highlight unknowns",
        icon: "✏️",
        order: 3,
        mechanics: {
          method: {
            type: "extract",
            description: "Match profile data to form fields and fill",
          },
          config: [],
        },
      },
      {
        id: "review",
        action: "Review & Submit",
        descriptionTemplate: "Verify filled data before submitting",
        icon: "✅",
        order: 4,
        mechanics: {
          method: {
            type: "observe",
            description: "Wait for user review and confirmation",
          },
          config: [
            {
              key: "autoSubmit",
              label: "Auto-submit after review",
              type: "checkbox",
              default: false,
            },
          ],
        },
      },
    ],
  },
};

// ============================================================================
// CONTEXT RESOLUTION
// ============================================================================

/**
 * Resolve a path like "currencies[0].value" from context
 */
function resolvePath(context: ExtractedPageContext, path: string): any {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: any = context;

  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Generate context-aware workflow steps from template and extracted context
 */
export function generateWorkflowSteps(
  templateId: string,
  context: ExtractedPageContext
): WorkflowStep[] {
  const template = WORKFLOW_TEMPLATES[templateId];
  if (!template) return [];

  // Resolve context mapping
  const resolvedContext: Record<string, any> = {};
  for (const [key, path] of Object.entries(template.contextMapping)) {
    resolvedContext[key] = resolvePath(context, path);
  }

  // Special handling for holdings list
  if (context.percentages && context.percentages.length > 0) {
    resolvedContext.holdingsList = context.percentages
      .slice(0, 5)
      .map(p => `${p.label} ${p.value}`)
      .join(', ');
    resolvedContext.holdingsSelector = context.percentages[0]?.selector;
  }

  // Special handling for portfolio value
  if (context.currencies && context.currencies.length > 0) {
    resolvedContext.portfolioValue = context.currencies[0].value;
    resolvedContext.portfolioValueSelector = context.currencies[0].selector;
  }

  // Generate steps with resolved descriptions
  return template.steps.map(step => {
    let description = step.descriptionTemplate;

    // Replace {variables} with resolved values
    description = description.replace(/\{(\w+)\}/g, (_, key) => {
      const value = resolvedContext[key];
      if (value !== undefined && value !== null) {
        return String(value);
      }
      // Return config default if available
      const config = step.mechanics.config.find(c => c.key === key);
      if (config) return String(config.default);
      return `{${key}}`;
    });

    return {
      ...step,
      description,
    };
  });
}

/**
 * Get template by automation title
 */
export function getTemplateByTitle(title: string): WorkflowTemplate | undefined {
  const normalized = title.toLowerCase();

  if (normalized.includes('rebalanc')) return WORKFLOW_TEMPLATES['portfolio-rebalancing'];
  if (normalized.includes('price') && normalized.includes('drop')) return WORKFLOW_TEMPLATES['price-drop-alert'];
  if (normalized.includes('delivery') || normalized.includes('track')) return WORKFLOW_TEMPLATES['delivery-tracking'];
  if (normalized.includes('engagement') || normalized.includes('social')) return WORKFLOW_TEMPLATES['engagement-tracker'];
  if (normalized.includes('form') && normalized.includes('fill')) return WORKFLOW_TEMPLATES['smart-form-fill'];

  return undefined;
}
