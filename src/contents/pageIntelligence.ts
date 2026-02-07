import type { PlasmoCSConfig } from "plasmo";
import type {
  PageAnalysis,
  FormAnalysis,
  FormFieldAnalysis,
  ButtonAnalysis,
  LinkAnalysis,
  InputAnalysis,
  APIEndpoint,
  InputSurface,
  OutputSurface,
  DataFlow,
  StructuredDataItem,
} from "~lib/pageAnalyzer";
import {
  detectScenario,
  calculateAutomationScore,
  generateId,
  extractDomain,
  truncateForContext,
  createEmptyAnalysis,
} from "~lib/pageAnalyzer";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
};

// ============================================================================
// SELECTOR UTILITY (shared with recorder.ts pattern)
// ============================================================================

function getSelector(element: Element): string {
  // Try ID first
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Try data-testid
  const dataTestId = element.getAttribute("data-testid");
  if (dataTestId) {
    return `[data-testid="${CSS.escape(dataTestId)}"]`;
  }

  // Try name attribute
  const name = element.getAttribute("name");
  if (name) {
    return `[name="${CSS.escape(name)}"]`;
  }

  // Try aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return `[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  // Build path
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // Add unique classes
    const classes = Array.from(current.classList)
      .filter((c) => !c.includes("--") && !c.match(/^[a-z]+_[a-z0-9]+$/i))
      .slice(0, 2);
    if (classes.length) {
      selector += "." + classes.map((c) => CSS.escape(c)).join(".");
    }

    // Add nth-of-type
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    if (path.length >= 3) break;
  }

  return path.join(" > ");
}

// ============================================================================
// FORM ANALYSIS
// ============================================================================

function findLabelForInput(element: HTMLElement): string {
  const inputEl = element as HTMLInputElement;

  // Explicit label
  if (inputEl.labels?.length) {
    return inputEl.labels[0].textContent?.trim() || "";
  }

  if (element.id) {
    const labelFor = document.querySelector(`label[for="${element.id}"]`);
    if (labelFor) return labelFor.textContent?.trim() || "";
  }

  // aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  // Look in parent hierarchy
  let searchEl: Element | null = element;
  for (let i = 0; i < 3; i++) {
    const prev = searchEl?.previousElementSibling;
    if (prev?.tagName === "LABEL") {
      return prev.textContent?.trim() || "";
    }
    searchEl = searchEl?.parentElement || null;
    if (!searchEl) break;
  }

  // placeholder as fallback
  if ((element as HTMLInputElement).placeholder) {
    return (element as HTMLInputElement).placeholder;
  }

  return "";
}

function analyzeForms(): FormAnalysis[] {
  const forms: FormAnalysis[] = [];
  const formElements = document.querySelectorAll("form");

  formElements.forEach((form, idx) => {
    const fields: FormFieldAnalysis[] = [];
    const inputs = form.querySelectorAll("input, textarea, select");

    inputs.forEach((el) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (input.type === "hidden" || input.type === "submit" || input.type === "button") {
        return;
      }

      let options: { value: string; label: string }[] | undefined;
      if (input.tagName === "SELECT") {
        options = Array.from((input as HTMLSelectElement).options).map((opt) => ({
          value: opt.value,
          label: opt.textContent?.trim() || opt.value,
        }));
      }

      fields.push({
        name: input.name || input.id || "",
        type: input.type || input.tagName.toLowerCase(),
        label: findLabelForInput(input),
        placeholder: (input as HTMLInputElement).placeholder || "",
        required: input.required,
        selector: getSelector(input),
        value: input.value || undefined,
        options,
      });
    });

    // Find submit button
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement;
    let submitButton: ButtonAnalysis | undefined;
    if (submitBtn) {
      submitButton = {
        id: generateId("btn"),
        text: submitBtn.textContent?.trim() || (submitBtn as HTMLInputElement).value || "Submit",
        type: "submit",
        selector: getSelector(submitBtn),
        disabled: (submitBtn as HTMLButtonElement).disabled,
      };
    }

    forms.push({
      id: form.id || generateId("form"),
      name: form.name || undefined,
      action: form.action || window.location.href,
      method: form.method?.toUpperCase() || "GET",
      selector: getSelector(form),
      fields,
      submitButton,
    });
  });

  return forms;
}

