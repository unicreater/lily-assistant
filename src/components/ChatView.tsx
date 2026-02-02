import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { GoalsView } from "~components/GoalsView";
import { HistoryView } from "~components/HistoryView";
import { IntegrationsView } from "~components/IntegrationsView";
import { MemoryView } from "~components/MemoryView";
import { SkillsView } from "~components/SkillsView";
import { SlashCommandMenu } from "~components/SlashCommandMenu";
import { ThoughtDumpView } from "~components/ThoughtDumpView";
import { WorkflowsView } from "~components/WorkflowsView";
import { ToolCall, type ToolUseBlock, type ToolResultBlock } from "~components/ToolCall";
import { useSlashCommands, type SlashCommand } from "~hooks/useSlashCommands";

interface Message {
  role: "user" | "assistant";
  text: string;
  // Rich content from Claude events
  toolCalls?: ToolUseBlock[];
  toolResults?: Map<string, ToolResultBlock>;
}

// Claude stream-json event types
interface ClaudeEvent {
  type: "system" | "assistant" | "user" | "result" | "error" | "cancelled";
  subtype?: string;
  session_id?: string;
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: any;
      tool_use_id?: string;
      content?: string | any[];
      is_error?: boolean;
    }>;
  };
  result?: string;
  error?: string;
}

interface Attachment {
  name: string;
  type: string;
  content: string;
  size: number;
}

// Supported text file extensions
const SUPPORTED_EXTENSIONS = new Set([
  // Text
  ".txt", ".md",
  // Data
  ".json", ".csv", ".xml", ".yaml", ".yml", ".toml",
  // Code
  ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".rb", ".php",
  // Web
  ".html", ".css",
  // Shell
  ".sh", ".bash", ".zsh",
]);

// Sensitive file patterns to warn about
const SENSITIVE_PATTERNS = [".env", ".pem", ".key", "credentials", "secret", "password"];

const MAX_FILE_SIZE = 500 * 1024; // 500 KB per file
const MAX_TOTAL_SIZE = 1024 * 1024; // 1 MB total

interface Session {
  id: string;
  title: string;
  started: string;
  lastActive?: string;
  claudeSessionId?: string;
  hasContext?: boolean;
}

type Tab = "chat" | "memory" | "skills" | "integrations" | "workflows" | "goals" | "history";

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

