/**
 * Page Intelligence - Types and Utilities
 *
 * Comprehensive page analysis for automation opportunities.
 * Abstracts any website into input/output patterns (the "math side").
 */

// ============================================================================
// CORE ANALYSIS TYPES
// ============================================================================

/**
 * Complete analysis of a web page
 */
export interface PageAnalysis {
  // Basic metadata
  title: string;
  url: string;
  domain: string;
  timestamp: string;

  // Content
  textContent: string; // Full visible text (truncated for Claude)
  structuredData: StructuredDataItem[]; // JSON-LD, microdata

  // Interactive Elements
  forms: FormAnalysis[];
  buttons: ButtonAnalysis[];
  links: LinkAnalysis[];
  inputs: InputAnalysis[];

  // Page Behavior (detected)
  apiEndpoints: APIEndpoint[];
  websockets: string[];
  eventHandlers: EventBinding[];

  // Abstracted Model (math side)
  inputSurfaces: InputSurface[];
  outputSurfaces: OutputSurface[];
  dataFlows: DataFlow[];
  stateChanges: StateChange[];

  // Automation potential
  automationScore: number; // 0-100
  suggestedScenario: ScenarioType | null;
}

// ============================================================================
// INTERACTIVE ELEMENTS
// ============================================================================

export interface FormAnalysis {
  id: string;
  name?: string;
  action: string;
  method: string;
  selector: string;
  fields: FormFieldAnalysis[];
  submitButton?: ButtonAnalysis;
}

export interface FormFieldAnalysis {
  name: string;
  type: string;
  label: string;
  placeholder: string;
  required: boolean;
  selector: string;
  value?: string;
  options?: { value: string; label: string }[]; // For select/radio
  validation?: string[]; // Detected validation rules
}

export interface ButtonAnalysis {
  id: string;
  text: string;
  type: "submit" | "button" | "reset" | "link";
  selector: string;
  onClick?: string; // onclick handler if visible
  ariaLabel?: string;
  disabled: boolean;
}

export interface LinkAnalysis {
  text: string;
  href: string;
  selector: string;
  isExternal: boolean;
  category: "navigation" | "action" | "resource" | "social" | "unknown";
}

export interface InputAnalysis {
  name: string;
  type: string;
  selector: string;
  label: string;
  value?: string;
  standalone: boolean; // Not inside a form
}

// ============================================================================
// PAGE BEHAVIOR
// ============================================================================

export interface APIEndpoint {
  url: string;
  method: string;
  contentType?: string;
  detectedAt: string;
  payloadSample?: any;
  responseSample?: any;
}

export interface EventBinding {
  element: string; // selector
  event: string; // click, submit, change, etc.
  handler: string; // function name or inline
}

export interface StructuredDataItem {
  type: string; // JSON-LD @type, microdata itemtype
  data: Record<string, any>;
}

// ============================================================================
// ABSTRACT MODEL (Math Side)
// ============================================================================

export type InputSurfaceType = "form" | "button" | "input" | "selection" | "upload" | "search" | "filter";
export type OutputSurfaceType = "display" | "download" | "notification" | "redirect" | "state" | "table" | "chart" | "list";

export interface InputSurface {
  id: string;
  type: InputSurfaceType;
  label: string;
  selector: string;
  dataType: string; // text, number, date, file, email, etc.
  constraints: string[]; // Detected validation rules
  relatedOutputs: string[]; // IDs of outputs this affects
  automatable: boolean;
  confidence: number; // 0-1
}

export interface OutputSurface {
  id: string;
  type: OutputSurfaceType;
  label: string;
  selector?: string;
  dataFormat: string; // text, table, chart, file, json, etc.
  updateTrigger: string; // What causes this to update
  extractable: boolean;
  confidence: number;
}

export interface DataFlow {
  id: string;
  input: string; // InputSurface id
  processing: string; // Description of transformation
  output: string; // OutputSurface id
  automatable: boolean;
  complexity: 1 | 2 | 3; // simple, medium, complex
  confidence: number; // 0-1
}

export interface StateChange {
  trigger: string; // What causes the change (click, submit, etc.)
  element: string; // Selector
  effect: string; // Description of what changes
  reversible: boolean;
}

// ============================================================================
// SCENARIO DETECTION
// ============================================================================

export type ScenarioType =
  | "logistics"
  | "social"
  | "prediction"
  | "ecommerce"
  | "finance"
  | "dataentry"
  | "custom";

export interface ScenarioMatch {
  scenario: ScenarioType;
  confidence: number;
  matchedPatterns: string[];
}

