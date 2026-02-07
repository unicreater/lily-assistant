export interface ThemePalette {
  label: string;
  bg: string;
  bgDeep: string;
  card: string;
  accent: string;
  accentHover: string;
  text: string;
  muted: string;
  border: string;
  // Gradient mesh colors for animated background
  gradientA: string;
  gradientB: string;
  gradientC: string;
  gradientD: string;
  gradientE: string;
}

export const THEMES: Record<string, ThemePalette> = {
  // Aurora: deep purple-to-blue with pink highlights
  aurora: {
    label: "Aurora",
    bg: "#0f0a1f",
    bgDeep: "#0a0816",
    card: "#1a1030",
    accent: "#c084fc",
    accentHover: "#d8b4fe",
    text: "#f0f0ff",
    muted: "#8b84a8",
    border: "#2e2050",
    gradientA: "rgba(147, 51, 234, 0.8)",   // Purple
    gradientB: "rgba(59, 130, 246, 0.65)",  // Blue
    gradientC: "rgba(236, 72, 153, 0.4)",   // Pink
    gradientD: "rgba(79, 70, 229, 0.55)",   // Indigo
    gradientE: "rgba(192, 132, 252, 0.3)",  // Light purple
  },
  // Midnight: deep navy-to-indigo with subtle teal
  midnight: {
    label: "Midnight",
    bg: "#050a1a",
    bgDeep: "#030714",
    card: "#0a1630",
    accent: "#06b6d4",
    accentHover: "#22d3ee",
    text: "#e0f2fe",
    muted: "#7ba3ad",
    border: "#1e3a50",
    gradientA: "rgba(30, 58, 138, 0.8)",    // Deep blue
    gradientB: "rgba(15, 118, 110, 0.5)",   // Teal
    gradientC: "rgba(49, 46, 129, 0.6)",    // Indigo
    gradientD: "rgba(30, 64, 175, 0.4)",    // Blue
    gradientE: "rgba(6, 95, 115, 0.3)",     // Dark teal
  },
  // Ember: dark charcoal with warm rose and amber
  ember: {
    label: "Ember",
    bg: "#100a0a",
    bgDeep: "#0b0808",
    card: "#1c0e12",
    accent: "#e94560",
    accentHover: "#ff6b6b",
    text: "#ffeef0",
    muted: "#a08888",
    border: "#3a2028",
    gradientA: "rgba(159, 18, 57, 0.55)",   // Rose
    gradientB: "rgba(180, 83, 9, 0.35)",    // Amber
    gradientC: "rgba(136, 19, 55, 0.4)",    // Dark rose
    gradientD: "rgba(120, 53, 15, 0.28)",   // Brown
    gradientE: "rgba(244, 114, 182, 0.2)",  // Pink
  },
  // Prism: multi-color gradient mesh
  prism: {
    label: "Prism",
    bg: "#0b081a",
    bgDeep: "#0a0a16",
    card: "#12082e",
    accent: "#a855f7",
    accentHover: "#c084fc",
    text: "#f0f0ff",
    muted: "#8b84a8",
    border: "#2e2050",
    gradientA: "rgba(147, 51, 234, 0.7)",   // Purple
    gradientB: "rgba(6, 182, 212, 0.55)",   // Cyan
    gradientC: "rgba(236, 72, 153, 0.5)",   // Pink
    gradientD: "rgba(59, 130, 246, 0.4)",   // Blue
    gradientE: "rgba(16, 185, 129, 0.2)",   // Emerald
  },
  // Obsidian: near-black with subtle deep purple/green hints
  obsidian: {
    label: "Obsidian",
    bg: "#08080e",
    bgDeep: "#06060a",
    card: "#0a0c12",
    accent: "#10b981",
    accentHover: "#34d399",
    text: "#e4efe8",
    muted: "#6b7a70",
    border: "#1a2020",
    gradientA: "rgba(21, 94, 117, 0.3)",    // Dark teal
    gradientB: "rgba(30, 58, 95, 0.22)",    // Navy
    gradientC: "rgba(22, 78, 99, 0.18)",    // Dark cyan
    gradientD: "rgba(110, 231, 183, 0.06)", // Light emerald
    gradientE: "rgba(52, 211, 153, 0.05)",  // Emerald
  },
};

export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME: ThemeId = "aurora";

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

export function applyTheme(id: ThemeId) {
  const t = THEMES[id];
  if (!t) return;

  const root = document.documentElement.style;

  // Base colors
  root.setProperty("--lily-bg", t.bg);
  root.setProperty("--lily-bg-deep", t.bgDeep);
  root.setProperty("--lily-card", t.card);
  root.setProperty("--lily-accent", t.accent);
  root.setProperty("--lily-accent-hover", t.accentHover);
  root.setProperty("--lily-text", t.text);
  root.setProperty("--lily-muted", t.muted);
  root.setProperty("--lily-border", t.border);

  // Gradient mesh colors
  root.setProperty("--lily-gradient-a", t.gradientA);
  root.setProperty("--lily-gradient-b", t.gradientB);
  root.setProperty("--lily-gradient-c", t.gradientC);
  root.setProperty("--lily-gradient-d", t.gradientD);
  root.setProperty("--lily-gradient-e", t.gradientE);

  // Derived RGBA values for glassmorphism
  const cardRgb = hexToRgb(t.card);
  const accentRgb = hexToRgb(t.accent);
  root.setProperty("--lily-card-t", `rgba(${cardRgb}, 0.7)`);
  root.setProperty("--lily-card-glass", `rgba(${cardRgb}, 0.4)`);
  root.setProperty("--lily-card-glass-light", `rgba(${cardRgb}, 0.3)`);
  root.setProperty("--lily-accent-glow", `rgba(${accentRgb}, 0.35)`);
  root.setProperty("--lily-accent-subtle", `rgba(${accentRgb}, 0.15)`);
  root.setProperty("--lily-accent-border", `rgba(${accentRgb}, 0.3)`);
}
