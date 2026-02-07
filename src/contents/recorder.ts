import type { PlasmoCSConfig } from "plasmo";
import {
  extractAllContext,
  type ExtractedPageContext,
} from "~lib/contextExtractor";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
};

interface WorkflowStep {
  action: string;
  selector?: string;
  value?: string;
  url?: string;
  timestamp: number;
}

let isRecording = false;
let recordedSteps: WorkflowStep[] = [];

// Generate a unique CSS selector for an element
function getSelector(element: Element): string {
  // Try ID first
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Try data attributes
  const dataTestId = element.getAttribute("data-testid");
  if (dataTestId) {
    return `[data-testid="${CSS.escape(dataTestId)}"]`;
  }

  // Try name attribute for form elements
  const name = element.getAttribute("name");
  if (name) {
    return `[name="${CSS.escape(name)}"]`;
  }

  // Try aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return `[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  // Build path using tag names and nth-child
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // Add class if it's unique enough
    const classes = Array.from(current.classList)
      .filter((c) => !c.includes("--") && !c.match(/^[a-z]+_[a-z0-9]+$/i)) // Filter out CSS modules
      .slice(0, 2);
    if (classes.length) {
      selector += "." + classes.map((c) => CSS.escape(c)).join(".");
    }

    // Add nth-child if needed
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

    // Stop if we have a unique enough selector
    if (path.length >= 3) break;
  }

  return path.join(" > ");
}

// Record click events
function handleClick(e: MouseEvent) {
  if (!isRecording) return;

  const target = e.target as Element;
  if (!target) return;

  // Ignore clicks on the extension's own elements
  if (target.closest("[data-lily-ignore]")) return;

  recordedSteps.push({
    action: "click",
    selector: getSelector(target),
    timestamp: Date.now(),
  });

  console.log("[Lily Recorder] Click recorded:", getSelector(target));
}

// Record input events
function handleInput(e: Event) {
  if (!isRecording) return;

  const target = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target) return;

  // Debounce input recording
  const lastStep = recordedSteps[recordedSteps.length - 1];
  const selector = getSelector(target);

  if (
    lastStep &&
    lastStep.action === "fill" &&
    lastStep.selector === selector
  ) {
    // Update existing fill step
    lastStep.value = target.value;
    lastStep.timestamp = Date.now();
  } else {
    // Add new fill step
    recordedSteps.push({
      action: "fill",
      selector,
      value: target.value,
      timestamp: Date.now(),
    });
  }
}

// Record navigation (pushState, replaceState)
function handleNavigation() {
  if (!isRecording) return;

  recordedSteps.push({
    action: "navigate",
    url: window.location.href,
    timestamp: Date.now(),
  });

  console.log("[Lily Recorder] Navigation recorded:", window.location.href);
}

// Start recording
function startRecording() {
  if (isRecording) return;

  isRecording = true;
  recordedSteps = [];

  // Record initial URL
  recordedSteps.push({
    action: "navigate",
    url: window.location.href,
    timestamp: Date.now(),
  });

  // Add event listeners
  document.addEventListener("click", handleClick, true);
  document.addEventListener("input", handleInput, true);
  window.addEventListener("popstate", handleNavigation);

  // Intercept history methods
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    handleNavigation();
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    handleNavigation();
  };

  // Visual indicator
  showRecordingIndicator();

  console.log("[Lily Recorder] Recording started");
}

// Stop recording
function stopRecording(): WorkflowStep[] {
  if (!isRecording) return [];

  isRecording = false;

  // Remove event listeners
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("input", handleInput, true);
  window.removeEventListener("popstate", handleNavigation);

  // Hide indicator
  hideRecordingIndicator();

  console.log("[Lily Recorder] Recording stopped. Steps:", recordedSteps.length);

  const steps = [...recordedSteps];
  recordedSteps = [];
  return steps;
}

// Recording indicator
let indicatorElement: HTMLElement | null = null;

function showRecordingIndicator() {
  if (indicatorElement) return;

  indicatorElement = document.createElement("div");
  indicatorElement.setAttribute("data-lily-ignore", "true");
  indicatorElement.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 2147483647;
    background: #e94560;
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(233, 69, 96, 0.4);
    display: flex;
    align-items: center;
    gap: 8px;
    animation: pulse 2s infinite;
  `;
  indicatorElement.innerHTML = `
    <span style="width: 8px; height: 8px; background: white; border-radius: 50%; animation: pulse 1s infinite;"></span>
    Recording...
  `;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
  `;
  indicatorElement.appendChild(style);

  document.body.appendChild(indicatorElement);
}

