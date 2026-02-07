import { useState, useEffect, useCallback } from "react";

interface TrackedFile {
  id: string;
  name: string;
  type: "upload" | "created" | "download";
  mimeType: string;
  size: number;
  path: string;
  originalPath?: string;
  sourceUrl?: string;
  sessionId?: string;
  createdAt: string;
  tags: string[];
}

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  return date.toLocaleDateString();
}

function getFileIcon(mimeType: string, name: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType === "application/pdf") return "📕";
  if (name.endsWith(".md")) return "📝";
  if (name.endsWith(".json")) return "📋";
  if (name.match(/\.(js|ts|jsx|tsx|py|go|rs|java|c|cpp|h|rb|php)$/)) return "💻";
  if (name.match(/\.(html|css)$/)) return "🌐";
  if (name.match(/\.(sh|bash|zsh)$/)) return "⚙️";
  return "📄";
}

export function FilesView() {
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "upload" | "created" | "download">("all");
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<TrackedFile | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const payload = filter !== "all" ? { type: filter } : {};
      const res = await sendNative("listFiles", payload);
      if (res?.ok) {
        setFiles(res.files || []);
      }
    } catch (e) {
      console.error("Failed to load files:", e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const loadFileContent = async (file: TrackedFile) => {
    setSelectedFile(file);
    setContentLoading(true);
    try {
      const res = await sendNative("getFile", { fileId: file.id });
      if (res?.ok) {
        setFileContent(res.content);
      }
    } catch (e) {
      console.error("Failed to load file content:", e);
    } finally {
      setContentLoading(false);
    }
  };

  const openFile = async (file: TrackedFile) => {
    try {
      const res = await sendNative("openFile", { fileId: file.id });
      if (!res?.ok) {
        console.error("Failed to open file:", res?.error);
      }
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  const deleteFile = async (file: TrackedFile) => {
    const confirmed = window.confirm(`Delete "${file.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const res = await sendNative("deleteFile", { fileId: file.id });
      if (res?.ok) {
        setSelectedFile(null);
        setFileContent(null);
        loadFiles();
      }
    } catch (e) {
      console.error("Failed to delete file:", e);
    }
  };

  // Filter files by search term
  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  // Group files by type
  const groupedFiles = {
    upload: filteredFiles.filter((f) => f.type === "upload"),
    created: filteredFiles.filter((f) => f.type === "created"),
    download: filteredFiles.filter((f) => f.type === "download"),
  };

  // File detail view
  if (selectedFile) {
    return (
      <div className="flex-1 flex flex-col min-h-0 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => {
              setSelectedFile(null);
              setFileContent(null);
            }}
            className="text-lily-muted hover:text-lily-accent text-sm flex items-center gap-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path
                fillRule="evenodd"
                d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
                clipRule="evenodd"
              />
            </svg>
            Back to Files
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => openFile(selectedFile)}
              className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-accent"
            >
              Open
            </button>
            <button
              onClick={() => deleteFile(selectedFile)}
              className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-red-400"
            >
              Delete
            </button>
          </div>
        </div>

        {/* File info */}
        <div className="mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <span>{getFileIcon(selectedFile.mimeType, selectedFile.name)}</span>
            {selectedFile.name}
          </h3>
          <div className="text-xs text-lily-muted mt-2 space-y-1">
            <p>Type: <span className="text-lily-text">{selectedFile.type}</span></p>
            <p>Size: <span className="text-lily-text">{formatFileSize(selectedFile.size)}</span></p>
            <p>Added: <span className="text-lily-text">{new Date(selectedFile.createdAt).toLocaleString()}</span></p>
            {selectedFile.originalPath && (
              <p>Original: <code className="text-lily-accent text-[10px]">{selectedFile.originalPath}</code></p>
            )}
            {selectedFile.sourceUrl && (
              <p>Source: <a href={selectedFile.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-lily-accent hover:underline">{selectedFile.sourceUrl}</a></p>
            )}
          </div>
        </div>

        {/* Content preview */}
        <div className="flex-1 overflow-hidden">
          <h4 className="text-sm font-medium text-lily-muted mb-2">Content Preview</h4>
          {contentLoading ? (
            <div className="text-sm text-lily-muted text-center py-8">Loading...</div>
          ) : fileContent ? (
            <div className="h-full overflow-y-auto glass-card rounded-lg p-3">
              <pre className="text-xs whitespace-pre-wrap font-mono">{fileContent.slice(0, 10000)}{fileContent.length > 10000 ? "\n\n... (truncated)" : ""}</pre>
            </div>
          ) : (
            <div className="text-sm text-lily-muted text-center py-8">
              No preview available (binary file or file not stored)
            </div>
          )}
        </div>
      </div>
    );
  }

  // Files list view
  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>📁</span> Files
        </h2>
        <span className="text-xs text-lily-muted">{files.length} file{files.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Search and filter */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="flex-1 glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent"
        >
          <option value="all">All</option>
          <option value="upload">Uploads</option>
          <option value="created">Created</option>
          <option value="download">Downloads</option>
        </select>
      </div>

      {/* Info */}
      <p className="text-xs text-lily-muted mb-4">
        Files attached to messages or created during sessions are tracked here.
      </p>

      {/* Files list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-sm text-lily-muted text-center py-8">Loading...</div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-sm text-lily-muted text-center py-8">
            {search ? "No files match your search." : "No files tracked yet. Attach files to messages to see them here."}
          </div>
        ) : filter === "all" ? (
          // Grouped view
          <div className="space-y-4">
            {groupedFiles.upload.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-lily-muted mb-2 flex items-center gap-1">
                  <span>📤</span> Uploads ({groupedFiles.upload.length})
                </h3>
                <div className="space-y-1">
                  {groupedFiles.upload.map((file) => (
                    <FileRow key={file.id} file={file} onClick={() => loadFileContent(file)} />
                  ))}
                </div>
              </div>
            )}
            {groupedFiles.created.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-lily-muted mb-2 flex items-center gap-1">
                  <span>✨</span> Created ({groupedFiles.created.length})
                </h3>
                <div className="space-y-1">
                  {groupedFiles.created.map((file) => (
                    <FileRow key={file.id} file={file} onClick={() => loadFileContent(file)} />
                  ))}
                </div>
              </div>
            )}
            {groupedFiles.download.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-lily-muted mb-2 flex items-center gap-1">
                  <span>📥</span> Downloads ({groupedFiles.download.length})
                </h3>
                <div className="space-y-1">
                  {groupedFiles.download.map((file) => (
                    <FileRow key={file.id} file={file} onClick={() => loadFileContent(file)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          // Flat list for filtered view
          <div className="space-y-1">
            {filteredFiles.map((file) => (
              <FileRow key={file.id} file={file} onClick={() => loadFileContent(file)} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-xs text-lily-muted mt-4 text-center">
        Files stored in ~/lily/files/
      </div>
    </div>
  );
}

// File row component
function FileRow({ file, onClick }: { file: TrackedFile; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full glass-card rounded-lg p-2 text-left hover:ring-1 hover:ring-lily-accent transition-all flex items-center gap-2"
    >
      <span className="text-lg">{getFileIcon(file.mimeType, file.name)}</span>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium truncate">{file.name}</h4>
        <p className="text-[10px] text-lily-muted">
          {formatFileSize(file.size)} • {formatDate(file.createdAt)}
        </p>
      </div>
    </button>
  );
}
