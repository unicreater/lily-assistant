import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { FilesView } from "~components/FilesView";
import { FormsView } from "~components/FormsView";
import { GoalsView } from "~components/GoalsView";
import { HistoryView } from "~components/HistoryView";
import { IntegrationsView } from "~components/IntegrationsView";
import { MemoryView } from "~components/MemoryView";
import { SkillsView } from "~components/SkillsView";
import { SlashCommandMenu } from "~components/SlashCommandMenu";
import { ThoughtDumpView } from "~components/ThoughtDumpView";
import { WorkflowsView } from "~components/WorkflowsView";
import { ActiveWorkflowsView } from "~components/ActiveWorkflowsView";
import { SettingsView } from "~components/SettingsView";
import { PageAnalysisView } from "~components/PageAnalysisView";
import { ToolCall, type ToolUseBlock, type ToolResultBlock } from "~components/ToolCall";
import { useSlashCommands, type SlashCommand } from "~hooks/useSlashCommands";
import {
  SUPPORTED_EXTENSIONS,
  SENSITIVE_PATTERNS,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  getFileExtension,
  formatFileSize,
  isSensitiveFile,
  readFileContent,
  getFileTypeIcon,
} from "~lib/fileParser";

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

interface ExtractedItem {
  type: "facts" | "people";
  content: string;
  selected: boolean;
}


interface Session {
  id: string;
  title: string;
  started: string;
  lastActive?: string;
  claudeSessionId?: string;
  hasContext?: boolean;
}

// Auto-fill types
interface FormField {
  name: string;
  type: string;
  value: string;
  label: string;
  required: boolean;
  selector: string;
  placeholder: string;
}

interface TemplateField {
  key: string;
  label: string;
  value: string;
  aliases: string[];
}

interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  fields: TemplateField[];
}

interface AutoFillAnalysis {
  canFill: { field: FormField; templateField: TemplateField }[];
  needsInput: FormField[];
  confidence: number;
  template: FormTemplate;
}

interface FieldMappingState {
  formFields: FormField[];
  templates: { id: string; name: string; fields: TemplateField[] }[];
  selectedTemplateId: string | null;
  mappings: Map<string, string>; // formField.selector -> templateField.key
  tabId: number;
}

