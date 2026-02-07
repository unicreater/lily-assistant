/**
 * Generic Page Context Extraction
 *
 * Extracts ALL potentially useful data from any page type.
 * Workflow templates then select what's relevant for their use case.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface CurrencyValue {
  value: string;           // "$35,935.34"
  raw: number;             // 35935.34
  label: string;           // "Portfolio Amount" (nearby text)
  selector: string;        // CSS selector to element
  size: "large" | "medium" | "small";
}

export interface PercentageValue {
  value: string;           // "38.9%"
  raw: number;             // 38.9
  label: string;           // "SPYL" (nearby text)
  context: string;         // Surrounding text for meaning
  selector: string;
}

export interface TableData {
  headers: string[];
  rows: { cells: string[]; selector: string }[];
  selector: string;
}

export interface MetricPair {
  key: string;             // "Unrealized P&L"
  value: string;           // "+$5,924.57"
  selector: string;
}

export interface SymbolData {
  symbol: string;          // "SPYL", "AAPL", "BTC"
  type: "stock" | "crypto" | "unknown";
  associatedValue?: string;
  selector: string;
}

export interface ProductData {
  name: string;
  price: string;
  selector: string;
}

export interface IdentifierData {
  type: "tracking" | "order" | "invoice" | "generic";
  value: string;           // "1Z999AA10123456784"
  carrier?: string;        // "UPS" if detected
  selector: string;
}

export interface DateData {
  value: string;           // "Feb 7, 2026"
  parsed: string;          // ISO format
  context: string;         // "Delivery by", "Last updated"
  selector: string;
}

export interface StatusData {
  status: string;          // "In Transit", "Completed", "Pending"
  context: string;
  sentiment: "positive" | "negative" | "neutral";
  selector: string;
}

export interface FormFieldData {
  name: string;
  type: string;
  label: string;
  required: boolean;
  selector: string;
}

export interface ExtractedPageContext {
  currencies: CurrencyValue[];
  percentages: PercentageValue[];
  tables: TableData[];
  metrics: MetricPair[];
  symbols: SymbolData[];
  products: ProductData[];
  identifiers: IdentifierData[];
  dates: DateData[];
  statuses: StatusData[];
  formFields: FormFieldData[];
}

// ============================================================================
// EXTRACTION FUNCTIONS (to be called from content script)
// ============================================================================

/**
 * Get a unique CSS selector for an element
 */
function getElementSelector(element: Element): string {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const dataTestId = element.getAttribute("data-testid");
  if (dataTestId) {
    return `[data-testid="${CSS.escape(dataTestId)}"]`;
  }

  // Build path
  const path: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && path.length < 4) {
    let selector = current.tagName.toLowerCase();
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).slice(0, 2);
      if (classes.length > 0 && classes[0]) {
        selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}

/**
 * Get nearby text context for an element
 */
function getNearbyText(element: Element, maxLength = 50): string {
  // Try parent's text
  const parent = element.parentElement;
  if (parent) {
    const parentText = parent.textContent?.trim() || '';
    if (parentText.length > 0 && parentText.length < 200) {
      // Remove the element's own text and get what's left
      const ownText = element.textContent?.trim() || '';
      const context = parentText.replace(ownText, '').trim();
      if (context.length > 0) {
        return context.slice(0, maxLength);
      }
    }
  }

  // Try previous sibling
  const prevSibling = element.previousElementSibling;
  if (prevSibling) {
    const siblingText = prevSibling.textContent?.trim() || '';
    if (siblingText.length > 0 && siblingText.length < 100) {
      return siblingText.slice(0, maxLength);
    }
  }

  // Try aria-label or title
  return element.getAttribute('aria-label') ||
         element.getAttribute('title') ||
         '';
}

/**
 * Extract all currency values from the page
 */
export function extractCurrencies(): CurrencyValue[] {
  const results: CurrencyValue[] = [];
  const seen = new Set<string>();

  // Currency patterns for different formats
  const currencyRegex = /[$€£¥₹][\d,]+(?:\.\d{2})?|\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|GBP)/g;

  // Walk visible text nodes
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text)) {
    const text = node.textContent || '';
    const matches = text.matchAll(currencyRegex);

    for (const match of matches) {
      const value = match[0];
      if (seen.has(value)) continue;
      seen.add(value);

      // Parse the raw number
      const rawStr = value.replace(/[$€£¥₹,\s]|USD|EUR|GBP/g, '');
      const raw = parseFloat(rawStr);
      if (isNaN(raw)) continue;

      const element = node.parentElement;
      if (!element) continue;

      // Determine size category
      let size: "large" | "medium" | "small" = "small";
      if (raw >= 10000) size = "large";
      else if (raw >= 100) size = "medium";

      results.push({
        value,
        raw,
        label: getNearbyText(element),
        selector: getElementSelector(element),
        size,
      });
    }
  }

  // Sort by value (largest first)
  return results.sort((a, b) => b.raw - a.raw).slice(0, 20);
}

/**
 * Extract all percentages from the page
 */
