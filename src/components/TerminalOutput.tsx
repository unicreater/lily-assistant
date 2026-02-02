import { useState } from "react";

interface TerminalOutputProps {
  command: string;
  description?: string;
  result?: string;
  isError?: boolean;
}

export function TerminalOutput({ command, description, result, isError }: TerminalOutputProps) {
  const [expanded, setExpanded] = useState(true);

  // Truncate very long output
  const displayResult = result && result.length > 3000
    ? result.slice(0, 3000) + "\n... (output truncated)"
    : result;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-lily-border/50">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 bg-lily-card/50 hover:bg-lily-card/70 transition-colors"
      >
        <span className="text-sm">💻</span>
        <span className="text-xs font-medium text-lily-text">Run Command</span>
        {description && (
          <span className="text-xs text-lily-muted truncate" title={description}>
            {description}
          </span>
        )}
        <span className="ml-auto text-lily-muted text-xs">
          {expanded ? "▼" : "▶"}
        </span>
        {result !== undefined && (
          <span className={`text-xs ${isError ? "text-red-400" : "text-green-400"}`}>
            {isError ? "✗" : "✓"}
          </span>
        )}
      </button>

      {/* Terminal view */}
      {expanded && (
        <div className="bg-black/50 font-mono text-xs">
          {/* Command */}
          <div className="px-3 py-2 border-b border-lily-border/30">
            <span className="text-green-400 select-none">$ </span>
            <span className="text-lily-text">{command}</span>
          </div>

          {/* Output */}
          {result && (
            <pre className={`px-3 py-2 overflow-x-auto max-h-80 whitespace-pre-wrap ${
              isError ? "text-red-400" : "text-lily-text/80"
            }`}>
              {displayResult}
            </pre>
          )}

          {/* Empty result */}
          {result === "" && (
            <div className="px-3 py-2 text-lily-muted italic">
              (no output)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