type Tab = "chat" | "analysis" | "memory" | "skills" | "forms" | "files" | "integrations" | "workflows" | "active" | "goals" | "history" | "settings";

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

  // Memory consolidation state
  const [showConsolidation, setShowConsolidation] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([]);
  const [consolidationLoading, setConsolidationLoading] = useState(false);
  const [consolidationSummary, setConsolidationSummary] = useState("");

  // Streaming tool calls (accumulated during response)
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolUseBlock[]>([]);
  const [streamingToolResults, setStreamingToolResults] = useState<Map<string, ToolResultBlock>>(new Map());

  // Context awareness - auto-include page content
  const [contextEnabled, setContextEnabled] = useState(false);
  const [pageContext, setPageContext] = useState<{ title: string; url: string; text: string } | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  // Form submission confirmation
  const [pendingSubmit, setPendingSubmit] = useState<{ selector: string; action: string; method: string; tabId: number } | null>(null);
  // Auto-fill confirmation
  const [pendingAutoFill, setPendingAutoFill] = useState<AutoFillAnalysis | null>(null);
  // Field mapping mode (when auto-match fails)
  const [fieldMapping, setFieldMapping] = useState<FieldMappingState | null>(null);
  // Template picker for /autofill with no args
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templatePickerList, setTemplatePickerList] = useState<{ id: string; name: string; fieldCount: number; isDefault: boolean }[]>([]);
  // Templates for slash command menu autocomplete
  const [menuTemplates, setMenuTemplates] = useState<{ id: string; name: string; fieldCount: number; isDefault: boolean }[]>([]);
  // Smart template suggestion
  const [templateSuggestion, setTemplateSuggestion] = useState<{
    template: { id: string; name: string };
    matchCount: number;
    totalFields: number;
    dismissed: boolean;
  } | null>(null);

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
        setAttachmentError(`Unsupported file type: ${ext || "no extension"}. Supported: text, code, PDF, DOCX.`);
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

      // Read file content (supports PDF, DOCX, and text files)
      try {
        const content = await readFileContent(file);
        newAttachments.push({
          name: file.name,
          type: file.type || "text/plain",
          content,
          size: file.size,
        });

        // Track file in ~/lily/files/
        sendNative("saveFile", {
          name: file.name,
          content,
          type: "upload",
          mimeType: file.type || "text/plain",
          sessionId: activeSession?.id,
        }).catch((e) => console.error("Failed to track file:", e));
      } catch (err) {
        setAttachmentError(`Failed to read "${file.name}". The file may be corrupted or unsupported.`);
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

  // Finalize session (called after consolidation or when skipping)
  const finalizeSession = useCallback(async () => {
    const res = await sendNative("endSession");
    if (res?.ok) {
      setMessages([]);
      setActiveSession(null);
    }
    return res;
  }, []);

  // Start consolidation flow - extract memories for review
  const startConsolidation = useCallback(async () => {
    // Build conversation text from messages
    const conversationText = messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n\n");

    if (!conversationText.trim() || messages.length < 2) {
      // No meaningful conversation, just end directly
      await finalizeSession();
      setMessages([{ role: "assistant", text: "Session ended.\n\nStart a new conversation anytime." }]);
      setLoading(false);
      return;
    }

    setCurrentStatus("Extracting memories...");

    try {
      const extractRes = await sendNative("extractMemoriesPreview", {
        conversationText,
        projectId: activeMemoryProject?.id || null,
      });

      setLoading(false);
      setCurrentStatus(null);

      if (extractRes?.ok) {
        // Always show consolidation UI — with summary and optional checklist
        setConsolidationSummary(extractRes.summary || "Session completed.");
        setExtractedItems(
          (extractRes.items || [])
            .filter((item: any) => item.type && item.content)
            .map((item: any) => ({
              type: item.type,
              content: item.content,
              selected: true,
            }))
        );
        setShowConsolidation(true);
      } else {
        // Extraction failed, end directly
        await finalizeSession();
        setMessages([{ role: "assistant", text: "Session ended.\n\nStart a new conversation anytime." }]);
      }
    } catch (e: any) {
      setLoading(false);
      setCurrentStatus(null);
      // On error, still end the session
      await finalizeSession();
      setMessages([{ role: "assistant", text: "Session ended.\n\nStart a new conversation anytime." }]);
    }
  }, [messages, activeMemoryProject, finalizeSession]);

  // Confirm consolidation - save selected items
  const handleConsolidationConfirm = useCallback(async () => {
    setConsolidationLoading(true);

    try {
      const selectedItems = extractedItems
        .filter((i) => i.selected)
        .map((i) => ({ type: i.type, content: i.content }));

      if (selectedItems.length > 0) {
        await sendNative("saveExtractedMemories", {
          items: selectedItems,
          projectId: activeMemoryProject?.id || null,
          dateTag: new Date().toISOString().slice(0, 10),
        });

        // Fire-and-forget: update memory summary in background
        if (activeMemoryProject?.id) {
          sendNative("updateMemorySummary", {
            projectId: activeMemoryProject.id,
            newItems: selectedItems,
          }).catch(() => {});
        }
      }

      await finalizeSession();
      setShowConsolidation(false);
      setExtractedItems([]);
      setConsolidationSummary("");
      setConsolidationLoading(false);
      setMessages([{
        role: "assistant",
        text: `Session ended. ${selectedItems.length} memor${selectedItems.length === 1 ? "y" : "ies"} saved${activeMemoryProject ? ` to "${activeMemoryProject.name}"` : ""}.`,
      }]);
    } catch (e: any) {
      setConsolidationLoading(false);
      setShowConsolidation(false);
      setConsolidationSummary("");
      await finalizeSession();
      setMessages([{ role: "assistant", text: "Session ended.\n\nStart a new conversation anytime." }]);
    }
  }, [extractedItems, activeMemoryProject, finalizeSession]);

  // Skip consolidation
  const handleConsolidationSkip = useCallback(async () => {
    setShowConsolidation(false);
    setExtractedItems([]);
    setConsolidationSummary("");
    await finalizeSession();
    setMessages([{ role: "assistant", text: "Session ended.\n\nStart a new conversation anytime." }]);
  }, [finalizeSession]);

  const handleEndCommand = useCallback(async () => {
    // Clear input immediately
    setInput("");
    clearAttachments();

    // Show loading state
    setMessages((prev) => [...prev, { role: "user", text: "/end" }]);
    setMessages((prev) => [...prev, { role: "assistant", text: "Ending session..." }]);
    setLoading(true);

    await startConsolidation();
  }, [clearAttachments, startConsolidation]);

  const handleDumpCommand = useCallback(() => {
    setShowDump(true);
  }, []);

  // Navigation commands
  const handleMemoryCommand = useCallback(() => setTab("memory"), []);
  const handleSkillsCommand = useCallback(() => setTab("skills"), []);
  const handleFormsTabCommand = useCallback(() => setTab("forms"), []);
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

  // Auto-fill analysis helper
  const analyzeFormForAutoFill = (forms: { fields: FormField[] }[], template: FormTemplate): AutoFillAnalysis => {
    const analysis: AutoFillAnalysis = {
      canFill: [],
      needsInput: [],
      confidence: 0,
      template,
    };

    // Normalize a string for matching: lowercase, remove special chars, collapse spaces
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

    // Extract key terms from a field label (e.g., "Ticker Symbol *" -> ["ticker", "symbol"])
    const extractTerms = (s: string) => normalize(s).split(" ").filter((t) => t.length > 2);

    for (const form of forms) {
      for (const field of form.fields) {
        // Combine all identifying info about the field
        const fieldText = [field.name, field.label, field.placeholder].filter(Boolean).join(" ");
        const fieldNorm = normalize(fieldText);
        const fieldTerms = extractTerms(fieldText);

        // Find matching template field by aliases
        const matchedTemplateField = template.fields.find((tf) => {
          // Check each alias
          for (const alias of tf.aliases) {
            const aliasNorm = normalize(alias);
            const aliasTerms = extractTerms(alias);

            // Direct substring match (either direction)
            if (fieldNorm.includes(aliasNorm) || aliasNorm.includes(fieldNorm)) {
              return true;
            }

            // Term overlap match - if any key term matches
            for (const term of aliasTerms) {
              if (fieldTerms.some((ft) => ft.includes(term) || term.includes(ft))) {
                return true;
              }
            }
          }

          // Also check the template field's label and key
          const labelNorm = normalize(tf.label);
          const keyNorm = normalize(tf.key);
          if (fieldNorm.includes(labelNorm) || labelNorm.includes(fieldNorm)) {
            return true;
          }
          if (fieldNorm.includes(keyNorm) || keyNorm.includes(fieldNorm)) {
            return true;
          }

          return false;
        });

        if (matchedTemplateField && matchedTemplateField.value) {
          analysis.canFill.push({ field, templateField: matchedTemplateField });
        } else {
          analysis.needsInput.push(field);
        }
      }
    }

    const total = analysis.canFill.length + analysis.needsInput.length;
    analysis.confidence = total > 0 ? analysis.canFill.length / total : 0;
    return analysis;
  };

  // Auto-fill command
  const handleAutoFillCommand = useCallback(async (args: string) => {
    const templateName = args.trim() || undefined;
    setMessages((prev) => [...prev, { role: "user", text: `/autofill${templateName ? ` ${templateName}` : ""}` }]);
    setLoading(true);
    setCurrentStatus("Analyzing form...");

    try {
      // 1. Get forms from page
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        setMessages((prev) => [...prev, { role: "assistant", text: "No active tab found." }]);
        return;
      }

      const formsResponse = await chrome.tabs.sendMessage(activeTab.id, { type: "getFormFields" });
      if (!formsResponse?.ok || !formsResponse.forms?.length) {
        setMessages((prev) => [...prev, { role: "assistant", text: "No forms found on this page." }]);
        return;
      }

      // 2. Get templates
      const templatesRes = await sendNative("listFormTemplates");
      if (!templatesRes?.ok || !templatesRes.templates?.length) {
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: "No form templates found. Go to the **Forms** tab to create a template with your info.",
        }]);
        return;
      }

      // 3. Select template (by name, show picker if no name provided, or use only template)
      let templateSummary;
      if (templateName) {
        templateSummary = templatesRes.templates.find((t: any) =>
          t.name.toLowerCase() === templateName.toLowerCase() || t.id === templateName
        );
        if (!templateSummary) {
          const available = templatesRes.templates.map((t: any) => t.name).join(", ");
          setMessages((prev) => [...prev, {
            role: "assistant",
            text: `Template "${templateName}" not found. Available: ${available}`,
          }]);
          return;
        }
      } else if (templatesRes.templates.length === 1) {
        // Only one template - use it directly
        templateSummary = templatesRes.templates[0];
      } else {
        // Multiple templates and no name specified - show picker
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: "Select a template to auto-fill this form:",
        }]);
        setTemplatePickerList(templatesRes.templates.map((t: any) => ({
          id: t.id,
          name: t.name,
          fieldCount: t.fieldCount,
          isDefault: t.isDefault,
        })));
        setShowTemplatePicker(true);
        setLoading(false);
        setCurrentStatus(null);
        return;
      }

      // Get full template
      const fullTemplateRes = await sendNative("getFormTemplate", { templateId: templateSummary.id });
      if (!fullTemplateRes?.ok) {
        setMessages((prev) => [...prev, { role: "assistant", text: "Failed to load template." }]);
        return;
      }

      const template: FormTemplate = fullTemplateRes.template;

      // 4. Analyze what can be filled
      const analysis = analyzeFormForAutoFill(formsResponse.forms, template);

      // 5. Check if we have good matches or need manual mapping
      if (analysis.canFill.length > 0) {
        // Good matches - show preview and confirmation
        let previewText = `**Form Analysis** (using "${template.name}"):\n\n`;
        previewText += `**Will auto-fill (${analysis.canFill.length} fields):**\n`;
        for (const item of analysis.canFill) {
          previewText += `- ${item.field.label || item.field.name}: "${item.templateField.value}"\n`;
        }

        if (analysis.needsInput.length > 0) {
          previewText += `\n**Unmatched fields (${analysis.needsInput.length}):**\n`;
          for (const field of analysis.needsInput) {
            previewText += `- ${field.label || field.name} (${field.type})\n`;
          }
        }

        previewText += `\n**Match confidence:** ${Math.round(analysis.confidence * 100)}%`;
        setMessages((prev) => [...prev, { role: "assistant", text: previewText }]);
        setPendingAutoFill(analysis);
      } else {
        // No matches - show field mapping UI
        const allFormFields: FormField[] = [];
        for (const form of formsResponse.forms) {
          allFormFields.push(...form.fields);
        }

        // Get all templates with their full details for mapping
        const templatesWithFields: { id: string; name: string; fields: TemplateField[] }[] = [];
        for (const t of templatesRes.templates) {
          const fullRes = await sendNative("getFormTemplate", { templateId: t.id });
          if (fullRes?.ok) {
            templatesWithFields.push({
              id: fullRes.template.id,
              name: fullRes.template.name,
              fields: fullRes.template.fields,
            });
          }
        }

        setMessages((prev) => [...prev, {
          role: "assistant",
          text: `**No automatic matches found.** The form has ${allFormFields.length} fields but none matched your template aliases.\n\nUse the mapping tool below to manually connect form fields to your template values.`,
        }]);

        setFieldMapping({
          formFields: allFormFields,
          templates: templatesWithFields,
          selectedTemplateId: template.id,
          mappings: new Map(),
          tabId: activeTab.id,
        });
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Auto-fill failed: ${e.message}`,
      }]);
    } finally {
      setLoading(false);
      setCurrentStatus(null);
    }
  }, []);

  // Execute auto-fill
  const executeAutoFill = useCallback(async () => {
    if (!pendingAutoFill) return;
    setLoading(true);
    setCurrentStatus("Filling form...");

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        setMessages((prev) => [...prev, { role: "assistant", text: "No active tab found." }]);
        return;
      }

      let filled = 0;
      for (const item of pendingAutoFill.canFill) {
        try {
          const response = await chrome.tabs.sendMessage(activeTab.id, {
            type: "fillFormField",
            selector: item.field.selector,
            value: item.templateField.value,
          });
          if (response?.ok) {
            filled++;
          }
        } catch (e) {
          console.error("Failed to fill field:", item.field.selector, e);
        }
      }

      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Filled **${filled}/${pendingAutoFill.canFill.length}** fields from "${pendingAutoFill.template.name}".`,
      }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Auto-fill failed: ${e.message}`,
      }]);
    } finally {
      setPendingAutoFill(null);
      setLoading(false);
      setCurrentStatus(null);
    }
  }, [pendingAutoFill]);

  // Cancel auto-fill
  const cancelAutoFill = useCallback(() => {
    setPendingAutoFill(null);
    setMessages((prev) => [...prev, { role: "assistant", text: "Auto-fill cancelled." }]);
  }, []);

  // Select template from picker and execute autofill
  const selectTemplateFromPicker = useCallback(async (templateId: string) => {
    setShowTemplatePicker(false);
    setTemplatePickerList([]);
    // Call handleAutoFillCommand with the selected template name
    const template = templatePickerList.find((t) => t.id === templateId);
    if (template) {
      // Execute autofill with selected template
      handleAutoFillCommand(template.name);
    }
  }, [templatePickerList, handleAutoFillCommand]);

  // Cancel template picker
  const cancelTemplatePicker = useCallback(() => {
    setShowTemplatePicker(false);
    setTemplatePickerList([]);
    setMessages((prev) => [...prev, { role: "assistant", text: "Template selection cancelled." }]);
  }, []);

  // Field mapping handlers
  const updateFieldMapping = useCallback((formFieldSelector: string, templateFieldKey: string | null) => {
    setFieldMapping((prev) => {
      if (!prev) return null;
      const newMappings = new Map(prev.mappings);
      if (templateFieldKey) {
        newMappings.set(formFieldSelector, templateFieldKey);
      } else {
        newMappings.delete(formFieldSelector);
      }
      return { ...prev, mappings: newMappings };
    });
  }, []);

  const selectMappingTemplate = useCallback((templateId: string) => {
    setFieldMapping((prev) => {
      if (!prev) return null;
      return { ...prev, selectedTemplateId: templateId, mappings: new Map() };
    });
  }, []);

  const executeMappedFill = useCallback(async () => {
    if (!fieldMapping || !fieldMapping.selectedTemplateId) return;

    const template = fieldMapping.templates.find((t) => t.id === fieldMapping.selectedTemplateId);
    if (!template) return;

    setLoading(true);
    setCurrentStatus("Filling form...");

    try {
      let filled = 0;
      for (const [selector, templateKey] of fieldMapping.mappings) {
        const templateField = template.fields.find((f) => f.key === templateKey);
        if (!templateField || !templateField.value) continue;

        try {
          const response = await chrome.tabs.sendMessage(fieldMapping.tabId, {
            type: "fillFormField",
            selector,
            value: templateField.value,
          });
          if (response?.ok) {
            filled++;
          }
        } catch (e) {
          console.error("Failed to fill field:", selector, e);
        }
      }

      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Filled **${filled}/${fieldMapping.mappings.size}** fields from "${template.name}".`,
      }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `Fill failed: ${e.message}`,
      }]);
    } finally {
      setFieldMapping(null);
      setLoading(false);
      setCurrentStatus(null);
    }
  }, [fieldMapping]);

  const cancelFieldMapping = useCallback(() => {
    setFieldMapping(null);
    setMessages((prev) => [...prev, { role: "assistant", text: "Field mapping cancelled." }]);
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

            // Try multiple strategies to get page content
            let text = "";

            // Strategy 1: Look for semantic content containers
            const contentSelectors = [
              "article",
              "main",
              "[role='main']",
              ".content",
              ".main-content",
              "#content",
              "#main",
              ".article",
              ".post",
              ".entry-content",
            ];

            for (const selector of contentSelectors) {
              const el = document.querySelector(selector);
              if (el && el.innerText && el.innerText.trim().length > 100) {
                text = el.innerText;
                break;
              }
            }

            // Strategy 2: If no semantic container found, get all visible text
            if (!text || text.trim().length < 100) {
              // Get text from all visible elements, excluding scripts/styles/hidden
              const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                  acceptNode: (node) => {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    const tag = parent.tagName.toLowerCase();
                    if (["script", "style", "noscript", "svg", "path"].includes(tag)) {
                      return NodeFilter.FILTER_REJECT;
                    }
                    const style = window.getComputedStyle(parent);
                    if (style.display === "none" || style.visibility === "hidden") {
                      return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                  },
                }
              );

              const textParts: string[] = [];
              let node;
              while ((node = walker.nextNode())) {
                const t = node.textContent?.trim();
                if (t && t.length > 1) {
                  textParts.push(t);
                }
              }
              text = textParts.join(" ");
            }

            // Strategy 3: Fallback to body innerText
            if (!text || text.trim().length < 50) {
              text = document.body?.innerText || "";
            }

            // Clean up whitespace
            text = text.replace(/\s+/g, " ").trim().slice(0, 5000);

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
        name: "templates",
        aliases: ["t", "formtemplates"],
        description: "View and manage form templates",
        handler: handleFormsTabCommand,
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
      {
        name: "autofill",
        aliases: ["af", "auto"],
        description: "Auto-fill forms with saved templates",
        handler: handleAutoFillCommand,
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
      handleFormsTabCommand,
      handleIntegrationsCommand,
      handleWorkflowsCommand,
      handlePageCommand,
      handleFormsCommand,
      handleFillCommand,
      handleSubmitCommand,
      handleAutoFillCommand,
    ]
  );

  const {
    showMenu,
    setShowMenu,
    selectedIndex,
    filteredCommands,
    handleInputChange: handleSlashInput,
    handleKeyDown: handleSlashKeyDown,
    selectCommand,
    parseCommand,
  } = useSlashCommands({ commands: slashCommands });

  // Load templates when slash menu opens (for autocomplete)
  useEffect(() => {
    if (showMenu) {
      sendNative("listFormTemplates").then((res) => {
        if (res?.ok && res.templates) {
          setMenuTemplates(res.templates.map((t: any) => ({
            id: t.id,
            name: t.name,
            fieldCount: t.fieldCount,
            isDefault: t.isDefault,
          })));
        }
      }).catch(() => {
        setMenuTemplates([]);
      });
    }
  }, [showMenu]);

  // Handle template selection from slash menu
  const handleMenuTemplateSelect = useCallback((templateName: string) => {
    setShowMenu(false);
    setInput("");
    handleAutoFillCommand(templateName);
  }, [handleAutoFillCommand, setShowMenu]);

  // Detect forms on page and suggest best matching template
  useEffect(() => {
    if (tab !== "chat") return;
    if (templateSuggestion?.dismissed) return;

    const detectAndSuggest = async () => {
      try {
        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;

        // Get forms from page
        const formsResponse = await chrome.tabs.sendMessage(tab.id, { type: "getFormFields" });
        if (!formsResponse?.ok || !formsResponse.forms?.length) {
          setTemplateSuggestion(null);
          return;
        }

        // Get templates
        const templatesRes = await sendNative("listFormTemplates");
        if (!templatesRes?.ok || !templatesRes.templates?.length) {
          setTemplateSuggestion(null);
          return;
        }

        // Collect all form fields
        const allFormFields: FormField[] = [];
        for (const form of formsResponse.forms) {
          allFormFields.push(...form.fields);
        }

        if (allFormFields.length === 0) {
          setTemplateSuggestion(null);
          return;
        }

        // Normalize helper
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
        const extractTerms = (s: string) => normalize(s).split(" ").filter((t) => t.length > 2);

        // Score each template
        let bestTemplate: { id: string; name: string } | null = null;
        let bestMatchCount = 0;

        for (const tSummary of templatesRes.templates) {
          // Get full template
          const fullRes = await sendNative("getFormTemplate", { templateId: tSummary.id });
          if (!fullRes?.ok) continue;
          const template = fullRes.template;

          // Count matches
          let matchCount = 0;
          for (const field of allFormFields) {
            const fieldText = [field.name, field.label, field.placeholder].filter(Boolean).join(" ");
            const fieldNorm = normalize(fieldText);
            const fieldTerms = extractTerms(fieldText);

            const matched = template.fields.some((tf: TemplateField) => {
              if (!tf.value) return false;
              for (const alias of tf.aliases) {
                const aliasNorm = normalize(alias);
                const aliasTerms = extractTerms(alias);
                if (fieldNorm.includes(aliasNorm) || aliasNorm.includes(fieldNorm)) return true;
                for (const term of aliasTerms) {
                  if (fieldTerms.some((ft: string) => ft.includes(term) || term.includes(ft))) return true;
                }
              }
              const labelNorm = normalize(tf.label);
              const keyNorm = normalize(tf.key);
              if (fieldNorm.includes(labelNorm) || labelNorm.includes(fieldNorm)) return true;
              if (fieldNorm.includes(keyNorm) || keyNorm.includes(fieldNorm)) return true;
              return false;
            });

            if (matched) matchCount++;
          }

          if (matchCount > bestMatchCount) {
            bestMatchCount = matchCount;
            bestTemplate = { id: template.id, name: template.name };
          }
        }

        // Show suggestion if confidence > 60%
        const confidence = allFormFields.length > 0 ? bestMatchCount / allFormFields.length : 0;
        if (bestTemplate && confidence >= 0.6) {
          setTemplateSuggestion({
            template: bestTemplate,
            matchCount: bestMatchCount,
            totalFields: allFormFields.length,
            dismissed: false,
          });
        } else {
          setTemplateSuggestion(null);
        }
      } catch (e) {
        // Silently fail - suggestion is optional
        setTemplateSuggestion(null);
      }
    };

    detectAndSuggest();
  }, [tab, templateSuggestion?.dismissed]);

  // Handle suggestion actions
  const handleSuggestionFill = useCallback(() => {
    if (templateSuggestion) {
      handleAutoFillCommand(templateSuggestion.template.name);
      setTemplateSuggestion(null);
    }
  }, [templateSuggestion, handleAutoFillCommand]);

  const handleSuggestionOther = useCallback(() => {
    setTemplateSuggestion(null);
    handleAutoFillCommand("");
  }, [handleAutoFillCommand]);

  const dismissSuggestion = useCallback(() => {
    setTemplateSuggestion((prev) => prev ? { ...prev, dismissed: true } : null);
  }, []);

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
    await startConsolidation();
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

  const railTabs: { key: Tab; icon: string; label: string }[] = [
    { key: "chat", icon: "💬", label: "Chat" },
    { key: "analysis", icon: "🔍", label: "Page Analysis" },
    { key: "memory", icon: "🧠", label: "Memory" },
    { key: "forms", icon: "📝", label: "Forms" },
    { key: "files", icon: "📁", label: "Files" },
    { key: "skills", icon: "⚡", label: "Skills" },
    { key: "history", icon: "📖", label: "History" },
    { key: "integrations", icon: "🔌", label: "Integrations" },
    { key: "workflows", icon: "🎬", label: "Workflows" },
    { key: "active", icon: "🔄", label: "Active" },
  ];

  const railBottomTabs: { key: Tab; icon: string; label: string }[] = [
    { key: "settings", icon: "⚙", label: "Settings" },
  ];

  // If thought dump is open, show it instead
  if (showDump) {
    return <ThoughtDumpView onClose={() => setShowDump(false)} />;
  }

  return (
    <div className="flex-1 flex min-h-0 h-full">
      {/* Rail - vertical icon sidebar */}
      <div
        className="flex flex-col items-center py-3 gap-1 flex-shrink-0 glass"
        style={{ width: 46, borderRadius: 0, borderTop: 0, borderBottom: 0, borderLeft: 0 }}
      >
        {railTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            title={t.label}
            className={`w-[36px] h-[36px] flex items-center justify-center rounded-lg text-base transition-all relative ${
              tab === t.key
                ? "text-lily-accent"
                : "text-lily-muted hover:text-lily-text hover:bg-white/5"
            }`}
            style={tab === t.key ? { background: "var(--lily-accent-subtle)" } : undefined}
          >
            {tab === t.key && (
              <span
                className="absolute left-0 top-[8px] bottom-[8px] rounded-r-sm rail-indicator"
                style={{ width: 3, background: "var(--lily-accent)" }}
              />
            )}
            {t.icon}
          </button>
        ))}
        <div className="flex-1" />
        {railBottomTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            title={t.label}
            className={`w-[36px] h-[36px] flex items-center justify-center rounded-lg text-base transition-all relative ${
              tab === t.key
                ? "text-lily-accent"
                : "text-lily-muted hover:text-lily-text hover:bg-white/5"
            }`}
            style={tab === t.key ? { background: "var(--lily-accent-subtle)" } : undefined}
          >
            {tab === t.key && (
              <span
                className="absolute left-0 top-[8px] bottom-[8px] rounded-r-sm rail-indicator"
                style={{ width: 3, background: "var(--lily-accent)" }}
              />
            )}
            {t.icon}
          </button>
        ))}
      </div>

      {/* Content panel */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {tab === "goals" && <GoalsView />}
        {tab === "history" && <HistoryView onResume={handleResumeSession} />}
        {tab === "memory" && <MemoryView />}
        {tab === "forms" && <FormsView />}
        {tab === "files" && <FilesView />}
        {tab === "skills" && <SkillsView />}
        {tab === "integrations" && <IntegrationsView onStartAuthChat={handleStartAuthChat} />}
        {tab === "workflows" && <WorkflowsView />}
        {tab === "active" && <ActiveWorkflowsView />}
        {tab === "settings" && <SettingsView />}
        {tab === "analysis" && <PageAnalysisView />}

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
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {/* Smart Template Suggestion Banner */}
            {templateSuggestion && !templateSuggestion.dismissed && (
              <div className="glass-card rounded-lg p-3 border border-green-500/30 mb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-lg">💡</span>
                    <div className="min-w-0">
                      <p className="text-sm text-lily-text">
                        Form detected! Fill with <strong className="text-green-400">{templateSuggestion.template.name}</strong>?
                      </p>
                      <p className="text-xs text-lily-muted">
                        {templateSuggestion.matchCount}/{templateSuggestion.totalFields} fields match
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={dismissSuggestion}
                    className="text-lily-muted hover:text-lily-text p-1 flex-shrink-0"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                      <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                    </svg>
                  </button>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleSuggestionFill}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600 transition-colors"
                  >
                    Fill Now
                  </button>
                  <button
                    onClick={handleSuggestionOther}
                    className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-text transition-colors"
                  >
                    Other Templates
                  </button>
                </div>
              </div>
            )}
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
                className={`p-3 text-sm overflow-hidden msg-enter ${
                  m.role === "user"
                    ? "msg-user ml-8"
                    : "msg-assistant mr-8"
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
              <div className="msg-assistant mr-8 p-3 text-sm">
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
            {/* Auto-Fill Confirmation */}
            {pendingAutoFill && (
              <div className="glass-card mr-8 rounded-lg p-3 text-sm border border-green-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-green-400">
                    <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
                  </svg>
                  <span className="text-green-400 font-medium">Ready to Auto-Fill</span>
                  <span className="text-xs text-lily-muted">({pendingAutoFill.template.name})</span>
                </div>
                <p className="text-xs text-lily-muted mb-3">
                  Will fill {pendingAutoFill.canFill.length} field{pendingAutoFill.canFill.length !== 1 ? "s" : ""} from your template.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={executeAutoFill}
                    disabled={loading}
                    className="flex-1 px-3 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors text-sm font-medium"
                  >
                    Fill Now
                  </button>
                  <button
                    onClick={cancelAutoFill}
                    disabled={loading}
                    className="px-3 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-text transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
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
            {/* Template Picker UI */}
            {showTemplatePicker && templatePickerList.length > 0 && (
              <div className="glass-card mr-8 rounded-lg p-3 text-sm border border-lily-accent/30">
                <div className="flex items-center gap-2 mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-lily-accent">
                    <path fillRule="evenodd" d="M3.5 2A1.5 1.5 0 0 0 2 3.5V15a3 3 0 1 0 6 0V3.5A1.5 1.5 0 0 0 6.5 2h-3Zm11.753 6.99a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 .75-.75Zm0-2.5a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 .75-.75Zm0 5a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 .75-.75Zm0 2.5a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 .75-.75Z" clipRule="evenodd" />
                  </svg>
                  <span className="text-lily-accent font-medium">Select Template</span>
                </div>
                <div className="space-y-2 mb-3">
                  {templatePickerList.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => selectTemplateFromPicker(template.id)}
                      className="w-full glass-card rounded-lg p-2 text-left hover:ring-1 hover:ring-lily-accent transition-all flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {template.isDefault && (
                          <span className="text-yellow-400 text-xs">★</span>
                        )}
                        <span className="text-sm truncate">{template.name}</span>
                      </div>
                      <span className="text-xs text-lily-muted flex-shrink-0">{template.fieldCount} fields</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={cancelTemplatePicker}
                  className="w-full px-3 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-text transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            )}
            {/* Field Mapping UI */}
            {fieldMapping && (
              <div className="glass-card mr-8 rounded-lg p-3 text-sm border border-blue-500/30">
                <div className="flex items-center gap-2 mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-blue-400">
                    <path fillRule="evenodd" d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-9.5A2.25 2.25 0 0 0 16.75 3H3.25ZM2.5 9v5.75c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75V9h-15Zm14.25 4a.75.75 0 0 1-.75.75H4a.75.75 0 0 1 0-1.5h12a.75.75 0 0 1 .75.75Zm0-2.5a.75.75 0 0 1-.75.75H4a.75.75 0 0 1 0-1.5h12a.75.75 0 0 1 .75.75Z" clipRule="evenodd" />
                  </svg>
                  <span className="text-blue-400 font-medium">Map Form Fields</span>
                </div>

                {/* Template selector */}
                <div className="mb-3">
                  <label className="text-xs text-lily-muted block mb-1">Use template:</label>
                  <select
                    value={fieldMapping.selectedTemplateId || ""}
                    onChange={(e) => selectMappingTemplate(e.target.value)}
                    className="w-full glass-card text-lily-text rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="">Select a template...</option>
                    {fieldMapping.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.fields.length} fields)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Field mappings */}
                {fieldMapping.selectedTemplateId && (
                  <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                    <p className="text-xs text-lily-muted">Map each form field to a template value:</p>
                    {fieldMapping.formFields.map((field) => {
                      const selectedTemplate = fieldMapping.templates.find((t) => t.id === fieldMapping.selectedTemplateId);
                      const currentMapping = fieldMapping.mappings.get(field.selector);
                      const mappedField = selectedTemplate?.fields.find((f) => f.key === currentMapping);

                      return (
                        <div key={field.selector} className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <span className="text-xs truncate block">{field.label || field.name || field.placeholder || "Unknown"}</span>
                            <span className="text-[10px] text-lily-muted">({field.type})</span>
                          </div>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-lily-muted flex-shrink-0">
                            <path fillRule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clipRule="evenodd" />
                          </svg>
                          <select
                            value={currentMapping || ""}
                            onChange={(e) => updateFieldMapping(field.selector, e.target.value || null)}
                            className={`flex-1 glass-card rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-400 ${currentMapping ? "text-green-400" : "text-lily-muted"}`}
                          >
                            <option value="">Skip</option>
                            {selectedTemplate?.fields.map((tf) => (
                              <option key={tf.key} value={tf.key}>
                                {tf.label}: {tf.value ? `"${tf.value.slice(0, 20)}${tf.value.length > 20 ? "..." : ""}"` : "(empty)"}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={executeMappedFill}
                    disabled={loading || !fieldMapping.selectedTemplateId || fieldMapping.mappings.size === 0}
                    className="flex-1 px-3 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    Fill {fieldMapping.mappings.size} Field{fieldMapping.mappings.size !== 1 ? "s" : ""}
                  </button>
                  <button
                    onClick={cancelFieldMapping}
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
                templates={menuTemplates}
                onSelectTemplate={handleMenuTemplateSelect}
              />
            )}

            {/* Attachment preview */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachments.map((att) => {
                  const icon = getFileTypeIcon(att.name);
                  return (
                    <div
                      key={att.name}
                      className="flex items-center gap-1.5 px-2 py-1 glass-card rounded-lg text-xs"
                    >
                      <span
                        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded text-[7px] font-bold text-white flex-shrink-0"
                        style={{ backgroundColor: icon.color }}
                      >
                        {icon.label}
                      </span>
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
                  );
                })}
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

      {/* Memory Consolidation Modal */}
      {showConsolidation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-lg p-4 w-full max-w-sm max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">
                {extractedItems.length > 0 ? "Save Memories" : "Session Summary"}
              </h3>
              {extractedItems.length > 0 && (
                <button
                  onClick={handleConsolidationSkip}
                  className="text-lily-muted hover:text-lily-text text-xs"
                >
                  Skip
                </button>
              )}
            </div>

            {activeMemoryProject && (
              <p className="text-xs text-lily-accent mb-1">
                Saving to: {activeMemoryProject.name}
              </p>
            )}
            {!activeMemoryProject && (
              <p className="text-xs text-lily-muted mb-1">
                No project attached. Saving to general memory.
              </p>
            )}

            {/* Session summary — always shown */}
            {consolidationSummary && (
              <div className="glass-card rounded-lg p-3 mb-3 border border-lily-accent/15">
                <div className="text-[10px] font-semibold text-lily-muted uppercase tracking-wider mb-1">
                  Session Summary
                </div>
                <p className="text-xs text-lily-text leading-relaxed">
                  {consolidationSummary}
                </p>
              </div>
            )}

            {extractedItems.length > 0 && (
              <p className="text-xs text-lily-muted mb-3">
                Review extracted memories. Uncheck any you don't want to save.
              </p>
            )}

            <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
              {/* Facts section */}
              {extractedItems.some((i) => i.type === "facts") && (
                <div>
                  <div className="text-[10px] font-semibold text-lily-muted uppercase tracking-wider mb-1.5">
                    Facts
                  </div>
                  {extractedItems.map((item, idx) =>
                    item.type === "facts" ? (
                      <label
                        key={idx}
                        className="flex items-start gap-2 p-2 rounded-lg glass-card mb-1.5 cursor-pointer hover:ring-1 hover:ring-lily-accent/30"
                      >
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => {
                            const updated = [...extractedItems];
                            updated[idx] = { ...item, selected: !item.selected };
                            setExtractedItems(updated);
                          }}
                          className="mt-0.5 accent-lily-accent rounded"
                        />
                        <span className="text-sm flex-1">{item.content}</span>
                      </label>
                    ) : null
                  )}
                </div>
              )}

              {/* People section */}
              {extractedItems.some((i) => i.type === "people") && (
                <div>
                  <div className="text-[10px] font-semibold text-lily-muted uppercase tracking-wider mb-1.5">
                    People
                  </div>
                  {extractedItems.map((item, idx) =>
                    item.type === "people" ? (
                      <label
                        key={idx}
                        className="flex items-start gap-2 p-2 rounded-lg glass-card mb-1.5 cursor-pointer hover:ring-1 hover:ring-lily-accent/30"
                      >
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => {
                            const updated = [...extractedItems];
                            updated[idx] = { ...item, selected: !item.selected };
                            setExtractedItems(updated);
                          }}
                          className="mt-0.5 accent-lily-accent rounded"
                        />
                        <span className="text-sm flex-1">{item.content}</span>
                      </label>
                    ) : null
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-3">
              {extractedItems.length > 0 ? (
                <>
                  <button
                    onClick={handleConsolidationConfirm}
                    disabled={consolidationLoading || extractedItems.filter((i) => i.selected).length === 0}
                    className="flex-1 px-4 py-2 rounded-lg bg-lily-accent text-white text-sm hover:bg-lily-hover disabled:opacity-50 transition-colors"
                  >
                    {consolidationLoading
                      ? "Saving..."
                      : `Save ${extractedItems.filter((i) => i.selected).length} item${extractedItems.filter((i) => i.selected).length !== 1 ? "s" : ""}`}
                  </button>
                  <button
                    onClick={handleConsolidationSkip}
                    disabled={consolidationLoading}
                    className="px-4 py-2 rounded-lg glass-card text-lily-muted text-sm hover:text-lily-text disabled:opacity-50 transition-colors"
                  >
                    Skip
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConsolidationSkip}
                  className="flex-1 px-4 py-2 rounded-lg bg-lily-accent text-white text-sm hover:bg-lily-hover transition-colors"
                >
                  End Session
                </button>
              )}
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
    </div>
  );
}