// Simple markdown renderer
function renderMarkdown(text: string): React.ReactNode {
  // Debug: log if we find markdown links in the text
  if (text.includes('[') && text.includes('](')) {
    console.log('[Markdown] Found potential link in:', text.slice(0, 100));
    const linkTest = text.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
    console.log('[Markdown] Link regex match:', linkTest ? 'YES' : 'NO');
  }
  // Split into lines for block-level processing
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  const processInline = (line: string): React.ReactNode => {
    // Process inline markdown: **bold**, *italic*, `code`, [link](url)
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
      // Bold **text**
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      // Italic *text*
      const italicMatch = remaining.match(/(?<!\*)\*([^*]+)\*(?!\*)/);
      // Code `text`
      const codeMatch = remaining.match(/`([^`]+)`/);
      // Link [text](url) - match URL until closing paren (URLs rarely have unencoded parens)
      const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
      if (remaining.includes('[') && remaining.includes('](')) {
        console.log('[processInline] checking for link in:', remaining.slice(0, 80));
        console.log('[processInline] linkMatch:', linkMatch ? `YES: ${linkMatch[1]}` : 'NO');
      }

      const matches = [
        boldMatch && { type: "bold", match: boldMatch, index: boldMatch.index! },
        italicMatch && { type: "italic", match: italicMatch, index: italicMatch.index! },
        codeMatch && { type: "code", match: codeMatch, index: codeMatch.index! },
        linkMatch && { type: "link", match: linkMatch, index: linkMatch.index! },
      ].filter(Boolean).sort((a, b) => a!.index - b!.index);

      if (matches.length === 0) {
        // Also detect bare URLs and make them clickable
        const bareUrlMatch = remaining.match(/https?:\/\/[^\s<>\[\]]+/);
        if (bareUrlMatch && bareUrlMatch.index !== undefined) {
          if (bareUrlMatch.index > 0) {
            parts.push(remaining.slice(0, bareUrlMatch.index));
          }
          const url = bareUrlMatch[0].replace(/[.,;:!?)]+$/, ''); // Trim trailing punctuation
          parts.push(
            <a
              key={key++}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lily-accent hover:underline break-all"
            >
              {url.length > 50 ? url.slice(0, 50) + '...' : url}
            </a>
          );
          remaining = remaining.slice(bareUrlMatch.index + url.length);
          continue;
        }
        parts.push(remaining);
        break;
      }

      const first = matches[0]!;
      if (first.index > 0) {
        parts.push(remaining.slice(0, first.index));
      }

      if (first.type === "bold") {
        parts.push(<strong key={key++} className="font-semibold">{first.match![1]}</strong>);
      } else if (first.type === "italic") {
        parts.push(<em key={key++}>{first.match![1]}</em>);
      } else if (first.type === "code") {
        parts.push(<code key={key++} className="bg-lily-border/30 px-1 rounded text-xs">{first.match![1]}</code>);
      } else if (first.type === "link") {
        const linkText = first.match![1];
        const linkUrl = first.match![2];
        parts.push(
          <a
            key={key++}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lily-accent hover:underline"
          >
            {linkText}
          </a>
        );
      }

      remaining = remaining.slice(first.index + first.match![0].length);
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={i} className="bg-black/30 rounded p-2 text-xs overflow-x-auto my-2">
            <code>{codeBlockContent.join("\n")}</code>
          </pre>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Tables
    if (line.includes("|") && line.trim().startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      if (cells.length > 0) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        // Skip separator row (---|---)
        if (!cells.every(c => /^[-:]+$/.test(c))) {
          tableRows.push(cells);
        }
        continue;
      }
    } else if (inTable) {
      // End table
      elements.push(
        <table key={i} className="text-xs my-2 w-full">
          <tbody>
            {tableRows.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? "font-semibold border-b border-lily-border" : ""}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-2 py-1">{processInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      tableRows = [];
      inTable = false;
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(<h4 key={i} className="font-semibold text-sm mt-3 mb-1">{processInline(line.slice(4))}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={i} className="font-semibold text-sm mt-3 mb-1 text-lily-accent">{processInline(line.slice(3))}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={i} className="font-bold text-base mt-3 mb-2 text-lily-accent">{processInline(line.slice(2))}</h2>);
    }
    // Horizontal rule
    else if (line.match(/^[-*_]{3,}$/)) {
      elements.push(<hr key={i} className="border-lily-border my-2" />);
    }
    // List items
    else if (line.match(/^[-*]\s/) || line.match(/^\d+\.\s/)) {
      const content = line.replace(/^[-*]\s/, "").replace(/^\d+\.\s/, "");
      // Checkbox
      if (content.startsWith("[ ] ")) {
        elements.push(<div key={i} className="flex items-start gap-2 ml-2"><span className="text-lily-muted">☐</span><span>{processInline(content.slice(4))}</span></div>);
      } else if (content.startsWith("[x] ") || content.startsWith("[X] ")) {
        elements.push(<div key={i} className="flex items-start gap-2 ml-2"><span className="text-green-400">☑</span><span>{processInline(content.slice(4))}</span></div>);
      } else {
        elements.push(<div key={i} className="flex items-start gap-2 ml-2"><span className="text-lily-accent">•</span><span>{processInline(content)}</span></div>);
      }
    }
    // Empty line
    else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    }
    // Regular paragraph
    else {
      elements.push(<p key={i}>{processInline(line)}</p>);
    }
  }

  // Close any open table
  if (inTable && tableRows.length > 0) {
    elements.push(
      <table key="final-table" className="text-xs my-2 w-full">
        <tbody>
          {tableRows.map((row, ri) => (
            <tr key={ri} className={ri === 0 ? "font-semibold border-b border-lily-border" : ""}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-2 py-1">{processInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return <div className="space-y-1 break-anywhere">{elements}</div>;
}

interface MemoryProject {
  id: string;
  name: string;
  description: string;
}

export function ChatView() {
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showDump, setShowDump] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Memory project selection
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  // Attachment menu
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [hasMcpGithub, setHasMcpGithub] = useState(false);
  const [hasMcpNotion, setHasMcpNotion] = useState(false);
  const [memoryProjects, setMemoryProjects] = useState<MemoryProject[]>([]);
  const [activeMemoryProject, setActiveMemoryProject] = useState<MemoryProject | null>(null);
  const [pendingAuthPrompt, setPendingAuthPrompt] = useState<{ name: string; prompt: string } | null>(null);
  const [inputHistory, setInputHistory] = useState<string[]>(() => {
    // Load history from localStorage on init
    try {
      const saved = localStorage.getItem("lily-input-history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Streaming tool calls (accumulated during response)
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolUseBlock[]>([]);
  const [streamingToolResults, setStreamingToolResults] = useState<Map<string, ToolResultBlock>>(new Map());

  // Context awareness - auto-include page content
  const [contextEnabled, setContextEnabled] = useState(false);
  const [pageContext, setPageContext] = useState<{ title: string; url: string; text: string } | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  // Form submission confirmation
  const [pendingSubmit, setPendingSubmit] = useState<{ selector: string; action: string; method: string; tabId: number } | null>(null);

  // Persist history to localStorage
  useEffect(() => {
    try {
      // Keep last 100 entries
      const toSave = inputHistory.slice(-100);
      localStorage.setItem("lily-input-history", JSON.stringify(toSave));
    } catch {}
  }, [inputHistory]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // Close attachment menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    if (showAttachMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showAttachMenu]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamingToolCalls]);

  // Listen for streaming chunks and Claude events from background
  useEffect(() => {
    const handleMessage = (msg: any) => {
      // Handle legacy streaming chunks
      if (msg?.type === "streamChunk" && msg.chunk) {
        const chunk = msg.chunk;
        // Check for status markers
        if (chunk.startsWith("__STATUS__") && chunk.endsWith("__STATUS__")) {
          try {
            const statusJson = chunk.slice(10, -10);
            const status = JSON.parse(statusJson);
            if (status.tool) {
              setCurrentStatus(`${status.tool}...`);
            } else if (status.status === "thinking") {
              setCurrentStatus("Thinking...");
            }
          } catch {}
          return;
        }
        // Regular text chunk
        setCurrentStatus(null);
        setStreamingText((prev) => prev + chunk);
        return;
      }

      // Handle rich Claude events
      if (msg?.type === "claudeEvent" && msg.event) {
        const event = msg.event as ClaudeEvent;

        // System init event
        if (event.type === "system" && event.subtype === "init") {
          setCurrentStatus("Initializing...");
          return;
        }

        // Assistant message with content
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            // Text block
            if (block.type === "text" && block.text) {
              setCurrentStatus(null);
              setStreamingText((prev) => prev + block.text);
            }
            // Tool use block
            if (block.type === "tool_use" && block.id && block.name) {
              const toolUse: ToolUseBlock = {
                type: "tool_use",
                id: block.id,
                name: block.name,
                input: block.input || {},
              };
              setStreamingToolCalls((prev) => [...prev, toolUse]);
              setCurrentStatus(`Using ${block.name}...`);
            }
          }
          return;
        }

        // User message with tool results
        if (event.type === "user" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "tool_result" && block.tool_use_id) {
              const toolResult: ToolResultBlock = {
                type: "tool_result",
                tool_use_id: block.tool_use_id,
                content: block.content || "",
                is_error: block.is_error,
              };
              setStreamingToolResults((prev) => {
                const next = new Map(prev);
                next.set(block.tool_use_id, toolResult);
                return next;
              });
              setCurrentStatus(null);
            }
          }
          return;
        }

        // Error event
        if (event.type === "error") {
          setCurrentStatus(null);
          console.error("[Lily] Claude error:", event.error);
          return;
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Elapsed time timer
  const startElapsedTimer = useCallback(() => {
    setElapsedSeconds(0);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  // File attachment handlers
  const getFileExtension = (filename: string): string => {
    const lastDot = filename.lastIndexOf(".");
    return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : "";
  };

  const isSensitiveFile = (filename: string): boolean => {
    const lower = filename.toLowerCase();
    return SENSITIVE_PATTERNS.some(pattern => lower.includes(pattern));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setAttachmentError(null);
    const newAttachments: Attachment[] = [];

    // Calculate current total size
    const currentTotalSize = attachments.reduce((sum, a) => sum + a.size, 0);

    for (const file of Array.from(files)) {
      // Check extension
      const ext = getFileExtension(file.name);
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        setAttachmentError(`Unsupported file type: ${ext || "no extension"}. Text files only.`);
        continue;
      }

      // Check individual file size
      if (file.size > MAX_FILE_SIZE) {
        setAttachmentError(`File "${file.name}" is too large (${formatFileSize(file.size)}). Max: 500 KB per file.`);
        continue;
      }

      // Check total size
      const newTotalSize = currentTotalSize + newAttachments.reduce((sum, a) => sum + a.size, 0) + file.size;
      if (newTotalSize > MAX_TOTAL_SIZE) {
        setAttachmentError(`Total attachment size would exceed 1 MB limit.`);
        break;
      }

      // Check for duplicates
      if (attachments.some(a => a.name === file.name) || newAttachments.some(a => a.name === file.name)) {
        setAttachmentError(`File "${file.name}" is already attached.`);
        continue;
      }

      // Warn about sensitive files
      if (isSensitiveFile(file.name)) {
        const confirmed = window.confirm(
          `"${file.name}" may contain sensitive data (credentials, keys, etc.).\n\nAre you sure you want to attach it?`
        );
        if (!confirmed) continue;
      }

      // Read file content
      try {
        const content = await file.text();
        newAttachments.push({
          name: file.name,
          type: file.type || "text/plain",
          content,
          size: file.size,
        });
      } catch (err) {
        setAttachmentError(`Failed to read "${file.name}". Make sure it's a valid text file.`);
      }
    }

    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments]);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [attachments]);

  const removeAttachment = useCallback((name: string) => {
    setAttachments(prev => prev.filter(a => a.name !== name));
    setAttachmentError(null);
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setAttachmentError(null);
  }, []);

  // Slash command handlers
  const handleBriefingCommand = useCallback(async () => {
    setTab("chat");
    setMessages((prev) => [...prev, { role: "user", text: "/briefing" }]);
    setLoading(true);
    startElapsedTimer();
    try {
      const res = await sendNative("briefing");
      stopElapsedTimer();
      if (res?.ok) {
        setMessages((prev) => [...prev, { role: "assistant", text: res.response }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${res?.error || "Unknown"}` }]);
      }
    } catch (e: any) {
      stopElapsedTimer();
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [startElapsedTimer, stopElapsedTimer]);

  const handleEndCommand = useCallback(async () => {
    // Clear input immediately
    setInput("");
    clearAttachments();

    // Show loading state
    setMessages((prev) => [...prev, { role: "user", text: "/end" }]);
    setMessages((prev) => [...prev, { role: "assistant", text: "Saving session..." }]);
    setLoading(true);

    const res = await sendNative("endSession");
    setLoading(false);

    if (res?.ok) {
      setMessages([]);
      setActiveSession(null);
      setMessages([{ role: "assistant", text: "Session saved. Memories extracted.\n\nStart a new conversation anytime." }]);
    } else {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", text: `Failed to save session: ${res?.error || "Unknown error"}` };
        return updated;
      });
    }
  }, [clearAttachments]);

  const handleDumpCommand = useCallback(() => {
    setShowDump(true);
  }, []);

  // Navigation commands
  const handleMemoryCommand = useCallback(() => setTab("memory"), []);
  const handleSkillsCommand = useCallback(() => setTab("skills"), []);
  const handleIntegrationsCommand = useCallback(() => setTab("integrations"), []);
  const handleWorkflowsCommand = useCallback(() => setTab("workflows"), []);

  // Fill command - fill form fields
  // Usage: /fill field1=value1 field2=value2 OR /fill [natural language instructions]
  const handleFillCommand = useCallback(async (args: string) => {
    if (!args.trim()) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: "Usage: `/fill email=test@example.com name=John Doe`\n\nOr describe what to fill: `/fill fill the email with my work email`"
      }]);
      return;
    }

    setMessages((prev) => [...prev, { role: "user", text: `/fill ${args}` }]);
    setLoading(true);
    setCurrentStatus("Filling form...");

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        setMessages((prev) => [...prev, { role: "assistant", text: "No active tab found." }]);
        return;
      }

      // Check if args contains field=value pairs
      const pairPattern = /(\w+)\s*=\s*("[^"]+"|'[^']+'|[^\s]+)/g;
      const pairs: { field: string; value: string }[] = [];
      let match;

      while ((match = pairPattern.exec(args)) !== null) {
        let value = match[2];
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        pairs.push({ field: match[1], value });
      }

      if (pairs.length > 0) {
        // Direct field=value filling
        const formsResponse = await chrome.tabs.sendMessage(activeTab.id, { type: "getFormFields" });

        if (!formsResponse?.ok || !formsResponse.forms?.length) {
          setMessages((prev) => [...prev, { role: "assistant", text: "No forms found on this page." }]);
          return;
        }

        // Try to match fields and fill them
        const results: string[] = [];
        for (const { field, value } of pairs) {
          // Find matching field across all forms
          let filled = false;
          for (const form of formsResponse.forms) {
            for (const formField of form.fields) {
              const fieldName = (formField.name || formField.label || "").toLowerCase();
              if (fieldName.includes(field.toLowerCase()) || field.toLowerCase().includes(fieldName)) {
                const fillResponse = await chrome.tabs.sendMessage(activeTab.id, {
                  type: "fillFormField",
                  selector: formField.selector,
                  value,
                });
                if (fillResponse?.ok) {
                  results.push(`Filled **${formField.label || formField.name}** with "${value}"`);
                  filled = true;
                  break;
                }
              }
            }
            if (filled) break;
          }
          if (!filled) {
            results.push(`Could not find field matching "${field}"`);
          }
        }

        setMessages((prev) => [...prev, {
          role: "assistant",
          text: results.join("\n")
        }]);
      } else {
        // Natural language - ask Claude to help
        const formsResponse = await chrome.tabs.sendMessage(activeTab.id, { type: "getFormFields" });

        if (!formsResponse?.ok || !formsResponse.forms?.length) {
          setMessages((prev) => [...prev, { role: "assistant", text: "No forms found on this page to fill." }]);
          return;
        }

        // Format forms for Claude
        let formContext = "Forms on this page:\n";
        formsResponse.forms.forEach((form: any, i: number) => {
          formContext += `Form ${i + 1} (${form.id}):\n`;
          form.fields.forEach((f: any) => {
            formContext += `  - ${f.label || f.name || f.placeholder} (${f.type})\n`;
          });
        });

        // Send to Claude
        const res = await sendNative("chat", {
          text: `${formContext}\n\nUser wants to: ${args}\n\nPlease respond with ONLY the field values to fill in this exact format, one per line:\nfield_name=value\n\nDo not include any other text, just the field=value pairs.`,
          stream: true,
        });

        if (res?.ok && res.response) {
          // Parse Claude's response for field=value pairs
          const lines = res.response.split("\n");
          const fillResults: string[] = [];

          for (const line of lines) {
            const fillMatch = line.match(/^([^=]+)=(.+)$/);
            if (fillMatch) {
              const fieldName = fillMatch[1].trim().toLowerCase();
              const value = fillMatch[2].trim();

              // Find and fill the field
              for (const form of formsResponse.forms) {
                for (const formField of form.fields) {
                  const fName = (formField.name || formField.label || "").toLowerCase();
                  if (fName.includes(fieldName) || fieldName.includes(fName)) {
                    const fillResponse = await chrome.tabs.sendMessage(activeTab.id, {
                      type: "fillFormField",
                      selector: formField.selector,
                      value,
                    });
                    if (fillResponse?.ok) {
                      fillResults.push(`Filled **${formField.label || formField.name}** with "${value}"`);
                    }
                    break;
                  }
                }
              }
            }
          }

          if (fillResults.length > 0) {
            setMessages((prev) => [...prev, { role: "assistant", text: fillResults.join("\n") }]);
          } else {
            setMessages((prev) => [...prev, { role: "assistant", text: "Could not parse fill instructions from Claude's response." }]);
          }
        } else {
          setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${res?.error || "Unknown"}` }]);
        }
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Error filling form: ${e.message}` }]);
    } finally {
      setLoading(false);
      setCurrentStatus(null);
    }
  }, []);

  // Submit command - submit a form with confirmation
  const handleSubmitCommand = useCallback(async (args: string) => {
    setMessages((prev) => [...prev, { role: "user", text: `/submit${args ? " " + args : ""}` }]);

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        setMessages((prev) => [...prev, { role: "assistant", text: "No active tab found." }]);
        return;
      }

      // Get forms to find the one to submit
      const formsResponse = await chrome.tabs.sendMessage(activeTab.id, { type: "getFormFields" });

      if (!formsResponse?.ok || !formsResponse.forms?.length) {
        setMessages((prev) => [...prev, { role: "assistant", text: "No forms found on this page." }]);
        return;
      }

      // Find the form to submit
      let targetForm = formsResponse.forms[0]; // Default to first form

      if (args.trim()) {
        // Try to find a form matching the argument
        const argLower = args.toLowerCase().trim();
        const found = formsResponse.forms.find((f: any) =>
          f.id.toLowerCase().includes(argLower) ||
          (f.action && f.action.toLowerCase().includes(argLower))
        );
        if (found) {
          targetForm = found;
        }
      }

      // Show confirmation dialog
      setPendingSubmit({
        selector: targetForm.selector,
        action: targetForm.action,
        method: targetForm.method,
        tabId: activeTab.id,
      });

      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Ready to submit form:\n- **Action:** ${targetForm.action}\n- **Method:** ${targetForm.method}\n\nClick "Confirm Submit" below to proceed, or "Cancel" to abort.`
      }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${e.message}` }]);
    }
  }, []);

  // Confirm form submission
  const confirmSubmit = useCallback(async () => {
    if (!pendingSubmit) return;

    setLoading(true);
    setCurrentStatus("Submitting form...");

    try {
      const response = await chrome.tabs.sendMessage(pendingSubmit.tabId, {
        type: "submitForm",
        selector: pendingSubmit.selector,
      });

      if (response?.ok) {
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: `Form submitted successfully to \`${pendingSubmit.action}\``
        }]);
      } else {
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: `Failed to submit: ${response?.error || "Unknown error"}`
        }]);
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Error submitting form: ${e.message}`
      }]);
    } finally {
      setPendingSubmit(null);
      setLoading(false);
      setCurrentStatus(null);
    }
  }, [pendingSubmit]);

  // Cancel form submission
  const cancelSubmit = useCallback(() => {
    setPendingSubmit(null);
    setMessages((prev) => [...prev, { role: "assistant", text: "Form submission cancelled." }]);
  }, []);

  // Forms command - list forms on current page
  const handleFormsCommand = useCallback(async () => {
    setMessages((prev) => [...prev, { role: "user", text: "/forms" }]);
    setLoading(true);
    setCurrentStatus("Reading forms...");

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        const response = await chrome.tabs.sendMessage(activeTab.id, { type: "getFormFields" });

        if (response?.ok && response.forms) {
          if (response.forms.length === 0) {
            setMessages((prev) => [...prev, {
              role: "assistant",
              text: "No forms found on this page."
            }]);
          } else {
            // Format forms nicely
            let formText = `Found **${response.forms.length} form(s)** on this page:\n\n`;

            response.forms.forEach((form: any, i: number) => {
              formText += `### Form ${i + 1}: ${form.id}\n`;
              formText += `- Action: \`${form.action}\`\n`;
              formText += `- Method: \`${form.method}\`\n`;
              formText += `- Fields:\n`;

              form.fields.forEach((field: any) => {
                const required = field.required ? " *(required)*" : "";
                const label = field.label || field.name || field.placeholder || "unnamed";
                formText += `  - **${label}**${required}: \`${field.type}\``;
                if (field.value) {
                  formText += ` = "${field.value}"`;
                }
                formText += `\n`;
              });
              formText += "\n";
            });

            formText += "\n*Tip: Ask me to fill a form, e.g., \"Fill the contact form with my email test@example.com\"*";

            setMessages((prev) => [...prev, { role: "assistant", text: formText }]);
          }
        } else {
          setMessages((prev) => [...prev, {
            role: "assistant",
            text: `Error reading forms: ${response?.error || "Unknown error"}`
          }]);
        }
      } else {
        setMessages((prev) => [...prev, { role: "assistant", text: "No active tab found." }]);
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Error reading forms: ${e.message}`
      }]);
    } finally {
      setLoading(false);
      setCurrentStatus(null);
    }
  }, []);

  // Page content command
  const handlePageCommand = useCallback(async () => {
    setMessages((prev) => [...prev, { role: "user", text: "/page" }]);
    setLoading(true);
    setCurrentStatus("Reading page...");

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const title = document.title;
            const url = window.location.href;
            // Get main content text
            const article = document.querySelector("article") || document.querySelector("main") || document.body;
            const text = article?.innerText?.slice(0, 10000) || "";
            return { title, url, text };
          },
        });

        const pageData = results[0]?.result;
        if (pageData) {
          // Send to Claude for analysis
          const res = await sendNative("chat", {
            text: `Analyze this webpage:\n\nTitle: ${pageData.title}\nURL: ${pageData.url}\n\nContent:\n${pageData.text}`,
            stream: true,
          });

          if (res?.ok) {
            setMessages((prev) => [...prev, { role: "assistant", text: res.response }]);
          } else {
            setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${res?.error || "Unknown"}` }]);
          }
        }
      } else {
        setMessages((prev) => [...prev, { role: "assistant", text: "No active tab found." }]);
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Error reading page: ${e.message}` }]);
    } finally {
      setLoading(false);
      setCurrentStatus(null);
    }
  }, []);

  // Fetch page context for context awareness toggle
  const fetchPageContext = useCallback(async () => {
    setContextLoading(true);
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const title = document.title;
            const url = window.location.href;
            // Get main content text (truncated for context)
            const article = document.querySelector("article") || document.querySelector("main") || document.body;
            const text = article?.innerText?.slice(0, 5000) || "";
            return { title, url, text };
          },
        });

        const pageData = results[0]?.result;
        if (pageData) {
          setPageContext(pageData);
        } else {
          setPageContext(null);
        }
      } else {
        setPageContext(null);
      }
    } catch (e) {
      console.error("Failed to fetch page context:", e);
      setPageContext(null);
    } finally {
      setContextLoading(false);
    }
  }, []);

  // Toggle context awareness
  const toggleContext = useCallback(async () => {
    if (!contextEnabled) {
      // Turning ON - fetch current page context
      setContextEnabled(true);
      await fetchPageContext();
    } else {
      // Turning OFF - clear context
      setContextEnabled(false);
      setPageContext(null);
    }
  }, [contextEnabled, fetchPageContext]);

  // Remember command - add to memory
  const handleRememberCommand = useCallback(async (args: string) => {
    if (!args.trim()) {
      setMessages((prev) => [...prev, { role: "assistant", text: "Usage: /remember [fact to remember]" }]);
      return;
    }

    const res = await sendNative("addMemory", { type: "facts", fact: args.trim() });
    if (res?.ok) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Remembered: "${args.trim()}"` }]);
    } else {
      setMessages((prev) => [...prev, { role: "assistant", text: `Failed to remember: ${res?.error}` }]);
    }
  }, []);

  // Forget command - remove from memory
  const handleForgetCommand = useCallback(async (args: string) => {
    if (!args.trim()) {
      setMessages((prev) => [...prev, { role: "assistant", text: "Usage: /forget [text to search and remove]" }]);
      return;
    }

    const res = await sendNative("removeMemory", { type: "facts", searchText: args.trim() });
    if (res?.ok) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Forgot ${res.removed} item(s) matching "${args.trim()}"` }]);
    } else {
      setMessages((prev) => [...prev, { role: "assistant", text: `Failed: ${res?.error}` }]);
    }
  }, []);

  // Define slash commands
  const slashCommands: SlashCommand[] = useMemo(
    () => [
      {
        name: "briefing",
        aliases: ["b"],
        description: "Generate daily briefing",
        handler: handleBriefingCommand,
      },
      {
        name: "end",
        aliases: ["e"],
        description: "End current session",
        handler: handleEndCommand,
      },
      {
        name: "dump",
        aliases: ["d"],
        description: "Start thought dump",
        handler: handleDumpCommand,
      },
      {
        name: "remember",
        aliases: ["r"],
        description: "Remember a fact",
        handler: handleRememberCommand,
      },
      {
        name: "forget",
        aliases: [],
        description: "Forget a stored fact",
        handler: handleForgetCommand,
      },
      {
        name: "memory",
        aliases: ["m"],
        description: "View stored memories",
        handler: handleMemoryCommand,
      },
      {
        name: "skills",
        aliases: ["sk"],
        description: "View and manage skills",
        handler: handleSkillsCommand,
      },
      {
        name: "integrations",
        aliases: ["int"],
        description: "Manage integrations",
        handler: handleIntegrationsCommand,
      },
      {
        name: "workflows",
        aliases: ["wf"],
        description: "View workflows",
        handler: handleWorkflowsCommand,
      },
      {
        name: "page",
        aliases: ["pg"],
        description: "Analyze current page",
        handler: handlePageCommand,
      },
      {
        name: "forms",
        aliases: ["f"],
        description: "List forms on page",
        handler: handleFormsCommand,
      },
      {
        name: "fill",
        aliases: [],
        description: "Fill form fields",
        handler: handleFillCommand,
      },
      {
        name: "submit",
        aliases: [],
        description: "Submit a form",
        handler: handleSubmitCommand,
      },
    ],
    [
      handleBriefingCommand,
      handleEndCommand,
      handleDumpCommand,
      handleRememberCommand,
      handleForgetCommand,
      handleMemoryCommand,
      handleSkillsCommand,
      handleIntegrationsCommand,
      handleWorkflowsCommand,
      handlePageCommand,
      handleFormsCommand,
      handleFillCommand,
      handleSubmitCommand,
    ]
  );

  const {
    showMenu,
    selectedIndex,
    filteredCommands,
    handleInputChange: handleSlashInput,
    handleKeyDown: handleSlashKeyDown,
    selectCommand,
    parseCommand,
  } = useSlashCommands({ commands: slashCommands });

  // Load active session on mount
  useEffect(() => {
    sendNative("getActiveSession").then((res) => {
      if (res?.ok && res.session) {
        setActiveSession(res.session);
      }
    });
  }, []);

  // Load memory projects when modal opens
  useEffect(() => {
    if (showMemoryModal) {
      sendNative("listProjects").then((res) => {
        if (res?.ok) {
          setMemoryProjects(res.projects || []);
        }
      });
    }
  }, [showMemoryModal]);

  // Check MCP status when attachment menu opens
  useEffect(() => {
    if (showAttachMenu) {
      sendNative("getMcpStatus").then((res) => {
        if (res?.ok) {
          const servers = res.servers || [];
          setHasMcpGithub(servers.some((s: any) => s.name.toLowerCase().includes("github")));
          setHasMcpNotion(servers.some((s: any) => s.name.toLowerCase().includes("notion")));
        }
      });
    }
  }, [showAttachMenu]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Add to history
    setInputHistory((prev) => [...prev, text]);
    setHistoryIndex(-1);

    // Check for slash command
    const parsed = parseCommand(text);
    if (parsed) {
      setInput("");
      clearAttachments();
      parsed.command.handler(parsed.args);
      return;
    }

    // Build display text with attachment and context info
    const attachmentNames = attachments.map(a => a.name);
    let displayText = text;
    const displayParts: string[] = [];
    if (attachmentNames.length > 0) {
      displayParts.push(`Attached: ${attachmentNames.join(", ")}`);
    }
    if (contextEnabled && pageContext) {
      displayParts.push(`Context: ${pageContext.title}`);
    }
    if (displayParts.length > 0) {
      displayText = `${text}\n\n*${displayParts.join(" | ")}*`;
    }

    // Prepare attachments for API
    const attachmentsPayload = attachments.map(a => ({
      name: a.name,
      content: a.content,
    }));

    // Build the actual message text with page context prepended
    let messageText = text;
    if (contextEnabled && pageContext) {
      messageText = `[Page Context]\nTitle: ${pageContext.title}\nURL: ${pageContext.url}\n\n${pageContext.text.slice(0, 3000)}\n\n---\n\nUser message: ${text}`;
    }

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: displayText }]);
    setLoading(true);
    setStreamingText("");
    setStreamingToolCalls([]);
    setStreamingToolResults(new Map());
    setCurrentStatus(null);
    clearAttachments();
    startElapsedTimer();
    try {
      const res = await sendNative("chat", {
        text: messageText,
        stream: true,
        attachments: attachmentsPayload,
        memoryProjectId: activeMemoryProject?.id || null,
      });
      stopElapsedTimer();
      if (res?.ok) {
        // Build final message with text and tool calls
        const finalMessage: Message = {
          role: "assistant",
          text: res.response,
          toolCalls: streamingToolCalls.length > 0 ? [...streamingToolCalls] : undefined,
          toolResults: streamingToolResults.size > 0 ? new Map(streamingToolResults) : undefined,
        };
        setMessages((prev) => [...prev, finalMessage]);
        setStreamingText("");
        setStreamingToolCalls([]);
        setStreamingToolResults(new Map());
        setCurrentStatus(null);
        // Update active session info
        if (res.sessionId) {
          const sessionRes = await sendNative("getActiveSession");
          if (sessionRes?.ok && sessionRes.session) {
            setActiveSession(sessionRes.session);
          }
        }
      } else if (res?.cancelled) {
        // Request was cancelled - show partial response if any, or cancelled message
        const partialText = streamingText.trim();
        const cancelledMessage: Message = {
          role: "assistant",
          text: partialText ? partialText + "\n\n*[Stopped]*" : "*[Stopped]*",
          toolCalls: streamingToolCalls.length > 0 ? [...streamingToolCalls] : undefined,
          toolResults: streamingToolResults.size > 0 ? new Map(streamingToolResults) : undefined,
        };
        setMessages((prev) => [...prev, cancelledMessage]);
        setStreamingText("");
        setStreamingToolCalls([]);
        setStreamingToolResults(new Map());
        setCurrentStatus(null);
      } else {
        setStreamingText("");
        setStreamingToolCalls([]);
        setStreamingToolResults(new Map());
        setCurrentStatus(null);
        setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${res?.error || "Unknown"}` }]);
      }
    } catch (e: any) {
      stopElapsedTimer();
      setStreamingText("");
      setStreamingToolCalls([]);
      setStreamingToolResults(new Map());
      setCurrentStatus(null);
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const stopChat = useCallback(async () => {
    try {
      await sendNative("stopChat");
    } catch {
      // Ignore errors
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape to stop loading
    if (e.key === "Escape" && loading) {
      e.preventDefault();
      stopChat();
      return;
    }

    // Let slash command menu handle navigation keys (only when menu is visible)
    if (showMenu && handleSlashKeyDown(e, input)) {
      return;
    }

    // History navigation with UP/DOWN arrows (when input is empty or browsing)
    if (e.key === "ArrowUp" && inputHistory.length > 0) {
      // Only navigate history if input is empty or already browsing history
      if (input === "" || historyIndex !== -1) {
        e.preventDefault();
        const newIndex = historyIndex === -1
          ? inputHistory.length - 1
          : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(inputHistory[newIndex]);
        return;
      }
    }

    if (e.key === "ArrowDown") {
      // Only navigate if already browsing history
      if (historyIndex !== -1) {
        e.preventDefault();
        const newIndex = historyIndex + 1;
        if (newIndex >= inputHistory.length) {
          setHistoryIndex(-1);
          setInput("");
        } else {
          setHistoryIndex(newIndex);
          setInput(inputHistory[newIndex]);
        }
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    handleSlashInput(value);
  };

  const handleNewSession = async () => {
    const res = await sendNative("newSession");
    if (res?.ok) {
      setMessages([]);
      setActiveSession(null);
    }
  };

  const handleEndSession = async () => {
    setLoading(true);
    try {
      const res = await sendNative("endSession");
      if (res?.ok) {
        setMessages([]);
        setActiveSession(null);
        // Show success message briefly
        setMessages([{ role: "assistant", text: "Session ended. Memories saved." }]);
      } else {
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: `Failed to end session: ${res?.error || "Unknown error"}`
        }]);
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Error ending session: ${e.message}`
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Handler for integration auth - switches to chat and sends auth prompt
  const handleStartAuthChat = useCallback((integrationName: string, prompt: string) => {
    setPendingAuthPrompt({ name: integrationName, prompt });
    setTab("chat");
  }, []);

  // Effect to send pending auth prompt when switching to chat tab
  useEffect(() => {
    if (pendingAuthPrompt && tab === "chat" && !loading) {
      // Clear pending prompt first to avoid re-triggering
      const { name, prompt } = pendingAuthPrompt;
      setPendingAuthPrompt(null);

      // Add user message and send
      setMessages((prev) => [...prev, { role: "user", text: `Connect to ${name}` }]);
      setLoading(true);
      setStreamingText("");
      setCurrentStatus(`Connecting to ${name}...`);
      startElapsedTimer();

      // Send the actual prompt to Claude
      sendNative("chat", { text: prompt, stream: true }).then((res) => {
        stopElapsedTimer();
        setLoading(false);
        setCurrentStatus(null);
        if (res?.ok) {
          setMessages((prev) => [...prev, { role: "assistant", text: res.response }]);
          setStreamingText("");
          if (res.session) {
            setActiveSession(res.session);
          }
        } else {
          setMessages((prev) => [...prev, { role: "assistant", text: `Failed to connect: ${res?.error || "Unknown error"}` }]);
        }
      });
    }
  }, [pendingAuthPrompt, tab, loading, startElapsedTimer, stopElapsedTimer]);

  const handleResumeSession = async (sessionId: string) => {
    const res = await sendNative("resumeSession", { sessionId });
    if (res?.ok && res.session) {
      setActiveSession({ ...res.session, hasContext: res.hasClaudeSession });

      // Restore previous messages if available
      if (res.messages && res.messages.length > 0) {
        setMessages(res.messages);
      } else {
        // No stored messages - show resume message
        setMessages([]);
        if (res.hasClaudeSession) {
          setMessages([{ role: "assistant", text: `Resumed session: "${res.session.title}"\n\nI remember our previous conversation. How can I help?` }]);
        } else {
          setMessages([{ role: "assistant", text: `Resumed session: "${res.session.title}"\n\nNote: The conversation context has expired. I'll start fresh, but our chat history is still logged.` }]);
        }
      }
      setTab("chat");
    }
  };

  const tabs: { key: Tab; label: string; icon?: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "memory", label: "Memory", icon: "🧠" },
    { key: "skills", label: "Skills", icon: "⚡" },
    { key: "history", label: "History" },
  ];

  const moreTabs: { key: Tab; label: string; icon?: string }[] = [
    { key: "integrations", label: "Integrations", icon: "🔌" },
    { key: "workflows", label: "Workflows", icon: "🎬" },
    { key: "goals", label: "Goals" },
  ];

  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // If thought dump is open, show it instead
  if (showDump) {
    return <ThoughtDumpView onClose={() => setShowDump(false)} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full">
      {/* Tab bar - sticky at top */}
      <div className="sticky top-0 z-20 flex border-b border-lily-border glass">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t.key
                ? "text-lily-accent border-b-2 border-lily-accent"
                : "text-lily-muted hover:text-lily-text"
            }`}
          >
            {t.icon ? `${t.icon} ` : ""}{t.label}
          </button>
        ))}
        {/* More menu button */}
        <div className="relative">
          <button
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              moreTabs.some(t => t.key === tab)
                ? "text-lily-accent border-b-2 border-lily-accent"
                : "text-lily-muted hover:text-lily-text"
            }`}
          >
            More ▾
          </button>
          {showMoreMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-40 glass-card rounded-lg shadow-lg py-1">
              {moreTabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key);
                    setShowMoreMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 ${
                    tab === t.key
                      ? "text-lily-accent bg-lily-accent/10"
                      : "text-lily-muted hover:text-lily-text hover:bg-lily-border/20"
                  }`}
                >
                  {t.icon && <span>{t.icon}</span>}
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {tab === "goals" && <GoalsView />}
      {tab === "history" && <HistoryView onResume={handleResumeSession} />}
      {tab === "memory" && <MemoryView />}
      {tab === "skills" && <SkillsView />}
      {tab === "integrations" && <IntegrationsView onStartAuthChat={handleStartAuthChat} />}
      {tab === "workflows" && <WorkflowsView />}

      {tab === "chat" && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Session banner - shows when session active */}
          {activeSession && (
            <div className="flex-shrink-0 px-3 py-2 glass border-b border-lily-border flex items-center justify-between">
              <div className="text-xs text-lily-muted flex items-center gap-2">
                <span className="text-lily-accent">●</span>
                <span className="truncate max-w-[180px]">{activeSession.title || "New Chat"}</span>
                {activeSession.hasContext && (
                  <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded text-[10px]">
                    Context
                  </span>
                )}
              </div>
              <button
                onClick={handleEndSession}
                className="text-xs text-lily-muted hover:text-lily-accent transition-colors"
              >
                End Session
              </button>
            </div>
          )}

          {/* Messages - scrollable area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && !activeSession && (
              <p className="text-sm text-lily-muted text-center mt-8">
                Send a message to start a new conversation with Lily.
              </p>
            )}
            {messages.length === 0 && activeSession && (
              <p className="text-sm text-lily-muted text-center mt-8">
                Continue your conversation with Lily.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-lg p-3 text-sm overflow-hidden ${
                  m.role === "user"
                    ? "glass-card ml-8"
                    : "glass mr-8"
                }`}
              >
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap">{m.text}</p>
                ) : (
                  <>
                    {/* Tool calls (shown before text response) */}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <div className="mb-3">
                        {m.toolCalls.map((tc) => (
                          <ToolCall
                            key={tc.id}
                            toolUse={tc}
                            result={m.toolResults?.get(tc.id)}
                          />
                        ))}
                      </div>
                    )}
                    {/* Text response */}
                    {m.text && renderMarkdown(m.text)}
                  </>
                )}
              </div>
            ))}
            {loading && (
              <div className="glass mr-8 rounded-lg p-3 text-sm">
                {/* Streaming tool calls */}
                {streamingToolCalls.length > 0 && (
                  <div className="mb-3">
                    {streamingToolCalls.map((tc) => (
                      <ToolCall
                        key={tc.id}
                        toolUse={tc}
                        result={streamingToolResults.get(tc.id)}
                      />
                    ))}
                  </div>
                )}
                {/* Streaming text or status */}
                {streamingText ? (
                  <div className="whitespace-pre-wrap text-lily-text">{renderMarkdown(streamingText)}</div>
                ) : (
                  <span className="text-lily-muted">
                    {currentStatus || "Thinking..."}{" "}
                    <span className="text-lily-accent">{formatElapsed(elapsedSeconds)}</span>
                  </span>
                )}
              </div>
            )}
            {/* Form Submit Confirmation */}
            {pendingSubmit && (
              <div className="glass-card mr-8 rounded-lg p-3 text-sm border border-yellow-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-yellow-400">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                  </svg>
                  <span className="text-yellow-400 font-medium">Confirm Form Submission</span>
                </div>
                <p className="text-xs text-lily-muted mb-3">
                  This will submit the form to: <code className="text-lily-text">{pendingSubmit.action}</code>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={confirmSubmit}
                    disabled={loading}
                    className="flex-1 px-3 py-2 rounded-lg bg-lily-accent text-white hover:bg-lily-hover disabled:opacity-50 transition-colors text-sm font-medium"
                  >
                    Confirm Submit
                  </button>
                  <button
                    onClick={cancelSubmit}
                    disabled={loading}
                    className="px-3 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-text transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input - sticky at bottom */}
          <div className="flex-shrink-0 p-3 glass border-t border-lily-border relative">
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              multiple
              accept={Array.from(SUPPORTED_EXTENSIONS).join(",")}
              className="hidden"
            />

            {/* Slash command menu */}
            {showMenu && (
              <SlashCommandMenu
                commands={filteredCommands}
                selectedIndex={selectedIndex}
                onSelect={(i) => {
                  selectCommand(i, input);
                  setInput("");
                  clearAttachments();
                }}
              />
            )}

            {/* Attachment preview */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachments.map((att) => (
                  <div
                    key={att.name}
                    className="flex items-center gap-1.5 px-2 py-1 glass-card rounded-lg text-xs"
                  >
                    <span className="text-lily-accent">📄</span>
                    <span className="text-lily-text truncate max-w-[120px]" title={att.name}>
                      {att.name}
                    </span>
                    <span className="text-lily-muted">({formatFileSize(att.size)})</span>
                    <button
                      onClick={() => removeAttachment(att.name)}
                      className="text-lily-muted hover:text-lily-accent ml-1"
                      title="Remove attachment"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Page context preview */}
            {contextEnabled && pageContext && (
              <div className="flex items-center gap-1.5 px-2 py-1 mb-2 glass-card rounded-lg text-xs bg-lily-accent/10 border border-lily-accent/30">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-lily-accent flex-shrink-0">
                  <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" clipRule="evenodd" />
                </svg>
                <span className="text-lily-accent truncate max-w-[200px]" title={pageContext.title}>
                  {pageContext.title}
                </span>
                <button
                  onClick={() => fetchPageContext()}
                  className="text-lily-muted hover:text-lily-accent ml-1"
                  title="Refresh context"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.241l-.84-.84v1.371a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.932.75.75 0 0 1 1.025-.273Z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  onClick={() => { setContextEnabled(false); setPageContext(null); }}
                  className="text-lily-muted hover:text-lily-accent ml-1"
                  title="Remove context"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                  </svg>
                </button>
              </div>
            )}

            {/* Attachment error */}
            {attachmentError && (
              <div className="text-xs text-red-400 mb-2 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                </svg>
                {attachmentError}
              </div>
            )}

            {/* Top row: Input + Attach + Send */}
            <div className="flex gap-2 mb-2">
              <textarea
                value={input}
                onChange={onInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message Lily..."
                rows={1}
                className="flex-1 glass-card text-lily-text rounded-lg px-3 py-2 text-sm resize-none outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="px-2 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-accent disabled:opacity-50 transition-colors"
                title="Attach file"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501-.002.002a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z" clipRule="evenodd" />
                </svg>
              </button>
              {loading ? (
                <button
                  onClick={stopChat}
                  className="px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                  title="Stop (Esc)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z" clipRule="evenodd" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="px-3 py-2 rounded-lg bg-lily-accent text-white hover:bg-lily-hover disabled:opacity-50 transition-colors"
                  title="Send"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                  </svg>
                </button>
              )}
            </div>
            {/* Bottom row: Action buttons */}
            <div className="flex gap-1.5">
              {/* + Attachment Menu */}
              <div className="relative" ref={attachMenuRef}>
                <button
                  onClick={() => setShowAttachMenu(!showAttachMenu)}
                  className="p-2 rounded-lg glass-card text-lily-muted hover:text-lily-accent transition-colors"
                  title="Add content"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                </button>
                {/* Attachment menu dropdown */}
                {showAttachMenu && (
                  <div className="absolute left-0 bottom-full mb-2 w-56 glass-card rounded-lg shadow-lg py-1 z-50">
                    {/* Add files */}
                    <button
                      onClick={() => {
                        fileInputRef.current?.click();
                        setShowAttachMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-lily-accent/10 transition-colors"
                    >
                      <span>📎</span> Add files or photos
                    </button>

                    {/* Add to project */}
                    <button
                      onClick={() => {
                        setShowMemoryModal(true);
                        setShowAttachMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-lily-accent/10 transition-colors"
                    >
                      <span>📁</span> Add to project
                      <span className="ml-auto text-lily-muted">›</span>
                    </button>

                    {/* GitHub - conditional */}
                    {hasMcpGithub ? (
                      <button
                        onClick={() => {
                          // TODO: Open GitHub file selector
                          setShowAttachMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-lily-accent/10 transition-colors"
                      >
                        <span>🐙</span> Add from GitHub
                        <span className="ml-auto text-lily-muted">›</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setTab("integrations");
                          setShowAttachMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-lily-accent/10 transition-colors opacity-60"
                      >
                        <span>🐙</span> Add from GitHub
                        <span className="ml-auto text-xs text-lily-muted">Setup →</span>
                      </button>
                    )}

                    {/* Notion - conditional */}
                    {hasMcpNotion ? (
                      <button
                        onClick={() => {
                          // TODO: Open Notion page selector
                          setShowAttachMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-lily-accent/10 transition-colors"
                      >
                        <span>📝</span> Add from Notion
                        <span className="ml-auto text-lily-muted">›</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setTab("integrations");
                          setShowAttachMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-lily-accent/10 transition-colors opacity-60"
                      >
                        <span>📝</span> Add from Notion
                        <span className="ml-auto text-xs text-lily-muted">Setup →</span>
                      </button>
                    )}

                    {/* Divider */}
                    <div className="border-t border-lily-border my-1" />

                    {/* New session */}
                    <button
                      onClick={() => {
                        handleNewSession();
                        setShowAttachMenu(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-lily-accent/10 transition-colors"
                    >
                      <span>✨</span> New session
                    </button>
                  </div>
                )}
              </div>

              {/* Thought Dump */}
              <button
                onClick={() => setShowDump(true)}
                className="p-2 rounded-lg glass-card text-lily-muted hover:text-lily-accent transition-colors"
                title="Thought Dump"
              >
                <span className="text-sm">💭</span>
              </button>

              {/* Memory Project */}
              <button
                onClick={() => setShowMemoryModal(true)}
                className={`p-2 rounded-lg glass-card transition-colors ${
                  activeMemoryProject
                    ? "text-lily-accent ring-1 ring-lily-accent"
                    : "text-lily-muted hover:text-lily-accent"
                }`}
                title={activeMemoryProject ? `Memory: ${activeMemoryProject.name}` : "Select Memory Project"}
              >
                <span className="text-sm">🧠</span>
              </button>

              {/* Page Context Toggle */}
              <button
                onClick={toggleContext}
                disabled={contextLoading}
                className={`p-2 rounded-lg glass-card transition-colors ${
                  contextEnabled
                    ? "text-lily-accent ring-1 ring-lily-accent"
                    : "text-lily-muted hover:text-lily-accent"
                } ${contextLoading ? "opacity-50" : ""}`}
                title={contextEnabled ? `Context: ${pageContext?.title || "Loading..."}` : "Include page context"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" clipRule="evenodd" />
                </svg>
              </button>

              <span className="flex-1" />

              {activeMemoryProject && (
                <span className="text-[10px] text-lily-accent self-center truncate max-w-[100px]" title={activeMemoryProject.name}>
                  📁 {activeMemoryProject.name}
                </span>
              )}
              <span className="text-xs text-lily-muted self-center">
                / commands
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Memory Project Selector Modal */}
      {showMemoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-lg p-4 w-full max-w-sm max-h-[60vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Select Memory Project</h3>
              <button
                onClick={() => setShowMemoryModal(false)}
                className="text-lily-muted hover:text-lily-text"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-lily-muted mb-3">
              Choose a project to include its context in chat.
            </p>

            <div className="flex-1 overflow-y-auto space-y-2">
              {/* No context option */}
              <button
                onClick={() => {
                  setActiveMemoryProject(null);
                  setShowMemoryModal(false);
                }}
                className={`w-full text-left p-3 rounded-lg transition-all ${
                  !activeMemoryProject
                    ? "bg-lily-accent/20 ring-1 ring-lily-accent"
                    : "glass-card hover:ring-1 hover:ring-lily-accent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">🚫</span>
                  <div>
                    <div className="text-sm font-medium">No project context</div>
                    <div className="text-xs text-lily-muted">Chat without memory context</div>
                  </div>
                </div>
              </button>

              {/* Project list */}
              {memoryProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    setActiveMemoryProject(project);
                    setShowMemoryModal(false);
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-all ${
                    activeMemoryProject?.id === project.id
                      ? "bg-lily-accent/20 ring-1 ring-lily-accent"
                      : "glass-card hover:ring-1 hover:ring-lily-accent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📁</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{project.name}</div>
                      {project.description && (
                        <div className="text-xs text-lily-muted truncate">{project.description}</div>
                      )}
                    </div>
                    {activeMemoryProject?.id === project.id && (
                      <span className="text-lily-accent text-xs">Active</span>
                    )}
                  </div>
                </button>
              ))}

              {memoryProjects.length === 0 && (
                <div className="text-center py-6 text-sm text-lily-muted">
                  No projects yet. Create one in the Memory tab.
                </div>
              )}
            </div>

            <button
              onClick={() => {
                setTab("memory");
                setShowMemoryModal(false);
              }}
              className="mt-3 w-full px-4 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-accent transition-colors text-sm"
            >
              Manage Projects →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
