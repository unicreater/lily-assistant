import { useState } from "react";

interface FileReadProps {
  filePath: string;
  offset?: number;
  limit?: number;
  result?: string;
}

export function FileRead({ filePath, offset, limit, result }: FileReadProps) {
  const [expanded, setExpanded] = useState(false);

  // Extract just the filename from path
  const fileName = filePath?.split("/").pop() || filePath || "file";

  // Get file extension for syntax hint
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : "";

  // Truncate very long content
  const displayContent = result && result.length > 5000
    ? result.slice(0, 5000) + "\n... (content truncated)"
    : result;

  // Count lines if we have content
  const lineCount = result ? result.split("\n").length : 0;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-lily-border/50">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 bg-lily-card/50 hover:bg-lily-card/70 transition-colors"
      >
        <span className="text-sm">📄</span>
        <span className="text-xs font-medium text-lily-text">Read</span>
        <span className="text-xs text-lily-accent truncate" title={filePath}>
          {fileName}
        </span>
        {(offset || limit) && (
          <span className="text-[10px] px-1.5 py-0.5 bg-lily-border/30 text-lily-muted rounded">
            {offset ? `from L${offset}` : ""}{limit ? ` (${limit} lines)` : ""}
          </span>
        )}
        {result && (
          <span className="text-[10px] text-lily-muted">
            {lineCount} lines
          </span>
        )}
        <span className="ml-auto text-lily-muted text-xs">
          {expanded ? "▼" : "▶"}
        </span>
        {result && (
          <span className="text-xs text-green-400">✓</span>
        )}
      </button>

      {/* File content */}
      {expanded && displayContent && (
        <div className="bg-black/30 overflow-x-auto">
          <pre className="text-xs p-2 max-h-80 overflow-y-auto">
            {displayContent.split("\n").map((line, i) => (
              <div key={i} className="hover:bg-lily-border/10">
                <span className="select-none mr-3 text-lily-muted/50 inline-block w-8 text-right">
                  {(offset || 1) + i}
                </span>
                <span className="text-lily-text/80">{line}</span>
              </div>
            ))}
          </pre>
        </div>
      )}

      {/* Empty file */}
      {expanded && result === "" && (
        <div className="px-3 py-2 text-xs text-lily-muted italic bg-black/20">
          (empty file)
        </div>
      )}

      {/* File not read yet */}
      {expanded && result === undefined && (
        <div className="px-3 py-2 text-xs text-lily-muted bg-black/20">
          Reading file...
        </div>
      )}
    </div>
  );
}