export function extractPercentages(): PercentageValue[] {
  const results: PercentageValue[] = [];
  const seen = new Set<string>();

  const percentRegex = /[+-]?\d+(?:\.\d+)?%/g;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text)) {
    const text = node.textContent || '';
    const matches = text.matchAll(percentRegex);

    for (const match of matches) {
      const value = match[0];
      const key = `${value}-${match.index}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const rawStr = value.replace('%', '');
      const raw = parseFloat(rawStr);
      if (isNaN(raw)) continue;

      const element = node.parentElement;
      if (!element) continue;

      results.push({
        value,
        raw,
        label: getNearbyText(element),
        context: text.slice(0, 100),
        selector: getElementSelector(element),
      });
    }
  }

  return results.slice(0, 30);
}

/**
 * Extract tables from the page
 */
export function extractTables(): TableData[] {
  const results: TableData[] = [];

  document.querySelectorAll('table, [role="grid"], [role="table"]').forEach(table => {
    const headers: string[] = [];
    const rows: { cells: string[]; selector: string }[] = [];

    // Get headers
    table.querySelectorAll('th, [role="columnheader"]').forEach(th => {
      headers.push(th.textContent?.trim() || '');
    });

    // Get rows
    table.querySelectorAll('tr, [role="row"]').forEach((row, index) => {
      if (index === 0 && headers.length > 0) return; // Skip header row

      const cells: string[] = [];
      row.querySelectorAll('td, [role="cell"], [role="gridcell"]').forEach(cell => {
        cells.push(cell.textContent?.trim().slice(0, 100) || '');
      });

      if (cells.length > 0) {
        rows.push({
          cells,
          selector: getElementSelector(row),
        });
      }
    });

    if (rows.length > 0) {
      results.push({
        headers,
        rows: rows.slice(0, 20), // Limit rows
        selector: getElementSelector(table),
      });
    }
  });

  return results.slice(0, 5);
}

/**
 * Extract key-value metrics
 */
export function extractMetrics(): MetricPair[] {
  const results: MetricPair[] = [];
  const seen = new Set<string>();

  // Look for common metric patterns
  const metricSelectors = [
    '[class*="metric"]',
    '[class*="stat"]',
    '[class*="kpi"]',
    '[class*="summary"]',
    'dt + dd',
    '[class*="label"] + [class*="value"]',
  ];

  metricSelectors.forEach(selector => {
    try {
      document.querySelectorAll(selector).forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.length < 50 && text.length > 0) {
          const parent = el.parentElement;
          const key = getNearbyText(el) || parent?.textContent?.trim().replace(text, '').trim() || '';
          if (key && !seen.has(key)) {
            seen.add(key);
            results.push({
              key: key.slice(0, 50),
              value: text,
              selector: getElementSelector(el),
            });
          }
        }
      });
    } catch {}
  });

  return results.slice(0, 20);
}

/**
 * Extract stock/crypto symbols
 */
export function extractSymbols(): SymbolData[] {
  const results: SymbolData[] = [];
  const seen = new Set<string>();

  // Common crypto symbols
  const cryptoSymbols = new Set(['BTC', 'ETH', 'USDT', 'BNB', 'XRP', 'ADA', 'DOGE', 'SOL', 'DOT', 'MATIC']);

  // Stock symbol pattern (2-5 uppercase letters)
  const symbolRegex = /\b[A-Z]{2,5}\b/g;

  const text = document.body.innerText;
  const matches = text.matchAll(symbolRegex);

  for (const match of matches) {
    const symbol = match[0];
    if (seen.has(symbol)) continue;

    // Filter out common words
    const commonWords = new Set(['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HAD', 'HER', 'WAS', 'ONE', 'OUR', 'OUT']);
    if (commonWords.has(symbol)) continue;

    seen.add(symbol);

    const type = cryptoSymbols.has(symbol) ? 'crypto' : 'stock';

    // Try to find associated value
    const context = text.slice(Math.max(0, match.index! - 20), match.index! + symbol.length + 30);
    const valueMatch = context.match(/[$€£]\d+(?:\.\d+)?|\d+(?:\.\d+)?%/);

    results.push({
      symbol,
      type,
      associatedValue: valueMatch?.[0],
      selector: 'body', // Generic since found via text search
    });
  }

  return results.slice(0, 20);
}

/**
 * Extract product information
 */
export function extractProducts(): ProductData[] {
  const results: ProductData[] = [];

  // Look for product-like structures
  const productSelectors = [
    '[class*="product"]',
    '[class*="item"]',
    '[itemtype*="Product"]',
    '[data-product]',
  ];

  productSelectors.forEach(selector => {
    try {
      document.querySelectorAll(selector).forEach(el => {
        // Look for name
        const nameEl = el.querySelector('h1, h2, h3, [class*="title"], [class*="name"]');
        const name = nameEl?.textContent?.trim() || '';

        // Look for price
        const priceEl = el.querySelector('[class*="price"], [data-price]');
        const priceText = priceEl?.textContent?.trim() || '';
        const priceMatch = priceText.match(/[$€£¥]\d+(?:\.\d{2})?/);
        const price = priceMatch?.[0] || '';

        if (name && price) {
          results.push({
            name: name.slice(0, 100),
            price,
            selector: getElementSelector(el),
          });
        }
      });
    } catch {}
  });

  return results.slice(0, 10);
}

/**
 * Extract tracking numbers and identifiers
 */
export function extractIdentifiers(): IdentifierData[] {
  const results: IdentifierData[] = [];
  const text = document.body.innerText;

  // UPS: 1Z + 16 alphanumeric
  const upsMatch = text.match(/\b1Z[A-Z0-9]{16}\b/i);
  if (upsMatch) {
    results.push({
      type: 'tracking',
      value: upsMatch[0],
      carrier: 'UPS',
      selector: 'body',
    });
  }

  // FedEx: 12 or 15 digits
  const fedexMatch = text.match(/\b(\d{12}|\d{15})\b/);
  if (fedexMatch && /fedex/i.test(text)) {
    results.push({
      type: 'tracking',
      value: fedexMatch[0],
      carrier: 'FedEx',
      selector: 'body',
    });
  }

  // USPS: 20-22 digits
  const uspsMatch = text.match(/\b\d{20,22}\b/);
  if (uspsMatch) {
    results.push({
      type: 'tracking',
      value: uspsMatch[0],
      carrier: 'USPS',
      selector: 'body',
    });
  }

  // Order numbers: ORD-XXX, #12345, Order: 12345
  const orderMatch = text.match(/(?:order[:\s#]*|ORD[-_]?)(\d{4,10})/i);
  if (orderMatch) {
    results.push({
      type: 'order',
      value: orderMatch[1],
      selector: 'body',
    });
  }

  return results;
}

/**
 * Extract dates
 */
export function extractDates(): DateData[] {
  const results: DateData[] = [];

  // Various date patterns
  const datePatterns = [
    /(\w{3,9}\s+\d{1,2},?\s+\d{4})/g,  // January 15, 2026
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/g,     // 01/15/2026
    /(\d{4}-\d{2}-\d{2})/g,              // 2026-01-15
  ];

  const text = document.body.innerText;

  datePatterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const value = match[0];

      // Try to parse
      const parsed = new Date(value);
      if (isNaN(parsed.getTime())) continue;

      // Get context
      const start = Math.max(0, match.index! - 30);
      const context = text.slice(start, match.index!).trim();

      results.push({
        value,
        parsed: parsed.toISOString(),
        context: context.slice(-30),
        selector: 'body',
      });
    }
  });

  return results.slice(0, 10);
}

/**
 * Extract status indicators
 */
export function extractStatuses(): StatusData[] {
  const results: StatusData[] = [];

  const positiveStatuses = ['completed', 'delivered', 'success', 'active', 'approved', 'confirmed', 'paid', 'in stock'];
  const negativeStatuses = ['failed', 'cancelled', 'rejected', 'error', 'expired', 'out of stock', 'declined'];
  const neutralStatuses = ['pending', 'processing', 'in transit', 'shipped', 'awaiting', 'scheduled'];

  const allStatuses = [...positiveStatuses, ...negativeStatuses, ...neutralStatuses];

  const text = document.body.innerText.toLowerCase();

  allStatuses.forEach(status => {
    if (text.includes(status)) {
      let sentiment: "positive" | "negative" | "neutral" = "neutral";
      if (positiveStatuses.includes(status)) sentiment = "positive";
      if (negativeStatuses.includes(status)) sentiment = "negative";

      // Get context
      const index = text.indexOf(status);
      const context = text.slice(Math.max(0, index - 20), index + status.length + 20);

      results.push({
        status: status.charAt(0).toUpperCase() + status.slice(1),
        context,
        sentiment,
        selector: 'body',
      });
    }
  });

  return results.slice(0, 10);
}

/**
 * Extract form fields
 */
export function extractFormFields(): FormFieldData[] {
  const results: FormFieldData[] = [];

  document.querySelectorAll('input, select, textarea').forEach(input => {
    const el = input as HTMLInputElement;
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;

    const label = el.labels?.[0]?.textContent?.trim() ||
                  el.placeholder ||
                  el.getAttribute('aria-label') ||
                  el.name ||
                  '';

    results.push({
      name: el.name || el.id || '',
      type: el.type || el.tagName.toLowerCase(),
      label: label.slice(0, 50),
      required: el.required || el.getAttribute('aria-required') === 'true',
      selector: getElementSelector(el),
    });
  });

  return results;
}

/**
 * Extract ALL context from the page
 */
export function extractAllContext(): ExtractedPageContext {
  return {
    currencies: extractCurrencies(),
    percentages: extractPercentages(),
    tables: extractTables(),
    metrics: extractMetrics(),
    symbols: extractSymbols(),
    products: extractProducts(),
    identifiers: extractIdentifiers(),
    dates: extractDates(),
    statuses: extractStatuses(),
    formFields: extractFormFields(),
  };
}
