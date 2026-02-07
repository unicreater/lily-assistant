import { useState, useEffect } from "react";
import { THEMES, THEME_IDS, DEFAULT_THEME, applyTheme, type ThemeId } from "~lib/themes";

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

export function SettingsView() {
  const [activeTheme, setActiveTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    sendNative("getState", { key: "theme" }).then((res) => {
      if (res?.ok && res.data?.id && THEMES[res.data.id]) {
        setActiveTheme(res.data.id);
      }
    }).catch(() => {});
  }, []);

  const selectTheme = async (id: ThemeId) => {
    setActiveTheme(id);
    applyTheme(id);
    setSaving(true);
    try {
      await sendNative("setState", { key: "theme", data: { id } });
    } catch {}
    setSaving(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      <h2 className="text-base font-semibold mb-4">Settings</h2>

      <div className="text-[10px] font-semibold text-lily-muted uppercase tracking-wider mb-3">
        Theme
      </div>

      <div className="grid grid-cols-2 gap-3">
        {THEME_IDS.map((id) => {
          const t = THEMES[id];
          const selected = id === activeTheme;
          // Build gradient background from theme colors
          const gradientBg = `
            radial-gradient(ellipse 80% 60% at 20% 10%, ${t.gradientA} 0%, transparent 55%),
            radial-gradient(ellipse 70% 80% at 80% 80%, ${t.gradientB} 0%, transparent 50%),
            radial-gradient(ellipse 50% 40% at 60% 30%, ${t.gradientC} 0%, transparent 45%),
            ${t.bg}
          `;
          return (
            <button
              key={id}
              onClick={() => selectTheme(id)}
              className={`rounded-xl p-3 text-left transition-all overflow-hidden relative ${
                selected
                  ? "ring-2 ring-lily-accent glass-glow"
                  : "ring-1 ring-lily-border hover:ring-lily-muted"
              }`}
              style={{ background: gradientBg }}
            >
              {/* Glass overlay */}
              <div
                className="absolute inset-0 backdrop-blur-sm"
                style={{ background: `rgba(0, 0, 0, 0.25)` }}
              />

              {/* Content on top */}
              <div className="relative z-10">
                {/* Color swatch strip */}
                <div className="flex gap-1.5 mb-2">
                  <div
                    className="w-5 h-5 rounded-md"
                    style={{ background: t.card, border: `1px solid ${t.border}` }}
                  />
                  <div
                    className="w-5 h-5 rounded-md"
                    style={{
                      background: t.accent,
                      boxShadow: `0 0 8px ${t.accent}40`
                    }}
                  />
                  <div
                    className="w-5 h-5 rounded-md"
                    style={{ background: t.accentHover }}
                  />
                  <div
                    className="w-5 h-5 rounded-md"
                    style={{ background: t.muted, opacity: 0.6 }}
                  />
                </div>

                {/* Theme name */}
                <div className="text-xs font-medium" style={{ color: t.text }}>
                  {t.label}
                </div>

                {/* Selected indicator */}
                {selected && (
                  <div className="text-[10px] mt-1 font-medium" style={{ color: t.accent }}>
                    Active
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {saving && (
        <div className="text-xs text-lily-muted mt-3 text-center">Saving...</div>
      )}
    </div>
  );
}