// Patterns to detect scenarios
export const SCENARIO_PATTERNS: Record<ScenarioType, RegExp[]> = {
  logistics: [
    /track/i,
    /shipment/i,
    /delivery/i,
    /carrier/i,
    /fedex|ups|usps|dhl/i,
    /package/i,
    /shipping/i,
    /order.*status/i,
  ],
  social: [
    /twitter|x\.com/i,
    /facebook|instagram|linkedin|threads/i,
    /post|tweet|share/i,
    /follow|like|comment/i,
    /social/i,
    /hashtag/i,
    /engagement/i,
  ],
  prediction: [
    /bet|wager/i,
    /odds|line/i,
    /spread|moneyline/i,
    /sportsbook/i,
    /draftkings|fanduel|betmgm/i,
    /casino|poker/i,
    /prediction/i,
  ],
  ecommerce: [
    /cart|checkout/i,
    /buy|purchase|order/i,
    /price|cost|\$\d/i,
    /amazon|ebay|shopify|etsy/i,
    /add.*to.*cart/i,
    /wishlist/i,
    /product/i,
  ],
  finance: [
    /stock|share|equity/i,
    /portfolio|holdings/i,
    /trade|invest/i,
    /robinhood|fidelity|schwab/i,
    /dividend|earnings/i,
    /balance|account/i,
    /crypto|bitcoin/i,
  ],
  dataentry: [
    /form/i,
    /input|field/i,
    /submit|save/i,
    /spreadsheet|csv/i,
    /google.*forms|typeform/i,
    /survey|questionnaire/i,
    /fill|complete/i,
  ],
  custom: [], // No patterns - fallback
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Detect which scenario best matches the page
 */
export function detectScenario(analysis: Partial<PageAnalysis>): ScenarioMatch | null {
  const text = [
    analysis.title || "",
    analysis.url || "",
    analysis.textContent?.slice(0, 5000) || "",
  ].join(" ").toLowerCase();

  const matches: ScenarioMatch[] = [];

  for (const [scenario, patterns] of Object.entries(SCENARIO_PATTERNS)) {
    if (scenario === "custom") continue;

    const matchedPatterns: string[] = [];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matchedPatterns.push(pattern.source);
      }
    }

    if (matchedPatterns.length > 0) {
      matches.push({
        scenario: scenario as ScenarioType,
        confidence: Math.min(matchedPatterns.length / patterns.length, 1),
        matchedPatterns,
      });
    }
  }

  // Sort by confidence and return best match
  matches.sort((a, b) => b.confidence - a.confidence);
  return matches[0] || { scenario: "custom", confidence: 0, matchedPatterns: [] };
}

/**
 * Calculate automation potential score (0-100)
 */
export function calculateAutomationScore(analysis: Partial<PageAnalysis>): number {
  let score = 0;

  // Forms are highly automatable
  const formCount = analysis.forms?.length || 0;
  score += Math.min(formCount * 15, 30);

  // Buttons indicate interactivity
  const buttonCount = analysis.buttons?.length || 0;
  score += Math.min(buttonCount * 3, 15);

  // API endpoints suggest programmatic access
  const apiCount = analysis.apiEndpoints?.length || 0;
  score += Math.min(apiCount * 10, 25);

  // Structured data indicates well-organized content
  const structuredCount = analysis.structuredData?.length || 0;
  score += Math.min(structuredCount * 5, 15);

  // Data flows indicate clear input→output patterns
  const flowCount = analysis.dataFlows?.length || 0;
  score += Math.min(flowCount * 5, 15);

  return Math.min(score, 100);
}

/**
 * Generate a unique ID for elements
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Truncate text for Claude context (max 5KB)
 */
export function truncateForContext(text: string, maxBytes = 5000): string {
  if (new Blob([text]).size <= maxBytes) {
    return text;
  }

  // Binary search for the right length
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (new Blob([text.slice(0, mid)]).size <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return text.slice(0, low) + "... [truncated]";
}

/**
 * Create an empty PageAnalysis object
 */
export function createEmptyAnalysis(url: string, title: string): PageAnalysis {
  return {
    title,
    url,
    domain: extractDomain(url),
    timestamp: new Date().toISOString(),
    textContent: "",
    structuredData: [],
    forms: [],
    buttons: [],
    links: [],
    inputs: [],
    apiEndpoints: [],
    websockets: [],
    eventHandlers: [],
    inputSurfaces: [],
    outputSurfaces: [],
    dataFlows: [],
    stateChanges: [],
    automationScore: 0,
    suggestedScenario: null,
  };
}