// ============================================================================
// BUTTON ANALYSIS
// ============================================================================

function analyzeButtons(): ButtonAnalysis[] {
  const buttons: ButtonAnalysis[] = [];
  const elements = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a.btn, a.button');

  elements.forEach((el) => {
    const element = el as HTMLElement;

    // Skip if inside a form and is submit (already captured)
    if (element.closest("form") &&
        ((element as HTMLButtonElement).type === "submit" ||
         (element as HTMLInputElement).type === "submit")) {
      return;
    }

    const text = element.textContent?.trim() ||
                 (element as HTMLInputElement).value ||
                 element.getAttribute("aria-label") || "";

    if (!text) return;

    buttons.push({
      id: element.id || generateId("btn"),
      text: text.slice(0, 50),
      type: element.tagName === "A" ? "link" : ((element as HTMLButtonElement).type || "button") as any,
      selector: getSelector(element),
      onClick: element.getAttribute("onclick") || undefined,
      ariaLabel: element.getAttribute("aria-label") || undefined,
      disabled: (element as HTMLButtonElement).disabled || false,
    });
  });

  return buttons;
}

// ============================================================================
// LINK ANALYSIS
// ============================================================================

function categorizeLink(href: string, text: string): LinkAnalysis["category"] {
  const lowerText = text.toLowerCase();
  const lowerHref = href.toLowerCase();

  // Action links
  if (lowerText.match(/sign|login|register|submit|download|buy|add|delete|edit/)) {
    return "action";
  }

  // Social links
  if (lowerHref.match(/twitter|facebook|linkedin|instagram|youtube|tiktok/)) {
    return "social";
  }

  // Resource links
  if (lowerHref.match(/\.(pdf|doc|xlsx?|zip|rar|tar)/)) {
    return "resource";
  }

  // Navigation
  if (lowerText.match(/home|about|contact|pricing|faq|help|support/)) {
    return "navigation";
  }

  return "unknown";
}

function analyzeLinks(): LinkAnalysis[] {
  const links: LinkAnalysis[] = [];
  const elements = document.querySelectorAll("a[href]");
  const currentHost = window.location.hostname;

  elements.forEach((el) => {
    const anchor = el as HTMLAnchorElement;
    const href = anchor.href;
    const text = anchor.textContent?.trim() || anchor.getAttribute("aria-label") || "";

    if (!href || !text || href.startsWith("javascript:") || href === "#") {
      return;
    }

    let isExternal = false;
    try {
      isExternal = new URL(href).hostname !== currentHost;
    } catch {}

    links.push({
      text: text.slice(0, 100),
      href,
      selector: getSelector(anchor),
      isExternal,
      category: categorizeLink(href, text),
    });
  });

  return links;
}

// ============================================================================
// STANDALONE INPUT ANALYSIS
// ============================================================================

function analyzeStandaloneInputs(): InputAnalysis[] {
  const inputs: InputAnalysis[] = [];
  const elements = document.querySelectorAll("input, textarea, select");

  elements.forEach((el) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    // Skip if inside a form
    if (input.closest("form")) return;

    // Skip hidden/button types
    if (input.type === "hidden" || input.type === "submit" || input.type === "button") {
      return;
    }

    inputs.push({
      name: input.name || input.id || "",
      type: input.type || input.tagName.toLowerCase(),
      selector: getSelector(input),
      label: findLabelForInput(input),
      value: input.value || undefined,
      standalone: true,
    });
  });

  return inputs;
}

// ============================================================================
// STRUCTURED DATA EXTRACTION
// ============================================================================

