import type { SlashCommand } from "~hooks/useSlashCommands";

interface TemplateItem {
  id: string;
  name: string;
  fieldCount: number;
  isDefault: boolean;
}

interface Props {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  templates?: TemplateItem[];
  onSelectTemplate?: (templateName: string) => void;
}

export function SlashCommandMenu({ commands, selectedIndex, onSelect, templates, onSelectTemplate }: Props) {
  if (commands.length === 0) return null;

  // Check if autofill command is visible
  const autofillVisible = commands.some((cmd) => cmd.name === "autofill");

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 glass-card rounded-lg overflow-hidden border border-lily-border shadow-lg max-h-80 overflow-y-auto">
      {commands.map((cmd, i) => (
        <div key={cmd.name}>
          <button
            onClick={() => onSelect(i)}
            className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors ${
              i === selectedIndex
                ? "bg-lily-accent/10 text-lily-text"
                : "text-lily-muted hover:bg-lily-accent/5"
            }`}
          >
            <span className="text-sm font-medium text-lily-accent">/{cmd.name}</span>
            <span className="text-xs text-lily-muted">{cmd.description}</span>
          </button>
          {/* Show templates as sub-items under autofill when it's selected */}
          {cmd.name === "autofill" && i === selectedIndex && templates && templates.length > 0 && onSelectTemplate && (
            <div className="bg-black/20 border-t border-lily-border/30">
              <div className="px-3 py-1 text-[10px] text-lily-muted uppercase tracking-wider">Templates</div>
              {templates.map((template) => (
                <button
                  key={template.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTemplate(template.name);
                  }}
                  className="w-full px-4 py-1.5 text-left flex items-center justify-between hover:bg-lily-accent/10 transition-colors"
                >
                  <span className="text-xs flex items-center gap-1.5">
                    {template.isDefault && <span className="text-yellow-400">★</span>}
                    <span className="text-lily-text">{template.name}</span>
                  </span>
                  <span className="text-[10px] text-lily-muted">{template.fieldCount} fields</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="px-3 py-1.5 text-xs text-lily-muted border-t border-lily-border bg-black/20">
        <kbd className="px-1 py-0.5 bg-lily-border/30 rounded text-[10px]">↑↓</kbd> navigate
        <span className="mx-2">·</span>
        <kbd className="px-1 py-0.5 bg-lily-border/30 rounded text-[10px]">Enter</kbd> select
        <span className="mx-2">·</span>
        <kbd className="px-1 py-0.5 bg-lily-border/30 rounded text-[10px]">Esc</kbd> close
      </div>
    </div>
  );
}
