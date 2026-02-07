import { useState, useCallback, useMemo } from "react";
import type { ExtractedPageContext } from "~lib/contextExtractor";
import {
  generateWorkflowSteps,
  getTemplateByTitle,
  type WorkflowStep as TemplateStep,
  type WorkflowStepMechanics,
} from "~lib/workflowTemplates";

// Re-export for consumers
export interface WorkflowStep {
  id: string;
  action: string;
  description: string;
  icon: string;
  order: number;
  mechanics?: WorkflowStepMechanics;
}

export interface AutomationSuggestion {
  icon: string;
  title: string;
  description: string;
  timeSaved?: string;
  isAI?: boolean;
}

interface WorkflowPreviewModalProps {
  suggestion: AutomationSuggestion;
  pageContext: ExtractedPageContext | null;
  onConfirm: (steps: WorkflowStep[]) => void;
  onCancel: () => void;
}

export function WorkflowPreviewModal({
  suggestion,
  pageContext,
  onConfirm,
  onCancel,
}: WorkflowPreviewModalProps) {
  // Generate steps from template + context
  const initialSteps = useMemo(() => {
    if (pageContext) {
      const template = getTemplateByTitle(suggestion.title);
      if (template) {
        const templateSteps = generateWorkflowSteps(template.id, pageContext);
        return templateSteps.map(s => ({
          ...s,
          mechanics: template.steps.find(ts => ts.id === s.id)?.mechanics,
        }));
      }
    }
    // Fallback to generic steps
    return generateFallbackSteps(suggestion, pageContext);
  }, [suggestion.title, pageContext]);

  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Drag handlers
  const handleDragStart = useCallback((index: number) => {
    setDraggedIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(
    (index: number) => {
      if (draggedIndex === null || draggedIndex === index) {
        setDraggedIndex(null);
        setDragOverIndex(null);
        return;
      }

      const newSteps = [...steps];
      const [removed] = newSteps.splice(draggedIndex, 1);
      newSteps.splice(index, 0, removed);

      const reorderedSteps = newSteps.map((step, i) => ({
        ...step,
        order: i + 1,
      }));

      setSteps(reorderedSteps);
      setDraggedIndex(null);
      setDragOverIndex(null);
    },
    [draggedIndex, steps]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const toggleExpand = useCallback((stepId: string) => {
    setExpandedStep(prev => (prev === stepId ? null : stepId));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md glass-card rounded-2xl overflow-hidden shadow-2xl shadow-purple-500/20 border border-white/10 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl glass flex items-center justify-center text-xl">
              {suggestion.icon}
            </div>
            <div>
              <h3 className="text-base font-semibold text-lily-text">
                {suggestion.title}
              </h3>
              <p className="text-xs text-lily-muted">{suggestion.description}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-lg glass flex items-center justify-center text-lily-muted hover:text-lily-text transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 custom-scrollbar">
          <div className="text-xs text-lily-muted mb-4 flex items-center gap-2">
            <span className="w-4 h-4 rounded bg-purple-500/20 flex items-center justify-center text-[10px]">
              ↕
            </span>
            Drag steps to reorder • Click to expand details
          </div>

          <div className="space-y-2">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={`
                  rounded-xl glass overflow-hidden transition-all
                  ${draggedIndex === index ? "opacity-50 scale-95" : ""}
                  ${
                    dragOverIndex === index && draggedIndex !== index
                      ? "ring-2 ring-purple-500 ring-offset-2 ring-offset-[#1a1a2e]"
                      : ""
                  }
                  ${expandedStep === step.id ? "border-purple-500/50" : "hover:border-lily-accent"}
                `}
              >
                {/* Step header (draggable) */}
                <div
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={() => handleDrop(index)}
                  onDragEnd={handleDragEnd}
                  className="flex items-start gap-3 p-3 cursor-grab active:cursor-grabbing"
                >
                  {/* Step number */}
                  <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-[10px] font-bold shadow-lg shadow-purple-500/30">
                    {index + 1}
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
                    <div className="text-[11px] text-lily-muted mt-0.5 leading-relaxed">
                      <StepDescription description={step.description} />
                    </div>
                  </div>

                  {/* Expand button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(step.id);
                    }}
                    className="flex-shrink-0 w-6 h-6 rounded glass flex items-center justify-center text-lily-muted hover:text-lily-text transition-colors text-xs"
                  >
                    {expandedStep === step.id ? "▼" : "▶"}
                  </button>

                  {/* Drag handle */}
                  <div className="flex-shrink-0 text-lily-muted/50 text-xs">
                    ⋮⋮
                  </div>
                </div>

                {/* Expanded mechanics */}
                {expandedStep === step.id && step.mechanics && (
                  <StepMechanicsView mechanics={step.mechanics} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-white/5 bg-black/20 flex-shrink-0">
          <div className="text-xs text-lily-muted">{steps.length} steps</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg glass text-sm font-medium text-lily-muted hover:text-lily-text transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(steps)}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold shadow-lg shadow-purple-500/30 hover:-translate-y-0.5 transition-all"
            >
              Activate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Highlight extracted values in description
function StepDescription({ description }: { description: string }) {
  // Find values that look like extracted data (currencies, percentages, etc.)
  const parts = description.split(/(\$[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%|[A-Z]{2,5}\s+\d+(?:\.\d+)?%)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (/^\$[\d,]+/.test(part) || /\d+(?:\.\d+)?%/.test(part) || /^[A-Z]{2,5}\s+\d/.test(part)) {
          return (
            <span key={i} className="text-green-400 font-medium">
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// Mechanics detail view
function StepMechanicsView({ mechanics }: { mechanics: WorkflowStepMechanics }) {
  return (
    <div className="px-3 pb-3 pt-0">
      <div className="bg-black/20 rounded-lg p-3 space-y-3 text-[11px]">
        {/* Target */}
        {mechanics.target && (
          <div className="flex gap-3">
            <span className="text-lily-muted w-14 flex-shrink-0 uppercase text-[9px] pt-0.5">Target</span>
            <div>
              <code className="bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded text-[10px] font-mono">
                {mechanics.target.selector}
              </code>
              <div className="text-lily-muted mt-1">{mechanics.target.description}</div>
            </div>
          </div>
        )}

        {/* Method */}
        <div className="flex gap-3">
          <span className="text-lily-muted w-14 flex-shrink-0 uppercase text-[9px] pt-0.5">Method</span>
          <div className="text-lily-text">{mechanics.method.description}</div>
        </div>

        {/* Extraction */}
        {mechanics.extraction && (
          <div className="flex gap-3">
            <span className="text-lily-muted w-14 flex-shrink-0 uppercase text-[9px] pt-0.5">Extract</span>
            <div className="text-lily-text">{mechanics.extraction.description}</div>
          </div>
        )}

        {/* Logic */}
        {mechanics.logic && (
          <div className="flex gap-3">
            <span className="text-lily-muted w-14 flex-shrink-0 uppercase text-[9px] pt-0.5">Logic</span>
            <code className="text-purple-300 text-[10px] font-mono">{mechanics.logic}</code>
          </div>
        )}

        {/* Config options */}
        {mechanics.config.length > 0 && (
          <div className="flex gap-3">
            <span className="text-lily-muted w-14 flex-shrink-0 uppercase text-[9px] pt-0.5">Config</span>
            <div className="flex flex-wrap gap-1.5">
              {mechanics.config.map((cfg) => (
                <span
                  key={cfg.key}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-amber-500/15 text-amber-400 rounded text-[10px]"
                >
                  ⚙️ {cfg.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Generate fallback steps when no template matches
function generateFallbackSteps(
  suggestion: AutomationSuggestion,
  context: ExtractedPageContext | null
): WorkflowStep[] {
  const title = suggestion.title.toLowerCase();

  // Portfolio rebalancing with context
  if (title.includes("rebalanc")) {
    const portfolioValue = context?.currencies?.[0]?.value || "your portfolio";
    const holdings = context?.percentages?.slice(0, 5).map(p => `${p.label} ${p.value}`).join(", ") || "your holdings";

    return [
      {
        id: "1",
        action: "Monitor Portfolio",
        description: `Track ${portfolioValue} value, checking every 5 minutes for changes`,
        icon: "👁️",
        order: 1,
      },
      {
        id: "2",
        action: "Calculate Allocation",
        description: `Current: ${holdings}. Compare against target allocation.`,
        icon: "📐",
        order: 2,
      },
      {
        id: "3",
        action: "Detect Drift",
        description: "Alert when any position drifts more than ±5% from target",
        icon: "⚠️",
        order: 3,
      },
      {
        id: "4",
        action: "Send Notification",
        description: "Push alert to your device when rebalancing is needed",
        icon: "🔔",
        order: 4,
      },
    ];
  }

  // Price alerts with context
  if (title.includes("price") || title.includes("drop")) {
    const product = context?.products?.[0];
    const price = product?.price || context?.currencies?.[0]?.value || "$0.00";
    const name = product?.name || "this item";

    return [
      {
        id: "1",
        action: "Track Product",
        description: `Monitor ${name} at ${price}`,
        icon: "👁️",
        order: 1,
      },
      {
        id: "2",
        action: "Detect Price Change",
        description: "Alert when price drops below target or by percentage",
        icon: "📉",
        order: 2,
      },
      {
        id: "3",
        action: "Send Alert",
        description: "Notify with current price and savings amount",
        icon: "🔔",
        order: 3,
      },
    ];
  }

  // Tracking with context
  if (title.includes("track") || title.includes("delivery")) {
    const identifier = context?.identifiers?.[0];
    const tracking = identifier?.value || "package";
    const carrier = identifier?.carrier || "carrier";

    return [
      {
        id: "1",
        action: "Track Shipment",
        description: `Monitor ${carrier} package ${tracking}`,
        icon: "📋",
        order: 1,
      },
      {
        id: "2",
        action: "Check Status",
        description: "Monitor for status updates",
        icon: "🔄",
        order: 2,
      },
      {
        id: "3",
        action: "Alert on Changes",
        description: "Notify on delivery, out for delivery, or exceptions",
        icon: "🔔",
        order: 3,
      },
    ];
  }

  // Default generic
  return [
    {
      id: "1",
      action: "Analyze Page",
      description: "Scan current page for relevant data",
      icon: "🔍",
      order: 1,
    },
    {
      id: "2",
      action: "Process Data",
      description: "Transform and prepare information",
      icon: "⚙️",
      order: 2,
    },
    {
      id: "3",
      action: "Take Action",
      description: "Execute the automation",
      icon: "▶️",
      order: 3,
    },
  ];
}
