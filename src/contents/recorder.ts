import type { PlasmoCSConfig } from "plasmo";

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
    const forms = document.querySelectorAll("form");
    const formData: any[] = [];

    forms.forEach((form, formIndex) => {
      const formInfo: any = {
        id: form.id || `form-${formIndex}`,
        selector: getSelector(form),
        action: form.action || window.location.href,
        method: form.method || "GET",
        fields: [],
      };

      // Get all form elements
      const elements = form.querySelectorAll("input, textarea, select");
      elements.forEach((el) => {
        const element = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

        // Skip hidden, submit, and button types
        if (element.type === "hidden" || element.type === "submit" || element.type === "button") {
          return;
        }

        // Find label
        let label = "";
        const labelEl = element.labels?.[0] || document.querySelector(`label[for="${element.id}"]`);
        if (labelEl) {
          label = labelEl.textContent?.trim() || "";
        } else if (element.placeholder) {
          label = element.placeholder;
        } else if (element.getAttribute("aria-label")) {
          label = element.getAttribute("aria-label") || "";
        }

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

    sendResponse({ ok: true, forms: formData, pageUrl: window.location.href });
    return true;
  }

  // Fill a form field
  if (message.type === "fillFormField") {
    const { selector, value } = message;
    try {
      const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (!element) {
        sendResponse({ ok: false, error: `Element not found: ${selector}` });
        return true;
      }

      if (element.tagName === "SELECT") {
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
      } else if (element.type === "checkbox" || element.type === "radio") {
        // Handle checkbox/radio
        (element as HTMLInputElement).checked = value === "true" || value === "1" || value === element.value;
      } else {
        // Handle text inputs
        element.value = value;
      }

      // Dispatch events to trigger any listeners
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));

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
});

console.log("[Lily] Content script loaded");
