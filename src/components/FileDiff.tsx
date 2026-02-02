import { useState } from "react";
import type { ToolResultBlock } from "./ToolCall";

interface FileDiffProps {
  filePath: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  result?: ToolResultBlock;
}

// Simple diff highlighting - shows removed and added lines
function computeDiff(oldStr: string, newStr: string): { type: "same" | "removed" | "added"; text: string }[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const result: { type: "same" | "removed" | "added"; text: string }[] = [];

  // Simple LCS-based diff
  const maxLen = Math.max(oldLines.length, newLines.length);

  // For simple cases, show inline diff
  if (oldLines.length === newLines.length && oldLines.length <= 20) {
    for (let i = 0; i < oldLines.length; i++) {
      if (oldLines[i] !== newLines[i]) {
        if (oldLines[i]) result.push({ type: "removed", text: oldLines[i] });
        if (newLines[i]) result.push({ type: "added", text: newLines[i] });
      } else {
        result.push({ type: "same", text: oldLines[i] });
      }
    }
    return result;
  }

  // For complex cases, show old then new with clear separation
  for (const line of oldLines) {
    result.push({ type: "removed", text: line });
  }
  for (const line of newLines) {
    result.push({ type: "added", text: line });
  }

  return result;
}

export function FileDiff({ filePath, oldString, newString, replaceAll, result }: FileDiffProps) {
  const [expanded, setExpanded] = useState(true);
  const hasError = result?.is_error;

  // Extract just the filename from path
  const fileName = filePath?.split("/").pop() || filePath || "file";

  // Compute diff if we have both strings
  const diffLines = oldString && newString ? computeDiff(oldString, newString) : null;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-lily-border/50">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 bg-lily-card/50 hover:bg-lily-card/70 transition-colors"
      >
        <span className="text-sm">✏️</span>
        <span className="text-xs font-medium text-lily-text">Edit</span>
        <span className="text-xs text-lily-accent truncate" title={filePath}>
          {fileName}
        </span>
        {replaceAll && (
          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
            replace all
          </span>
        )}
        <span className="ml-auto text-lily-muted text-xs">
          {expanded ? "▼" : "▶"}
        </span>
        {result && (
          <span className={`text-xs ${hasError ? "text-red-400" : "text-green-400"}`}>
            {hasError ? "✗" : "✓"}
          </span>
        )}
      </button>

      {/* Diff view */}
      {expanded && diffLines && (
        <div className="bg-black/30 overflow-x-auto">
          <pre className="text-xs p-2">
            {diffLines.map((line, i) => (
              <div
                key={i}
                className={`${
                  line.type === "removed"
                    ? "bg-red-500/20 text-red-300"
                    : line.type === "added"
                    ? "bg-green-500/20 text-green-300"
                    : "text-lily-text/70"
                }`}
              >
                <span className="select-none mr-2 opacity-50">
                  {line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}
                </span>
                {line.text}
              </div>
            ))}
          </pre>
        </div>
      )}

      {/* Fallback if no diff data */}
      {expanded && !diffLines && (
        <div className="px-3 py-2 text-xs bg-black/20">
          <div className="text-lily-muted">
            File path: <span className="text-lily-text">{filePath}</span>
          </div>
          {oldString && (
            <div className="mt-2">
              <div className="text-red-400 mb-1">- Remove:</div>
              <pre className="bg-red-500/10 p-2 rounded text-red-300 overflow-x-auto">
                {oldString.slice(0, 500)}
                {oldString.length > 500 && "..."}
              </pre>
            </div>
          )}
          {newString && (
            <div className="mt-2">
              <div className="text-green-400 mb-1">+ Add:</div>
              <pre className="bg-green-500/10 p-2 rounded text-green-300 overflow-x-auto">
                {newString.slice(0, 500)}
                {newString.length > 500 && "..."}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {expanded && hasError && result && (
        <div className="px-3 py-2 text-xs bg-red-500/10 text-red-400 border-t border-red-500/20">
          {typeof result.content === "string" ? result.content : JSON.stringify(result.content)}
        </div>
      )}
    </div>
  );
}