function extractStructuredData(): StructuredDataItem[] {
  const items: StructuredDataItem[] = [];

  // JSON-LD
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  jsonLdScripts.forEach((script) => {
    try {
      const data = JSON.parse(script.textContent || "");
      if (Array.isArray(data)) {
        data.forEach((item) => {
          items.push({
            type: item["@type"] || "Unknown",
            data: item,
          });
        });
      } else {
        items.push({
          type: data["@type"] || "Unknown",
          data,
        });
      }
    } catch {}
  });

  // Microdata
  const microdataItems = document.querySelectorAll("[itemtype]");
  microdataItems.forEach((el) => {
    const itemtype = el.getAttribute("itemtype") || "";
    const data: Record<string, any> = {};

    el.querySelectorAll("[itemprop]").forEach((prop) => {
      const name = prop.getAttribute("itemprop");
      if (name) {
        data[name] = prop.textContent?.trim() || prop.getAttribute("content") || "";
      }
    });

    items.push({
      type: itemtype.split("/").pop() || "Unknown",
      data,
    });
  });

  return items;
}

// ============================================================================
// INPUT/OUTPUT SURFACE ABSTRACTION
// ============================================================================

function abstractInputSurfaces(
  forms: FormAnalysis[],
  buttons: ButtonAnalysis[],
  inputs: InputAnalysis[]
): InputSurface[] {
  const surfaces: InputSurface[] = [];

  // Forms as input surfaces
  forms.forEach((form) => {
    form.fields.forEach((field) => {
      surfaces.push({
        id: generateId("input"),
        type: field.type === "file" ? "upload" : "form",
        label: field.label || field.name || "Unknown Field",
        selector: field.selector,
        dataType: field.type,
        constraints: field.required ? ["required"] : [],
        relatedOutputs: [],
        automatable: true,
        confidence: 0.9,
      });
    });
  });

  // Buttons as input surfaces
  buttons.forEach((btn) => {
    surfaces.push({
      id: generateId("input"),
      type: "button",
      label: btn.text,
      selector: btn.selector,
      dataType: "action",
      constraints: btn.disabled ? ["disabled"] : [],
      relatedOutputs: [],
      automatable: !btn.disabled,
      confidence: 0.8,
    });
  });

  // Search inputs
  inputs.forEach((input) => {
    if (input.type === "search" || input.name.toLowerCase().includes("search")) {
      surfaces.push({
        id: generateId("input"),
        type: "search",
        label: input.label || "Search",
        selector: input.selector,
        dataType: "text",
        constraints: [],
        relatedOutputs: [],
        automatable: true,
        confidence: 0.85,
      });
    }
  });

  return surfaces;
}

function abstractOutputSurfaces(): OutputSurface[] {
  const surfaces: OutputSurface[] = [];

  // Tables as output surfaces
  document.querySelectorAll("table").forEach((table) => {
    surfaces.push({
      id: generateId("output"),
      type: "table",
      label: table.getAttribute("aria-label") || "Data Table",
      selector: getSelector(table),
      dataFormat: "table",
      updateTrigger: "page-load",
      extractable: true,
      confidence: 0.9,
    });
  });

  // Charts/Canvas
  document.querySelectorAll("canvas, svg.chart, [class*='chart']").forEach((el) => {
    surfaces.push({
      id: generateId("output"),
      type: "chart",
      label: el.getAttribute("aria-label") || "Chart",
      selector: getSelector(el),
      dataFormat: "chart",
      updateTrigger: "data-change",
      extractable: false,
      confidence: 0.7,
    });
  });

  // Download links
  document.querySelectorAll('a[download], a[href*=".pdf"], a[href*=".csv"], a[href*=".xlsx"]').forEach((el) => {
    surfaces.push({
      id: generateId("output"),
      type: "download",
      label: el.textContent?.trim() || "Download",
      selector: getSelector(el),
      dataFormat: "file",
      updateTrigger: "click",
      extractable: true,
      confidence: 0.95,
    });
  });

  // Lists
  document.querySelectorAll("ul.results, ol.results, [class*='list'][class*='result']").forEach((el) => {
    surfaces.push({
      id: generateId("output"),
      type: "list",
      label: "Results List",
      selector: getSelector(el),
      dataFormat: "list",
      updateTrigger: "search",
      extractable: true,
      confidence: 0.75,
    });
  });

  return surfaces;
}

