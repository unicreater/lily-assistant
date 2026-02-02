import { useState, useRef, useEffect } from "react";
import { useThoughtDump, type ThoughtDumpSession } from "~hooks/useThoughtDump";

interface Props {
  onClose: () => void;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

// Simple markdown renderer for analysis
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Process inline: **bold**, *italic*
    const processInline = (s: string) => {
      return s
        .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, '<code class="bg-lily-border/30 px-1 rounded text-xs">$1</code>');
    };

    // Headers
    if (line.startsWith("### ")) {
      elements.push(<h4 key={i} className="font-semibold text-sm mt-3 mb-1" dangerouslySetInnerHTML={{ __html: processInline(line.slice(4)) }} />);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={i} className="font-semibold text-sm mt-3 mb-1 text-lily-accent" dangerouslySetInnerHTML={{ __html: processInline(line.slice(3)) }} />);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={i} className="font-bold text-base mt-3 mb-2 text-lily-accent" dangerouslySetInnerHTML={{ __html: processInline(line.slice(2)) }} />);
    }
    // HR
    else if (line.match(/^[-*_]{3,}$/)) {
      elements.push(<hr key={i} className="border-lily-border my-2" />);
    }
    // List items
    else if (line.match(/^[-*]\s/)) {
      const content = line.replace(/^[-*]\s/, "");
      if (content.startsWith("[ ] ")) {
        elements.push(<div key={i} className="flex items-start gap-2 ml-2"><span className="text-lily-muted">☐</span><span dangerouslySetInnerHTML={{ __html: processInline(content.slice(4)) }} /></div>);
      } else if (content.startsWith("[x] ") || content.startsWith("[X] ")) {
        elements.push(<div key={i} className="flex items-start gap-2 ml-2"><span className="text-green-400">☑</span><span dangerouslySetInnerHTML={{ __html: processInline(content.slice(4)) }} /></div>);
      } else {
        elements.push(<div key={i} className="flex items-start gap-2 ml-2"><span className="text-lily-accent">•</span><span dangerouslySetInnerHTML={{ __html: processInline(content) }} /></div>);
      }
    }
    // Numbered list
    else if (line.match(/^\d+\.\s/)) {
      const content = line.replace(/^\d+\.\s/, "");
      elements.push(<div key={i} className="flex items-start gap-2 ml-2"><span className="text-lily-accent">{line.match(/^\d+/)![0]}.</span><span dangerouslySetInnerHTML={{ __html: processInline(content) }} /></div>);
    }
    // Table row
    else if (line.includes("|") && line.trim().startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      if (cells.length > 0 && !cells.every(c => /^[-:]+$/.test(c))) {
        elements.push(
          <div key={i} className="flex gap-2 text-xs py-1 border-b border-lily-border/50">
            {cells.map((cell, ci) => (
              <span key={ci} className="flex-1" dangerouslySetInnerHTML={{ __html: processInline(cell) }} />
            ))}
          </div>
        );
      }
    }
    // Empty line
    else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    }
    // Regular text
    else {
      elements.push(<p key={i} dangerouslySetInnerHTML={{ __html: processInline(line) }} />);
    }
  }

  return <div className="space-y-1 break-anywhere">{elements}</div>;
}

