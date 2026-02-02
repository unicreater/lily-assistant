import type { SlashCommand } from "~hooks/useSlashCommands";

interface Props {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function SlashCommandMenu({ commands, selectedIndex, onSelect }: Props) {
  if (commands.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 glass-card rounded-lg overflow-hidden border border-lily-border shadow-lg">
      {commands.map((cmd, i) => (
        <button
          key={cmd.name}
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