// ============================================================================
// DATA FLOW DETECTION
// ============================================================================

function detectDataFlows(
  inputs: InputSurface[],
  outputs: OutputSurface[]
): DataFlow[] {
  const flows: DataFlow[] = [];

  // Search input → Results
  const searchInput = inputs.find((i) => i.type === "search");
  const resultsList = outputs.find((o) => o.type === "list");

  if (searchInput && resultsList) {
    flows.push({
      id: generateId("flow"),
      input: searchInput.id,
      processing: "Search query → Filter/sort → Display results",
      output: resultsList.id,
      automatable: true,
      complexity: 1,
      confidence: 0.85,
    });
  }

  // Form → Redirect/Confirmation
  const formInputs = inputs.filter((i) => i.type === "form");
  if (formInputs.length > 0) {
    flows.push({
      id: generateId("flow"),
      input: formInputs[0].id,
      processing: "Form data → Validation → Server submission",
      output: "redirect",
      automatable: true,
      complexity: 2,
      confidence: 0.8,
    });
  }

  return flows;
}

// ============================================================================
// FULL PAGE TEXT EXTRACTION
// ============================================================================

function extractFullText(): string {
  const article =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.body;

  const clone = article.cloneNode(true) as Element;
  clone.querySelectorAll("script, style, noscript, svg, iframe").forEach((el) => el.remove());

  return truncateForContext(clone.textContent?.trim() || "");
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

function performFullAnalysis(): PageAnalysis {
  const analysis = createEmptyAnalysis(window.location.href, document.title);

  // Extract content
  analysis.textContent = extractFullText();
  analysis.structuredData = extractStructuredData();

  // Analyze interactive elements
  analysis.forms = analyzeForms();
  analysis.buttons = analyzeButtons();
  analysis.links = analyzeLinks();
  analysis.inputs = analyzeStandaloneInputs();

  // Abstract to input/output model
  analysis.inputSurfaces = abstractInputSurfaces(analysis.forms, analysis.buttons, analysis.inputs);
  analysis.outputSurfaces = abstractOutputSurfaces();
  analysis.dataFlows = detectDataFlows(analysis.inputSurfaces, analysis.outputSurfaces);

  // Calculate automation potential
  analysis.automationScore = calculateAutomationScore(analysis);

  // Detect scenario
  const scenarioMatch = detectScenario(analysis);
  analysis.suggestedScenario = scenarioMatch?.scenario || null;

  return analysis;
}

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "analyzePageIntelligence") {
    try {
      const analysis = performFullAnalysis();
      sendResponse({ ok: true, analysis });
    } catch (e: any) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  if (message.type === "getPageSummary") {
    // Quick summary for PageAnalysisView
    try {
      const summary = {
        title: document.title,
        url: window.location.href,
        domain: extractDomain(window.location.href),
        formCount: document.querySelectorAll("form").length,
        buttonCount: document.querySelectorAll("button, [role='button']").length,
        inputCount: document.querySelectorAll("input:not([type='hidden']), textarea, select").length,
        linkCount: document.querySelectorAll("a[href]").length,
        tableCount: document.querySelectorAll("table").length,
        scenario: detectScenario({
          title: document.title,
          url: window.location.href,
          textContent: document.body.textContent?.slice(0, 3000) || "",
        }),
      };
      sendResponse({ ok: true, summary });
    } catch (e: any) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }
});

console.log("[Lily Page Intelligence] Content script loaded");