function hideRecordingIndicator() {
  if (indicatorElement) {
    indicatorElement.remove();
    indicatorElement = null;
  }
}

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "startRecording") {
    startRecording();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "stopRecording") {
    const steps = stopRecording();
    sendResponse({ ok: true, steps });
    return true;
  }

  if (message.type === "getPageContent") {
    const title = document.title;
    const url = window.location.href;

    // Get main content
    const article =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.body;

    // Extract text, removing scripts and styles
    const clone = article.cloneNode(true) as Element;
    clone.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
    const text = clone.textContent?.trim().slice(0, 15000) || "";

    // Get metadata
    const description =
      document.querySelector('meta[name="description"]')?.getAttribute("content") || "";

    sendResponse({ ok: true, title, url, text, description });
    return true;
  }

  // Get all forms and their fields on the page
  if (message.type === "getFormFields") {
    const formData: any[] = [];

    // Helper to find label text for an input element
    function findLabelForInput(element: HTMLElement): string {
      // 1. Check for explicit label via 'for' attribute or labels property
      const inputEl = element as HTMLInputElement;
      if (inputEl.labels?.length) {
        return inputEl.labels[0].textContent?.trim() || "";
      }
      if (element.id) {
        const labelFor = document.querySelector(`label[for="${element.id}"]`);
        if (labelFor) return labelFor.textContent?.trim() || "";
      }

      // 2. Check aria-label
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel;

      // 3. Look for label as previous sibling or in parent container
      const parent = element.parentElement;
      if (parent) {
        // Check if there's a label sibling before this element or its wrapper
        let searchEl: Element | null = element;
        for (let i = 0; i < 3; i++) {
          const prev = searchEl?.previousElementSibling;
          if (prev?.tagName === "LABEL") {
            return prev.textContent?.trim() || "";
          }
          searchEl = searchEl?.parentElement || null;
          if (!searchEl) break;
        }

        // Check parent's first child or previous sibling for label text
        const grandparent = parent.parentElement;
        if (grandparent) {
          const label = grandparent.querySelector("label");
          if (label && !grandparent.querySelector("input, select, textarea")?.isSameNode(element)) {
            // Make sure this label is for our input (in same container)
          }
          if (label) {
            return label.textContent?.trim() || "";
          }
        }
      }

      // 4. Use placeholder as fallback
      if ((element as HTMLInputElement).placeholder) {
        return (element as HTMLInputElement).placeholder;
      }

      return "";
    }

    // Helper to find the form-like container for an element
    function findFormContainer(element: Element): Element | null {
      let current: Element | null = element;
      while (current && current !== document.body) {
        // Look for common form container patterns
        if (current.tagName === "FORM") return current;

        // Look for modal/dialog/card patterns
        const role = current.getAttribute("role");
        if (role === "dialog" || role === "form") return current;

        // Check for common modal/form class patterns
        const classes = current.className.toLowerCase();
        if (classes.includes("modal") || classes.includes("dialog") ||
            classes.includes("form") || classes.includes("card")) {
          // Verify it has multiple inputs
          const inputs = current.querySelectorAll("input, select, textarea");
          if (inputs.length >= 2) return current;
        }

        // Check for shadow box styling (common modal pattern)
        const style = window.getComputedStyle(current);
        if (style.boxShadow && style.boxShadow !== "none" &&
            current.querySelectorAll("input, select, textarea").length >= 2) {
          return current;
        }

        current = current.parentElement;
      }
      return null;
    }

    // First, collect traditional <form> elements
    const forms = document.querySelectorAll("form");
    forms.forEach((form, formIndex) => {
      const formInfo: any = {
        id: form.id || `form-${formIndex}`,
        selector: getSelector(form),
        action: form.action || window.location.href,
        method: form.method || "GET",
        fields: [],
      };

      const elements = form.querySelectorAll("input, textarea, select");
      elements.forEach((el) => {
        const element = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (element.type === "hidden" || element.type === "submit" || element.type === "button") {
          return;
        }

        const label = findLabelForInput(element);
        formInfo.fields.push({
          name: element.name || element.id || "",
          type: element.type || element.tagName.toLowerCase(),
          value: element.value || "",
          label,
          required: element.required,
          selector: getSelector(element),
          placeholder: (element as HTMLInputElement).placeholder || "",
        });
      });

      if (formInfo.fields.length > 0) {
        formData.push(formInfo);
      }
    });

    // Then, look for form-like containers (React-style forms, modals, etc.)
    const allInputs = document.querySelectorAll("input, textarea, select");
    const processedContainers = new Set<Element>();
    const inputsInForms = new Set<Element>();

    // Mark inputs already in <form> elements
    forms.forEach(form => {
      form.querySelectorAll("input, textarea, select").forEach(el => inputsInForms.add(el));
    });

    allInputs.forEach((input) => {
      // Skip if already processed in a <form>
      if (inputsInForms.has(input)) return;

      const element = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

      // Skip hidden, submit, button types
      if (element.type === "hidden" || element.type === "submit" || element.type === "button") {
        return;
      }

      // Find the form-like container
      const container = findFormContainer(element);
      if (!container || processedContainers.has(container)) return;
      processedContainers.add(container);

      // Get title from container (look for h1, h2, h3, or first bold text)
      let formTitle = "";
      const headings = container.querySelectorAll("h1, h2, h3, h4, [class*='title'], [class*='header']");
      if (headings.length > 0) {
        formTitle = headings[0].textContent?.trim().split("\n")[0] || "";
      }

      const formInfo: any = {
        id: formTitle ? formTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-") : `detected-form-${formData.length}`,
        selector: getSelector(container),
        action: window.location.href,
        method: "POST",
        title: formTitle,
        fields: [],
      };

      // Get all inputs in this container
      const containerInputs = container.querySelectorAll("input, textarea, select");
      containerInputs.forEach((el) => {
        const inputEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

        // Skip hidden, submit, button
        if (inputEl.type === "hidden" || inputEl.type === "submit" || inputEl.type === "button") {
          return;
        }

        const label = findLabelForInput(inputEl);

        // Skip inputs with no label that we can identify
        if (!label && !inputEl.name && !inputEl.id && !(inputEl as HTMLInputElement).placeholder) {
          return;
        }

        formInfo.fields.push({
          name: inputEl.name || inputEl.id || label.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "",
          type: inputEl.type || inputEl.tagName.toLowerCase(),
          value: inputEl.value || "",
          label,
          required: inputEl.required || label.includes("*"),
          selector: getSelector(inputEl),
          placeholder: (inputEl as HTMLInputElement).placeholder || "",
        });
      });

      if (formInfo.fields.length > 0) {
        formData.push(formInfo);
      }
    });

    sendResponse({ ok: true, forms: formData, pageUrl: window.location.href });
    return true;
  }

  // Fill a form field
  if (message.type === "fillFormField") {
    const { selector, value } = message;
    try {
      const element = document.querySelector(selector) as HTMLElement;
      if (!element) {
        sendResponse({ ok: false, error: `Element not found: ${selector}` });
        return true;
      }

      // Check if it's a contenteditable element
      const isContentEditable = element.hasAttribute("contenteditable") &&
        (element.getAttribute("contenteditable") === "true" || element.getAttribute("contenteditable") === "");

      if (isContentEditable) {
        // Handle contenteditable (like Gmail compose body)
        // Convert newlines to <br> for proper display
        const htmlValue = value.replace(/\n/g, "<br>");
        element.innerHTML = htmlValue;

        // Focus and dispatch events for React/frameworks
        element.focus();
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      } else if (element.tagName === "SELECT") {
        // Handle select dropdown
        const select = element as HTMLSelectElement;
        // Try to find option by value or text
        let found = false;
        for (const option of Array.from(select.options)) {
          if (option.value === value || option.textContent?.trim().toLowerCase() === value.toLowerCase()) {
            select.value = option.value;
            found = true;
            break;
          }
        }
        if (!found) {
          sendResponse({ ok: false, error: `Option not found: ${value}` });
          return true;
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      } else if ((element as HTMLInputElement).type === "checkbox" || (element as HTMLInputElement).type === "radio") {
        // Handle checkbox/radio
        (element as HTMLInputElement).checked = value === "true" || value === "1" || value === (element as HTMLInputElement).value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        // Handle text inputs and textareas
        (element as HTMLInputElement | HTMLTextAreaElement).value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      }

      sendResponse({ ok: true, filled: { selector, value } });
    } catch (e: any) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  // Submit a form
  if (message.type === "submitForm") {
    const { selector } = message;
    try {
      const form = document.querySelector(selector) as HTMLFormElement;
      if (!form) {
        sendResponse({ ok: false, error: `Form not found: ${selector}` });
        return true;
      }

      // Find and click submit button, or call submit directly
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement;
      if (submitBtn) {
        submitBtn.click();
      } else {
        form.submit();
      }

      sendResponse({ ok: true, submitted: true, action: form.action });
    } catch (e: any) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  // Start inspect mode - let user select a form element
  if (message.type === "startInspect") {
    startInspectMode();
    sendResponse({ ok: true });
    return true;
  }

  // Stop inspect mode
  if (message.type === "stopInspect") {
    stopInspectMode();
    sendResponse({ ok: true });
    return true;
  }

  // Get fields from a specific element selector
  if (message.type === "getFieldsFromElement") {
    const { selector } = message;
    try {
      const element = document.querySelector(selector);
      if (!element) {
        sendResponse({ ok: false, error: "Element not found" });
        return true;
      }

      const fields = extractFieldsFromElement(element);
      const title = getElementTitle(element);

      sendResponse({
        ok: true,
        fields,
        title,
        selector,
        pageUrl: window.location.href,
      });
    } catch (e: any) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  // Highlight a specific element (for Fill Now preview)
  if (message.type === "highlightElement") {
    const { selector } = message;
    try {
      const element = selector ? document.querySelector(selector) : null;
      showPreviewHighlight(element, message.label || "Fill this form?");
      sendResponse({ ok: true });
    } catch (e: any) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  // Remove highlight
  if (message.type === "removeHighlight") {
    removePreviewHighlight();
    sendResponse({ ok: true });
    return true;
  }

  // Get page summary for Page Intelligence
  if (message.type === "getPageSummary") {
    console.log('[Lily] Received getPageSummary message');
    try {
      const summary = {
        title: document.title,
        url: window.location.href,
        domain: window.location.hostname,
        formCount: document.querySelectorAll("form").length,
        buttonCount: document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']").length,
        inputCount: document.querySelectorAll("input:not([type='hidden']):not([type='button']):not([type='submit']), textarea, select").length,
        linkCount: document.querySelectorAll("a[href]").length,
        tableCount: document.querySelectorAll("table").length,
        scenario: detectPageScenario(),
      };
      console.log('[Lily] getPageSummary returning summary:', summary);
      sendResponse({ ok: true, summary });
    } catch (e: any) {
      console.error('[Lily] getPageSummary error:', e);
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  // Extract full page context (generic extraction for all page types)
  if (message.type === "extractPageContext") {
    console.log('[Lily] Received extractPageContext message');
    try {
      const context = extractAllContext();
      console.log('[Lily] extractPageContext found:', {
        currencies: context.currencies.length,
        percentages: context.percentages.length,
        symbols: context.symbols.length,
        tables: context.tables.length,
      });
      sendResponse({ ok: true, context });
    } catch (e: any) {
      console.error('[Lily] extractPageContext error:', e);
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  // Show analysis highlights on page
  if (message.type === "showAnalysisHighlights") {
    console.log('[Lily] Received showAnalysisHighlights message, targets:', message.targets?.length);
    try {
      showAnalysisHighlights(message.targets || []);
      sendResponse({ ok: true });
    } catch (e: any) {
      console.error('[Lily] showAnalysisHighlights error:', e);
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  // Clear analysis highlights
  if (message.type === "clearAnalysisHighlights") {
    console.log('[Lily] Received clearAnalysisHighlights message');
    clearAnalysisHighlights();
    sendResponse({ ok: true });
    return true;
  }

  // Execute a workflow step for testing
  if (message.type === "executeWorkflowStep") {
    console.log('[Lily] Received executeWorkflowStep message:', message.step);
    try {
      const { step } = message;
      const mechanics = step.mechanics;
      let result: any = null;
      let extractedData: any = null;

      // Based on the step's method type, perform different actions
      const methodType = mechanics?.method?.type || 'extract';

      switch (methodType) {
        case 'extract':
        case 'poll':
        case 'observe': {
          // Find target element and extract data
          if (mechanics?.target?.selector) {
            const elements = document.querySelectorAll(mechanics.target.selector);
            if (elements.length === 0) {
              // Try a more lenient approach - look for elements with matching text
              const allElements = document.querySelectorAll('*');
              let found = false;
              for (const el of Array.from(allElements)) {
                const text = el.textContent?.trim() || '';
                // Match currency patterns
                if (/^\$[\d,]+(\.\d{2})?$/.test(text) || /^[\d,]+(\.\d{2})?\s*%$/.test(text)) {
                  extractedData = text;
                  result = `Found value: ${text}`;
                  found = true;
                  break;
                }
              }
              if (!found) {
                result = `Selector "${mechanics.target.selector}" not found. Would scan for patterns.`;
                // Still return success - the selector might be dynamic
              }
            } else {
              // Extract content from found elements
              const values = Array.from(elements).map(el => el.textContent?.trim()).filter(Boolean);
              extractedData = values.length === 1 ? values[0] : values;
              result = `Found ${elements.length} element(s): ${values.slice(0, 3).join(', ')}${values.length > 3 ? '...' : ''}`;
            }
          } else {
            // No specific selector - do generic extraction based on extraction type
            const extractionType = mechanics?.extraction?.type || 'text';
            if (extractionType === 'currency') {
              const currencyRegex = /\$[\d,]+(\.\d{2})?/g;
              const bodyText = document.body.innerText;
              const matches = bodyText.match(currencyRegex) || [];
              extractedData = matches.slice(0, 5);
              result = `Found ${matches.length} currency values`;
            } else if (extractionType === 'percentage') {
              const pctRegex = /[\d.]+%/g;
              const bodyText = document.body.innerText;
              const matches = bodyText.match(pctRegex) || [];
              extractedData = matches.slice(0, 5);
              result = `Found ${matches.length} percentages`;
            } else {
              result = 'Step would extract text content';
            }
          }
          break;
        }

        case 'compare': {
          // Compare extracted value against threshold
          result = 'Comparison step would check values against configured thresholds';
          extractedData = { status: 'Would compare values' };
          break;
        }

        case 'notify': {
          // Preview notification
          result = 'Notification step ready';
          extractedData = {
            preview: `🔔 ${step.action}: ${step.description}`,
            channels: ['Browser Push'],
          };
          break;
        }

        default:
          result = `Unknown method type: ${methodType}`;
      }

      sendResponse({ ok: true, result, extractedData });
    } catch (e: any) {
      console.error('[Lily] executeWorkflowStep error:', e);
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }

  // Get detailed elements for highlighting
  if (message.type === "getPageElements") {
    console.log('[Lily] Received getPageElements message');
    try {
      const elements: Array<{ selector: string; type: string; label: string; priority: number }> = [];
      const seenSelectors = new Set<string>();

      // Helper to check if element is in main content area (not in narrow sidebars)
      const isInMainContent = (rect: DOMRect): boolean => {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        // Consider main content to be roughly center 70% of viewport
        const leftBound = viewportWidth * 0.1;
        const rightBound = viewportWidth * 0.9;
        const centerX = rect.left + rect.width / 2;
        return centerX > leftBound && centerX < rightBound && rect.top < viewportHeight;
      };

      // Helper to check if element is visible and reasonably sized
      const isVisibleAndSized = (el: Element): DOMRect | null => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return null;
        if (rect.top > window.innerHeight || rect.bottom < 0) return null;
        if (rect.left > window.innerWidth || rect.right < 0) return null;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;
        return rect;
      };

      // Helper to get meaningful label from element
      const getLabel = (el: Element): string => {
        const text = el.textContent?.trim().slice(0, 40) || '';
        const ariaLabel = el.getAttribute('aria-label');
        const title = el.getAttribute('title');
        const placeholder = (el as HTMLInputElement).placeholder;
        // Fallback: check for svg title or img alt for icon buttons
        const svgTitle = el.querySelector('svg title')?.textContent?.trim();
        const imgAlt = el.querySelector('img')?.alt?.trim();
        return ariaLabel || title || text || placeholder || svgTitle || imgAlt || '';
      };

      // Helper to add element if not duplicate
      const addElement = (el: Element, type: string, label: string, basePriority: number) => {
        const selector = getSelector(el);
        if (seenSelectors.has(selector)) return;
        seenSelectors.add(selector);
        const rect = isVisibleAndSized(el);
        if (!rect) return;
        // Boost priority for main content elements
        const priority = isInMainContent(rect) ? basePriority + 100 : basePriority;
        elements.push({ selector, type, label: label.slice(0, 40), priority });
      };

      // 1. Get forms (high priority)
      console.log('[Lily] getPageElements: scanning forms...');
      document.querySelectorAll("form").forEach((form) => {
        const fieldCount = form.querySelectorAll("input, select, textarea").length;
        if (fieldCount > 0) {
          addElement(form, "form", `Form (${fieldCount} fields)`, 90);
        }
      });
      console.log('[Lily] getPageElements: forms done, count:', elements.length);

      // 2. Get all interactive buttons - comprehensive selectors
      console.log('[Lily] getPageElements: scanning buttons...');
      const buttonSelectors = [
        'button',
        '[role="button"]',
        'a[class*="btn"]',
        'a[class*="button"]',
        '[class*="btn"]:not(input)',
        '[class*="button"]:not(input)',
        '[data-action]',
        '[data-testid*="button"]',
        '[data-cy*="button"]',
      ].join(', ');

      document.querySelectorAll(buttonSelectors).forEach((btn) => {
        const label = getLabel(btn);
        // Skip only if completely empty AND no aria-label AND no title
        const hasIdentifier = label.length > 0 || btn.getAttribute('aria-label') || btn.getAttribute('title');
        if (!hasIdentifier) return;
        addElement(btn, "button", label || "Icon", 70);
      });
      console.log('[Lily] getPageElements: buttons done, count:', elements.length);

      // 3. Get clickable links that look like actions (not navigation)
      console.log('[Lily] getPageElements: scanning links...');
      document.querySelectorAll('a[href]').forEach((link) => {
        const href = link.getAttribute('href') || '';
        const text = getLabel(link);
        // Skip navigation links, prioritize action links
        if (href === '#' || href.startsWith('javascript:') ||
            text.toLowerCase().includes('add') ||
            text.toLowerCase().includes('buy') ||
            text.toLowerCase().includes('save') ||
            text.toLowerCase().includes('submit') ||
            text.toLowerCase().includes('upload') ||
            text.toLowerCase().includes('download')) {
          addElement(link, "link", text, 60);
        }
      });
      console.log('[Lily] getPageElements: links done, count:', elements.length);

      // 4. Get interactive elements with click handlers or pointer cursor
      console.log('[Lily] getPageElements: scanning clickables...');
      // Note: [@click] is invalid CSS - Vue's @click compiles to v-on:click
      document.querySelectorAll('[onclick], [ng-click], [v-on\\:click]').forEach((el) => {
        if (seenSelectors.has(getSelector(el))) return;
        const label = getLabel(el);
        addElement(el, "clickable", label, 50);
      });
      console.log('[Lily] getPageElements: clickables done, count:', elements.length);

      // 5. Get dropdowns and selects
      console.log('[Lily] getPageElements: scanning dropdowns...');
      document.querySelectorAll('select, [role="listbox"], [role="combobox"], [class*="dropdown"], [class*="select"]').forEach((el) => {
        const label = getLabel(el);
        addElement(el, "dropdown", label || "Dropdown", 65);
      });
      console.log('[Lily] getPageElements: dropdowns done, count:', elements.length);

      // 6. Get standalone inputs
      console.log('[Lily] getPageElements: scanning inputs...');
      document.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']), textarea").forEach((input) => {
        if (input.closest("form")) return; // Skip inputs in forms
        const label = (input as HTMLInputElement).placeholder ||
                     input.getAttribute("aria-label") ||
                     (input as HTMLInputElement).name ||
                     "Input";
        addElement(input, "input", label, 75);
      });
      console.log('[Lily] getPageElements: inputs done, count:', elements.length);

      // 7. Get tables
      console.log('[Lily] getPageElements: scanning tables...');
      document.querySelectorAll("table, [role='grid'], [role='table']").forEach((table) => {
        const rows = table.querySelectorAll("tr, [role='row']").length;
        if (rows > 1) {
          addElement(table, "table", `Table (${rows} rows)`, 40);
        }
      });
      console.log('[Lily] getPageElements: tables done, count:', elements.length);

      // 8. Get tab controls
      console.log('[Lily] getPageElements: scanning tabs...');
      document.querySelectorAll('[role="tab"], [role="tablist"] > *, [class*="tab"]:not([class*="table"])').forEach((tab) => {
        const label = getLabel(tab);
        if (label.length > 1) {
          addElement(tab, "tab", label, 55);
        }
      });
      console.log('[Lily] getPageElements: tabs done, count:', elements.length);

      // 9. Scan for cursor:pointer elements (React apps don't use onclick attributes)
      // Wrapped in try-catch to prevent failures from breaking detection
      console.log('[Lily] getPageElements: scanning cursor:pointer...');
      try {
        const interactiveContainers = document.querySelectorAll('main, [role="main"], article, section, .content, #content, #main');
        const containersToScan = interactiveContainers.length > 0 ? Array.from(interactiveContainers) : [document.body];
        let cursorPointerCount = 0;
        const MAX_CURSOR_ELEMENTS = 50; // Limit scanning

        for (const container of containersToScan) {
          if (cursorPointerCount >= MAX_CURSOR_ELEMENTS) break;
          const candidates = container.querySelectorAll('div, span, li, a');

          for (const el of Array.from(candidates)) {
            if (cursorPointerCount >= MAX_CURSOR_ELEMENTS) break;
            try {
              const selector = getSelector(el);
              if (seenSelectors.has(selector)) continue;

              const rect = el.getBoundingClientRect();
              if (rect.width < 20 || rect.height < 20) continue;
              if (rect.width > 400 || rect.height > 100) continue; // Button-sized only

              const style = window.getComputedStyle(el);
              if (style.cursor !== 'pointer') continue;

              // Must have some visual styling (not just inherited pointer)
              const hasBackground = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
              const hasBorder = style.borderWidth !== '0px' && style.borderStyle !== 'none';
              const hasRadius = style.borderRadius !== '0px';

              if (hasBackground || hasBorder || hasRadius) {
                const label = getLabel(el);
                if (label.length >= 1 && label.length <= 30 && isInMainContent(rect)) {
                  addElement(el, "interactive", label, 80);
                  cursorPointerCount++;
                }
              }
            } catch {}
          }
        }
      } catch (e) {
        console.warn('[Lily] cursor:pointer detection failed:', e);
      }
      console.log('[Lily] getPageElements: cursor:pointer done, count:', elements.length);

      // Sort by priority (higher first) and take top 50 (increased from 25 to include sidebar elements)
      elements.sort((a, b) => b.priority - a.priority);
      const topElements = elements.slice(0, 50).map(({ selector, type, label }) => ({ selector, type, label }));

      console.log('[Lily] getPageElements found:', topElements.length, 'elements');

      // If no elements found, try basic fallback
      if (topElements.length === 0) {
        console.log('[Lily] No elements found, trying fallback detection');
        const fallbackElements: Array<{ selector: string; type: string; label: string }> = [];

        // Simple fallback: get any visible buttons
        document.querySelectorAll('button, [role="button"], a[class*="btn"]').forEach((btn) => {
          if (fallbackElements.length >= 10) return;
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight) {
            const text = btn.textContent?.trim().slice(0, 30) || btn.getAttribute('aria-label') || 'Button';
            if (text.length > 0) {
              fallbackElements.push({
                selector: getSelector(btn),
                type: 'button',
                label: text
              });
            }
          }
        });

        sendResponse({ ok: true, elements: fallbackElements });
        return true;
      }

      sendResponse({ ok: true, elements: topElements });
    } catch (e: any) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }
});

// Scenario detection for Page Intelligence
function detectPageScenario(): { scenario: string; confidence: number; matchedPatterns: string[] } | null {
  const text = [document.title, window.location.href, document.body?.textContent?.slice(0, 5000) || ""].join(" ").toLowerCase();

  const patterns: Record<string, RegExp[]> = {
    logistics: [/track/i, /shipment/i, /delivery/i, /fedex|ups|usps|dhl/i, /package/i, /shipping/i],
    social: [/twitter|x\.com/i, /facebook|instagram|linkedin/i, /post|tweet|share/i, /follow|like|comment/i],
    prediction: [/bet|wager/i, /odds|line/i, /sportsbook/i, /draftkings|fanduel/i, /casino|poker/i],
    ecommerce: [/cart|checkout/i, /buy|purchase/i, /price|\$\d/i, /amazon|ebay|shopify/i, /add.*to.*cart/i, /product/i],
    finance: [/stock|share|equity/i, /portfolio/i, /trade|invest/i, /robinhood|fidelity/i, /dividend|earnings/i],
    dataentry: [/form/i, /submit|save/i, /google.*forms|typeform/i, /survey/i],
  };

  let bestMatch: { scenario: string; confidence: number; matchedPatterns: string[] } | null = null;

  for (const [scenario, regexes] of Object.entries(patterns)) {
    const matched: string[] = [];
    for (const regex of regexes) {
      if (regex.test(text)) {
        matched.push(regex.source);
      }
    }
    if (matched.length > 0) {
      const confidence = matched.length / regexes.length;
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { scenario, confidence, matchedPatterns: matched };
      }
    }
  }

  return bestMatch || { scenario: "custom", confidence: 0, matchedPatterns: [] };
}

// ============ Inspect Mode ============

let isInspecting = false;
let highlightOverlay: HTMLElement | null = null;
let currentTarget: Element | null = null;
let inspectResolve: ((selector: string | null) => void) | null = null;

function createHighlightOverlay() {
  if (highlightOverlay) return;

  highlightOverlay = document.createElement("div");
  highlightOverlay.setAttribute("data-lily-ignore", "true");
  highlightOverlay.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    border: 2px solid #e94560;
    background: rgba(233, 69, 96, 0.1);
    border-radius: 4px;
    transition: all 0.1s ease;
  `;
  document.body.appendChild(highlightOverlay);
}

function removeHighlightOverlay() {
  if (highlightOverlay) {
    highlightOverlay.remove();
    highlightOverlay = null;
  }
}

function updateHighlight(element: Element | null) {
  if (!highlightOverlay || !element) {
    if (highlightOverlay) {
      highlightOverlay.style.display = "none";
    }
    return;
  }

  const rect = element.getBoundingClientRect();
  highlightOverlay.style.display = "block";
  highlightOverlay.style.top = `${rect.top}px`;
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
}

function findFormLikeParent(element: Element): Element {
  let current: Element | null = element;

  while (current && current !== document.body) {
    // Check if this element contains form inputs
    const inputs = current.querySelectorAll("input, select, textarea");
    if (inputs.length >= 2) {
      // Check for form-like characteristics
      if (current.tagName === "FORM") return current;

      const role = current.getAttribute("role");
      if (role === "form" || role === "dialog") return current;

      const classes = current.className.toLowerCase();
      if (classes.includes("form") || classes.includes("modal") || classes.includes("dialog")) {
        return current;
      }

      // If it has multiple inputs, it's probably a form container
      return current;
    }

    current = current.parentElement;
  }

  return element;
}

function handleInspectMouseMove(e: MouseEvent) {
  if (!isInspecting) return;

  const target = e.target as Element;
  if (!target || target.hasAttribute("data-lily-ignore")) return;

  // Find form-like parent
  const formParent = findFormLikeParent(target);
  if (formParent !== currentTarget) {
    currentTarget = formParent;
    updateHighlight(formParent);
  }
}

// Block all interaction events during inspect mode
function blockEvent(e: Event) {
  if (!isInspecting) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  return false;
}

function handleInspectClick(e: MouseEvent) {
  if (!isInspecting) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const target = e.target as Element;
  if (!target || target.hasAttribute("data-lily-ignore")) return;

  const formParent = findFormLikeParent(target);
  const selector = getSelector(formParent);

  stopInspectMode();

  // Send message back to extension with selected element
  chrome.runtime.sendMessage({
    type: "inspectResult",
    selector,
    tagName: formParent.tagName,
    inputCount: formParent.querySelectorAll("input, select, textarea").length,
  });
}

function handleInspectKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    stopInspectMode();
    chrome.runtime.sendMessage({ type: "inspectCancelled" });
  }
}

function startInspectMode() {
  if (isInspecting) return;

  isInspecting = true;
  createHighlightOverlay();

  // Show instruction overlay
  const instructionEl = document.createElement("div");
  instructionEl.id = "lily-inspect-instruction";
  instructionEl.setAttribute("data-lily-ignore", "true");
  instructionEl.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: #1a1a2e;
    color: #faf9f5;
    padding: 10px 20px;
    border-radius: 8px;
    font-family: system-ui, sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    border: 1px solid #e94560;
  `;
  instructionEl.innerHTML = `
    <span style="color: #e94560; font-weight: 600;">Inspect Mode</span>
    <span style="margin-left: 12px;">Click on the form to select it</span>
    <span style="margin-left: 12px; color: #9b9b9b;">Press <kbd style="background: #333; padding: 2px 6px; border-radius: 3px; font-size: 12px;">Esc</kbd> to cancel</span>
  `;
  document.body.appendChild(instructionEl);

  document.addEventListener("mousemove", handleInspectMouseMove, true);
  document.addEventListener("click", handleInspectClick, true);
  document.addEventListener("keydown", handleInspectKeyDown, true);

  // Block mousedown/pointerdown to prevent element interactions (like Gmail collapsing)
  document.addEventListener("mousedown", blockEvent, true);
  document.addEventListener("pointerdown", blockEvent, true);
  document.addEventListener("mouseup", blockEvent, true);
  document.addEventListener("pointerup", blockEvent, true);

  // Change cursor
  document.body.style.cursor = "crosshair";
}

function stopInspectMode() {
  if (!isInspecting) return;

  isInspecting = false;
  currentTarget = null;

  removeHighlightOverlay();

  // Remove instruction overlay
  const instruction = document.getElementById("lily-inspect-instruction");
  if (instruction) instruction.remove();

  document.removeEventListener("mousemove", handleInspectMouseMove, true);
  document.removeEventListener("click", handleInspectClick, true);
  document.removeEventListener("keydown", handleInspectKeyDown, true);
  document.removeEventListener("mousedown", blockEvent, true);
  document.removeEventListener("pointerdown", blockEvent, true);
  document.removeEventListener("mouseup", blockEvent, true);
  document.removeEventListener("pointerup", blockEvent, true);

  document.body.style.cursor = "";
}

function getElementTitle(element: Element): string {
  // Try to find a title from headings within the element
  const headings = element.querySelectorAll("h1, h2, h3, h4");
  if (headings.length > 0) {
    const text = headings[0].textContent?.trim().split("\n")[0];
    if (text) return text;
  }

  // Try aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  // Try title attribute
  const title = element.getAttribute("title");
  if (title) return title;

  // Use tag name and class as fallback
  const classes = element.className.toString().split(" ").slice(0, 2).join(" ");
  return `${element.tagName.toLowerCase()}${classes ? "." + classes : ""}`;
}

function extractFieldsFromElement(element: Element): any[] {
  const fields: any[] = [];

  // Query for standard form inputs AND contenteditable elements (like Gmail's compose body)
  const inputs = element.querySelectorAll("input, select, textarea, [contenteditable='true'], [contenteditable='']");

  inputs.forEach((el) => {
    const isContentEditable = el.hasAttribute("contenteditable") &&
      (el.getAttribute("contenteditable") === "true" || el.getAttribute("contenteditable") === "");

    // For standard inputs
    if (!isContentEditable) {
      const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

      // Skip hidden, submit, button types
      if (input.type === "hidden" || input.type === "submit" || input.type === "button") {
        return;
      }

      // Find label
      let label = "";

      // Check for explicit label
      const inputEl = input as HTMLInputElement;
      if (inputEl.labels?.length) {
        label = inputEl.labels[0].textContent?.trim() || "";
      } else if (input.id) {
        const labelFor = document.querySelector(`label[for="${input.id}"]`);
        if (labelFor) label = labelFor.textContent?.trim() || "";
      }

      // Check aria-label
      if (!label) {
        label = input.getAttribute("aria-label") || "";
      }

      // Look for label in parent hierarchy
      if (!label) {
        let parent = input.parentElement;
        for (let i = 0; i < 3 && parent; i++) {
          const labelEl = parent.querySelector("label");
          if (labelEl && !parent.querySelector("input, select, textarea")?.isSameNode(input)) {
            // Skip if label is for a different input
          } else if (labelEl) {
            label = labelEl.textContent?.trim() || "";
            break;
          }
          parent = parent.parentElement;
        }
      }

      // Use placeholder as fallback
      if (!label && (input as HTMLInputElement).placeholder) {
        label = (input as HTMLInputElement).placeholder;
      }

      // Skip if no label at all
      if (!label && !input.name && !input.id) return;

      fields.push({
        name: input.name || input.id || "",
        type: input.type || input.tagName.toLowerCase(),
        value: input.value || "",
        label: label || input.name || input.id || "Unknown",
        required: input.required || label.includes("*"),
        selector: getSelector(input),
        placeholder: (input as HTMLInputElement).placeholder || "",
        isMultiline: input.tagName === "TEXTAREA",
      });
    } else {
      // For contenteditable elements (like Gmail compose body)
      let label = "";

      // Check aria-label
      label = el.getAttribute("aria-label") || "";

      // Check role and common patterns
      if (!label) {
        const role = el.getAttribute("role");
        if (role === "textbox") {
          // Look for aria-labelledby
          const labelledBy = el.getAttribute("aria-labelledby");
          if (labelledBy) {
            const labelEl = document.getElementById(labelledBy);
            if (labelEl) label = labelEl.textContent?.trim() || "";
          }
        }
      }

      // Look for label in parent hierarchy
      if (!label) {
        let parent = el.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          // Check for heading or label-like element
          const labelEl = parent.querySelector("label, [class*='label'], [class*='Label']");
          if (labelEl && labelEl.textContent) {
            label = labelEl.textContent.trim().split("\n")[0];
            break;
          }
          parent = parent.parentElement;
        }
      }

      // Common fallbacks for email composers
      if (!label) {
        const placeholder = el.getAttribute("data-placeholder") || el.getAttribute("placeholder");
        if (placeholder) label = placeholder;
      }

      // Default label for contenteditable
      if (!label) {
        label = "Message Body";
      }

      fields.push({
        name: el.id || "body",
        type: "contenteditable",
        value: el.textContent?.trim() || "",
        label,
        required: false,
        selector: getSelector(el),
        placeholder: el.getAttribute("data-placeholder") || "",
        isMultiline: true,
      });
    }
  });

  return fields;
}

// ============ Preview Highlight (for Fill Now) ============

let previewOverlay: HTMLElement | null = null;

function showPreviewHighlight(element: Element | null, label: string) {
  removePreviewHighlight();

  if (!element) return;

  const rect = element.getBoundingClientRect();

  // Create overlay
  previewOverlay = document.createElement("div");
  previewOverlay.setAttribute("data-lily-ignore", "true");
  previewOverlay.style.cssText = `
    position: fixed;
    z-index: 2147483646;
    border: 3px solid #22c55e;
    background: rgba(34, 197, 94, 0.1);
    border-radius: 8px;
    pointer-events: none;
    top: ${rect.top - 3}px;
    left: ${rect.left - 3}px;
    width: ${rect.width + 6}px;
    height: ${rect.height + 6}px;
    transition: all 0.2s ease;
  `;

  // Create label
  const labelEl = document.createElement("div");
  labelEl.setAttribute("data-lily-ignore", "true");
  labelEl.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    top: ${Math.max(rect.top - 36, 8)}px;
    left: ${rect.left}px;
    background: #22c55e;
    color: white;
    padding: 6px 12px;
    border-radius: 6px;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
    pointer-events: none;
  `;
  labelEl.textContent = label;
  labelEl.id = "lily-preview-label";

  document.body.appendChild(previewOverlay);
  document.body.appendChild(labelEl);
}

function removePreviewHighlight() {
  if (previewOverlay) {
    previewOverlay.remove();
    previewOverlay = null;
  }
  const label = document.getElementById("lily-preview-label");
  if (label) label.remove();
}

// ============ Analysis Highlights (for Page Intelligence) ============

let analysisHighlights: HTMLElement[] = [];
let highlightData: { element: Element; highlight: HTMLElement; badge: HTMLElement; tooltip: HTMLElement; target: HighlightTarget }[] = [];

interface HighlightTarget {
  selector: string;
  type: string; // form, button, input, table, link, clickable, dropdown, tab, interactive
  label: string;
  index: number;
}

const typeColors: Record<string, { border: string; bg: string; badge: string }> = {
  form: { border: "#c084fc", bg: "rgba(192, 132, 252, 0.1)", badge: "#c084fc" },
  button: { border: "#22d3ee", bg: "rgba(34, 211, 238, 0.1)", badge: "#22d3ee" },
  input: { border: "#a78bfa", bg: "rgba(167, 139, 250, 0.1)", badge: "#a78bfa" },
  table: { border: "#f472b6", bg: "rgba(244, 114, 182, 0.1)", badge: "#f472b6" },
  link: { border: "#60a5fa", bg: "rgba(96, 165, 250, 0.1)", badge: "#60a5fa" },
  // Additional types from getPageElements
  clickable: { border: "#fbbf24", bg: "rgba(251, 191, 36, 0.1)", badge: "#fbbf24" },
  dropdown: { border: "#34d399", bg: "rgba(52, 211, 153, 0.1)", badge: "#34d399" },
  tab: { border: "#fb7185", bg: "rgba(251, 113, 133, 0.1)", badge: "#fb7185" },
  interactive: { border: "#818cf8", bg: "rgba(129, 140, 248, 0.1)", badge: "#818cf8" },
};

function showAnalysisHighlights(targets: HighlightTarget[]) {
  console.log('[Lily Highlight] showAnalysisHighlights called with', targets.length, 'targets');
  clearAnalysisHighlights();

  // Create container for all highlights
  const container = document.createElement("div");
  container.id = "lily-analysis-container";
  container.setAttribute("data-lily-ignore", "true");
  document.body.appendChild(container);
  analysisHighlights.push(container);
  console.log('[Lily Highlight] Container added to DOM:', document.getElementById('lily-analysis-container') !== null);

  // Add CSS animation styles
  const style = document.createElement("style");
  style.id = "lily-analysis-styles";
  style.textContent = `
    @keyframes lilyPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .lily-highlight-box {
      animation: lilyPulse 2s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
  analysisHighlights.push(style);

  let successCount = 0;
  let failCount = 0;

  targets.forEach((target) => {
    try {
      const element = document.querySelector(target.selector);
      if (!element) {
        console.warn('[Lily Highlight] Selector not found:', target.selector, 'for', target.type, target.label);
        failCount++;
        return;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.warn('[Lily Highlight] Element has zero size:', target.selector, 'width:', rect.width, 'height:', rect.height);
        failCount++;
        return;
      }

      const colors = typeColors[target.type] || typeColors.form;

      // Create highlight box
      const highlight = document.createElement("div");
      highlight.className = "lily-highlight-box";
      highlight.setAttribute("data-lily-ignore", "true");
      highlight.style.cssText = `
        position: fixed;
        z-index: 2147483640;
        border: 2px dashed ${colors.border};
        background: ${colors.bg};
        border-radius: 8px;
        pointer-events: none;
        top: ${rect.top - 4}px;
        left: ${rect.left - 4}px;
        width: ${rect.width + 8}px;
        height: ${rect.height + 8}px;
        box-shadow: 0 0 20px ${colors.bg};
      `;
      container.appendChild(highlight);

      // Create badge with number
      const badge = document.createElement("div");
      badge.setAttribute("data-lily-ignore", "true");
      badge.style.cssText = `
        position: fixed;
        z-index: 2147483641;
        top: ${rect.top - 12}px;
        left: ${rect.left - 12}px;
        width: 24px;
        height: 24px;
        background: ${colors.badge};
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, sans-serif;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        pointer-events: none;
      `;
      badge.textContent = String(target.index);
      container.appendChild(badge);

      // Create label tooltip (positioned to the right of badge)
      const tooltip = document.createElement("div");
      tooltip.setAttribute("data-lily-ignore", "true");
      tooltip.style.cssText = `
        position: fixed;
        z-index: 2147483641;
        top: ${rect.top - 10}px;
        left: ${rect.left + 16}px;
        background: rgba(15, 10, 31, 0.95);
        color: white;
        padding: 4px 10px;
        border-radius: 6px;
        font-family: system-ui, sans-serif;
        font-size: 11px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        pointer-events: none;
        white-space: nowrap;
        border: 1px solid ${colors.border};
      `;
      tooltip.textContent = target.label;
      container.appendChild(tooltip);

      // Store reference for position updates
      highlightData.push({ element, highlight, badge, tooltip, target });
      successCount++;
      console.log('[Lily Highlight] Created highlight for:', target.type, target.label, 'at top:', rect.top, 'left:', rect.left);
    } catch (e) {
      console.warn("[Lily Highlight] Failed to highlight element:", target.selector, e);
      failCount++;
    }
  });

  console.log('[Lily Highlight] Finished: created', successCount, 'highlights, failed:', failCount);

  // Add scroll/resize listeners to update positions
  window.addEventListener('scroll', updateHighlightPositions, { passive: true });
  window.addEventListener('resize', updateHighlightPositions, { passive: true });
}

function clearAnalysisHighlights() {
  // Remove event listeners
  window.removeEventListener('scroll', updateHighlightPositions);
  window.removeEventListener('resize', updateHighlightPositions);

  // Remove DOM elements
  analysisHighlights.forEach((el) => {
    try {
      el.remove();
    } catch {}
  });
  analysisHighlights = [];
  highlightData = [];
}

// Update highlight positions on scroll/resize
function updateHighlightPositions() {
  highlightData.forEach(({ element, highlight, badge, tooltip }) => {
    try {
      const rect = element.getBoundingClientRect();

      // Update highlight box position
      highlight.style.top = `${rect.top - 4}px`;
      highlight.style.left = `${rect.left - 4}px`;
      highlight.style.width = `${rect.width + 8}px`;
      highlight.style.height = `${rect.height + 8}px`;

      // Update badge position
      badge.style.top = `${rect.top - 12}px`;
      badge.style.left = `${rect.left - 12}px`;

      // Update tooltip position
      tooltip.style.top = `${rect.top - 10}px`;
      tooltip.style.left = `${rect.left + 16}px`;
    } catch (e) {
      // Element may have been removed from DOM
    }
  });
}

console.log("[Lily] Content script loaded");