export function ThoughtDumpView({ onClose }: Props) {
  const {
    session,
    loading,
    analyzing,
    error,
    startNewSession,
    addThought,
    deleteThought,
    analyzePartial,
    analyzeFull,
  } = useThoughtDump();

  const [input, setInput] = useState("");
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [dumpHistory, setDumpHistory] = useState<ThoughtDumpSession[]>([]);
  const [selectedHistorySession, setSelectedHistorySession] = useState<ThoughtDumpSession | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load dump history from localStorage
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await chrome.runtime.sendMessage({ type: "native", action: "getDumpHistory" });
        if (res?.ok && res.sessions) {
          setDumpHistory(res.sessions);
        }
      } catch {}
    }
    if (showHistory) {
      loadHistory();
    }
  }, [showHistory]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll to bottom when thoughts are added
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [session?.thoughts.length]);

  const handleAddThought = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await addThought(text);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddThought();
    }
  };

  const handleAnalyzePartial = async () => {
    await analyzePartial();
    setShowAnalysis(true);
  };

  const handleAnalyzeFull = async () => {
    await analyzeFull();
    setShowAnalysis(true);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-lily-muted text-sm">Loading...</span>
      </div>
    );
  }

  // Show history view
  if (showHistory) {
    // If viewing a specific session
    if (selectedHistorySession) {
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 py-3 glass border-b border-lily-border">
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedHistorySession(null)} className="text-lily-muted hover:text-lily-text">
                ←
              </button>
              <span className="text-lg">📊</span>
              <h2 className="text-sm font-medium text-lily-text">
                {formatDate(selectedHistorySession.startedAt)}
              </h2>
              <span className="text-xs text-lily-muted">
                {selectedHistorySession.thoughts?.length || 0} thoughts
              </span>
            </div>
            <button onClick={onClose} className="text-lily-muted hover:text-lily-text text-sm">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedHistorySession.analysis && (
              <div className="glass-card rounded-lg p-4">
                <div className="text-sm text-lily-text">
                  {renderMarkdown(selectedHistorySession.analysis.summary)}
                </div>
              </div>
            )}
          </div>
          <div className="p-3 glass border-t border-lily-border">
            <button
              onClick={() => setSelectedHistorySession(null)}
              className="w-full px-4 py-2 rounded-lg glass-card text-lily-text text-sm hover:bg-lily-accent/10 transition-colors"
            >
              Back to History
            </button>
          </div>
        </div>
      );
    }

    // History list
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 glass border-b border-lily-border">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowHistory(false)} className="text-lily-muted hover:text-lily-text">
              ←
            </button>
            <span className="text-lg">📚</span>
            <h2 className="text-sm font-medium text-lily-text">Thought Universe</h2>
          </div>
          <button onClick={onClose} className="text-lily-muted hover:text-lily-text text-sm">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {dumpHistory.length === 0 ? (
            <p className="text-center text-lily-muted text-sm mt-8">
              No past thought dumps yet.
            </p>
          ) : (
            dumpHistory.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedHistorySession(s)}
                className="w-full glass-card rounded-lg p-3 text-left hover:bg-lily-accent/10 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-lily-text">{formatDate(s.startedAt)}</span>
                  <span className="text-xs text-lily-muted">{s.thoughts?.length || 0} thoughts</span>
                </div>
                <p className="text-xs text-lily-muted truncate">
                  {s.thoughts?.[0]?.text || "No thoughts"}
                </p>
              </button>
            ))
          )}
        </div>
        <div className="p-3 glass border-t border-lily-border">
          <button
            onClick={() => setShowHistory(false)}
            className="w-full px-4 py-2 rounded-lg bg-lily-accent text-white text-sm font-medium hover:bg-lily-hover transition-colors"
          >
            Back to Dump
          </button>
        </div>
      </div>
    );
  }

  // If no session or session is locked, show start/new session screen
  if (!session || session.status === "locked") {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 glass border-b border-lily-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <h2 className="text-sm font-medium text-lily-text">Thought Dump</h2>
          </div>
          <button
            onClick={onClose}
            className="text-lily-muted hover:text-lily-text text-sm"
          >
            ✕
          </button>
        </div>

        {/* Completed session analysis */}
        {session?.status === "locked" && session.analysis && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="glass-card rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-green-400">✓</span>
                <span className="text-sm font-medium text-lily-text">Session Complete</span>
                <span className="text-xs text-lily-muted ml-auto">
                  {session.analysis.thoughtCount} thoughts analyzed
                </span>
              </div>
              <div className="text-sm text-lily-text">
                {renderMarkdown(session.analysis.summary)}
              </div>
            </div>
          </div>
        )}

        {/* Start new session */}
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          {!session?.analysis && (
            <>
              <span className="text-4xl mb-4">💭</span>
              <p className="text-lily-text text-center mb-2">
                Dump your thoughts freely
              </p>
              <p className="text-lily-muted text-sm text-center mb-6">
                Capture everything on your mind, then analyze when ready.
              </p>
            </>
          )}
          <button
            onClick={startNewSession}
            className="px-6 py-2 rounded-lg bg-lily-accent text-white text-sm font-medium hover:bg-lily-hover transition-colors"
          >
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  // Show analysis view
  if (showAnalysis && session.analysis) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 glass border-b border-lily-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <h2 className="text-sm font-medium text-lily-text">Analysis</h2>
            <span className="text-xs text-lily-muted">
              {session.analysis.thoughtCount} thoughts
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-lily-muted hover:text-lily-text text-sm"
          >
            ✕
          </button>
        </div>

        {/* Analysis content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="glass-card rounded-lg p-4">
            <div className="text-sm text-lily-text">
              {renderMarkdown(session.analysis.summary)}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-3 glass border-t border-lily-border">
          <div className="flex gap-2">
            {session.analysis.isPartial ? (
              <>
                <button
                  onClick={() => setShowAnalysis(false)}
                  className="flex-1 px-4 py-2 rounded-lg glass-card text-lily-text text-sm hover:bg-lily-accent/10 transition-colors"
                >
                  Continue Dumping
                </button>
                <button
                  onClick={handleAnalyzeFull}
                  disabled={analyzing}
                  className="flex-1 px-4 py-2 rounded-lg bg-lily-accent text-white text-sm font-medium hover:bg-lily-hover disabled:opacity-50 transition-colors"
                >
                  {analyzing ? "Analyzing..." : "Done & Full Report"}
                </button>
              </>
            ) : (
              <button
                onClick={startNewSession}
                className="flex-1 px-4 py-2 rounded-lg bg-lily-accent text-white text-sm font-medium hover:bg-lily-hover transition-colors"
              >
                New Session
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main thought dump canvas
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 glass border-b border-lily-border">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <h2 className="text-sm font-medium text-lily-text">Thought Dump</h2>
          <span className="px-2 py-0.5 bg-lily-accent/20 text-lily-accent rounded-full text-xs">
            {session.thoughts.length} thoughts
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(true)}
            className="text-xs text-lily-muted hover:text-lily-accent"
            title="Thought Universe"
          >
            📚
          </button>
          <span className="text-xs text-lily-muted">
            Started {formatTime(session.startedAt)}
          </span>
          <button
            onClick={onClose}
            className="text-lily-muted hover:text-lily-text text-sm ml-2"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Thought list */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {session.thoughts.length === 0 ? (
          <p className="text-center text-lily-muted text-sm mt-8">
            Start dumping your thoughts below...
          </p>
        ) : (
          session.thoughts.map((thought) => (
            <div
              key={thought.id}
              className="glass-card rounded-lg p-3 group flex items-start gap-2"
            >
              <span className="text-lily-accent mt-0.5">•</span>
              <p className="flex-1 text-sm text-lily-text">{thought.text}</p>
              <button
                onClick={() => deleteThought(thought.id)}
                className="opacity-0 group-hover:opacity-100 text-lily-muted hover:text-red-400 text-xs transition-opacity"
                title="Delete thought"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="p-3 glass border-t border-lily-border">
        <div className="flex gap-2 mb-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a thought..."
            rows={1}
            className="flex-1 glass-card text-lily-text rounded-lg px-3 py-2 text-sm resize-none outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
          />
          <button
            onClick={handleAddThought}
            disabled={!input.trim()}
            className="px-4 py-2 rounded-lg bg-lily-accent text-white text-sm font-medium hover:bg-lily-hover disabled:opacity-50 transition-colors"
          >
            Add
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleAnalyzePartial}
            disabled={analyzing || session.thoughts.length === 0}
            className="flex-1 px-3 py-2 rounded-lg glass-card text-lily-text text-sm hover:bg-lily-accent/10 disabled:opacity-50 transition-colors"
          >
            {analyzing ? "Analyzing..." : "Analyze So Far"}
          </button>
          <button
            onClick={handleAnalyzeFull}
            disabled={analyzing || session.thoughts.length === 0}
            className="flex-1 px-3 py-2 rounded-lg bg-lily-accent text-white text-sm font-medium hover:bg-lily-hover disabled:opacity-50 transition-colors"
          >
            {analyzing ? "Analyzing..." : "Done & Analyze"}
          </button>
        </div>
      </div>
    </div>
  );
}
