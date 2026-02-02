import { useState } from "react";
import { FileDiff } from "./FileDiff";
import { TerminalOutput } from "./TerminalOutput";
import { FileRead } from "./FileRead";

// Tool use event from Claude stream-json
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, any>;
}

// Tool result event
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | any[];
  is_error?: boolean;
}

interface ToolCallProps {
  toolUse: ToolUseBlock;
  result?: ToolResultBlock;
}

// Map tool names to friendly display names and icons
const TOOL_INFO: Record<string, { icon: string; name: string }> = {
  Read: { icon: "📄", name: "Read File" },
  Write: { icon: "📝", name: "Write File" },
  Edit: { icon: "✏️", name: "Edit File" },
  Bash: { icon: "💻", name: "Run Command" },
  Glob: { icon: "🔍", name: "Find Files" },
  Grep: { icon: "🔎", name: "Search Code" },
  WebSearch: { icon: "🌐", name: "Web Search" },
  WebFetch: { icon: "🔗", name: "Fetch URL" },
  Task: { icon: "📋", name: "Task" },
  TodoWrite: { icon: "✅", name: "Update Todos" },
  AskUser: { icon: "❓", name: "Question" },
};

export function ToolCall({ toolUse, result }: ToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const { name, input, id } = toolUse;

  const info = TOOL_INFO[name] || { icon: "🔧", name };
  const hasError = result?.is_error;
  const resultContent = typeof result?.content === "string"
    ? result.content
    : JSON.stringify(result?.content, null, 2);

  // Render specialized views for specific tools
  if (name === "Edit" && input) {
    return (
      <FileDiff
        filePath={input.file_path}
        oldString={input.old_string}
        newString={input.new_string}
        replaceAll={input.replace_all}
        result={result}
      />
    );
  }

  if (name === "Bash" && input) {
    return (
      <TerminalOutput
        command={input.command}
        description={input.description}
        result={resultContent}
        isError={hasError}
      />
    );
  }

  if (name === "Read" && input) {
    return (
      <FileRead
        filePath={input.file_path}
        offset={input.offset}
        limit={input.limit}
        result={resultContent}
      />
    );
  }

  // Generic tool display for other tools
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-lily-border/50">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 bg-lily-card/50 hover:bg-lily-card/70 transition-colors"
      >
        <span className="text-sm">{info.icon}</span>
        <span className="text-xs font-medium text-lily-text">{info.name}</span>
        {name === "WebSearch" && input?.query && (
          <span className="text-xs text-lily-muted truncate ml-1">"{input.query}"</span>
        )}
        {name === "WebFetch" && input?.url && (
          <span className="text-xs text-lily-muted truncate ml-1">{input.url}</span>
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

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 py-2 text-xs bg-black/20">
          {/* Input */}
          {input && Object.keys(input).length > 0 && (
            <div className="mb-2">
              <div className="text-lily-muted mb-1">Input:</div>
              <pre className="bg-black/30 p-2 rounded overflow-x-auto text-lily-text/80">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {result && (
            <div>
              <div className={`mb-1 ${hasError ? "text-red-400" : "text-lily-muted"}`}>
                {hasError ? "Error:" : "Result:"}
              </div>
              <pre className={`p-2 rounded overflow-x-auto max-h-60 ${
                hasError ? "bg-red-500/10 text-red-400" : "bg-black/30 text-lily-text/80"
              }`}>
                {resultContent?.slice(0, 5000) || "(empty)"}
                {resultContent && resultContent.length > 5000 && "\n... (truncated)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
