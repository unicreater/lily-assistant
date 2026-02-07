import { useState, useEffect, useCallback, useRef } from "react";
import {
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE,
  getFileExtension,
  formatFileSize,
  readFileContent,
} from "~lib/fileParser";

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectMemory {
  facts: string[];
  people: string[];
  documents: string[];
  instructions: string;
  memorySummary: string;
}

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}


type MemoryTab = "memory" | "instructions" | "documents";

export function MemoryView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MemoryTab>("memory");
  const [adding, setAdding] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Instructions state
  const [instructionsText, setInstructionsText] = useState("");
  const [instructionsDirty, setInstructionsDirty] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);

  // Memory summary state
  const [memorySummaryText, setMemorySummaryText] = useState("");
  const [memorySummaryDirty, setMemorySummaryDirty] = useState(false);
  const [savingMemorySummary, setSavingMemorySummary] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);

  // Facts/People collapsible sections state
  const [factsOpen, setFactsOpen] = useState(true);
  const [peopleOpen, setPeopleOpen] = useState(true);
  const [newFactItem, setNewFactItem] = useState("");
  const [newPersonItem, setNewPersonItem] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sendNative("listProjects");
      if (res?.ok) {
        setProjects(res.projects || []);
      }
    } catch (e) {
      console.error("Failed to load projects:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjectMemory = useCallback(async (projectId: string) => {
    try {
      const res = await sendNative("getProjectMemory", { projectId });
      if (res?.ok) {
        setProjectMemory(res.memory);
      }
    } catch (e) {
      console.error("Failed to load project memory:", e);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (selectedProject) {
      loadProjectMemory(selectedProject.id);
    }
  }, [selectedProject, loadProjectMemory]);

  // Sync text fields when project memory loads
  useEffect(() => {
    if (projectMemory) {
      setInstructionsText(projectMemory.instructions || "");
      setInstructionsDirty(false);
      setMemorySummaryText(projectMemory.memorySummary || "");
      setMemorySummaryDirty(false);
    }
  }, [projectMemory]);

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    setCreating(true);
    try {
      const res = await sendNative("createProject", {
        name: newProjectName.trim(),
        description: newProjectDesc.trim(),
      });
      if (res?.ok) {
        setNewProjectName("");
        setNewProjectDesc("");
        setShowCreateModal(false);
        loadProjects();
        if (res.project) {
          setSelectedProject(res.project);
        }
      }
    } catch (e) {
      console.error("Failed to create project:", e);
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    const confirmed = window.confirm("Delete this project and all its memories?");
    if (!confirmed) return;

    try {
      const res = await sendNative("deleteProject", { projectId });
      if (res?.ok) {
        if (selectedProject?.id === projectId) {
          setSelectedProject(null);
          setProjectMemory(null);
        }
        loadProjects();
      }
    } catch (e) {
      console.error("Failed to delete project:", e);
    }
  };

  const saveInstructions = async () => {
    if (!selectedProject) return;
    setSavingInstructions(true);
    try {
      const res = await sendNative("updateProjectMemory", {
        projectId: selectedProject.id,
        type: "instructions",
        item: instructionsText,
      });
      if (res?.ok) {
        setInstructionsDirty(false);
      }
    } catch (e) {
      console.error("Failed to save instructions:", e);
    } finally {
      setSavingInstructions(false);
    }
  };

  const saveMemorySummary = async () => {
    if (!selectedProject) return;
    setSavingMemorySummary(true);
    try {
      const res = await sendNative("updateProjectMemory", {
        projectId: selectedProject.id,
        type: "memorySummary",
        item: memorySummaryText,
      });
      if (res?.ok) {
        setMemorySummaryDirty(false);
      }
    } catch (e) {
      console.error("Failed to save memory summary:", e);
    } finally {
      setSavingMemorySummary(false);
    }
  };

  const generateSummary = async () => {
    if (!selectedProject) return;
    setGeneratingSummary(true);
    try {
      const res = await sendNative("updateMemorySummary", {
        projectId: selectedProject.id,
        newItems: [],
      });
      if (res?.ok && res.summary) {
        setMemorySummaryText(res.summary);
        setMemorySummaryDirty(false);
      }
    } catch (e) {
      console.error("Failed to generate summary:", e);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const addMemoryItem = async (type: "facts" | "people", item: string) => {
    if (!selectedProject || !item.trim()) return;
    setAddingItem(true);
    try {
      const res = await sendNative("updateProjectMemory", {
        projectId: selectedProject.id,
        type,
        action: "add",
        item: item.trim(),
      });
      if (res?.ok) {
        if (type === "facts") setNewFactItem("");
        else setNewPersonItem("");
        loadProjectMemory(selectedProject.id);
      }
    } catch (e) {
      console.error(`Failed to add ${type} item:`, e);
    } finally {
      setAddingItem(false);
    }
  };

  const removeMemoryItem = async (type: "facts" | "people", item: string) => {
    if (!selectedProject) return;
    try {
      const res = await sendNative("updateProjectMemory", {
        projectId: selectedProject.id,
        type,
        action: "remove",
        item,
      });
      if (res?.ok) {
        loadProjectMemory(selectedProject.id);
      }
    } catch (e) {
      console.error(`Failed to remove ${type} item:`, e);
    }
  };

  const removeDocumentItem = async (item: string) => {
    if (!selectedProject) return;
    const confirmed = window.confirm(`Remove this document?`);
    if (!confirmed) return;

    try {
      const res = await sendNative("updateProjectMemory", {
        projectId: selectedProject.id,
        type: "documents",
        action: "remove",
        item,
      });
      if (res?.ok) {
        loadProjectMemory(selectedProject.id);
      }
    } catch (e) {
      console.error("Failed to remove document:", e);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedProject) return;

    setFileError(null);
    setAdding(true);

    for (const file of Array.from(files)) {
      const ext = getFileExtension(file.name);
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        setFileError(`Unsupported file type: ${ext || "no extension"}. Supported: text, code, PDF, DOCX.`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        setFileError(`File "${file.name}" is too large (${formatFileSize(file.size)}). Max: 500 KB.`);
        continue;
      }

      try {
        const content = await readFileContent(file);
        const docEntry = `## ${file.name}\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\`${content.length > 10000 ? "\n[truncated...]" : ""}`;

        const res = await sendNative("updateProjectMemory", {
          projectId: selectedProject.id,
          type: "documents",
          action: "add",
          item: docEntry,
        });

        if (!res?.ok) {
          setFileError(`Failed to add "${file.name}"`);
        }
      } catch (err) {
        setFileError(`Failed to read "${file.name}". The file may be corrupted or unsupported.`);
      }
    }

    loadProjectMemory(selectedProject.id);
    setAdding(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const getDocDisplayName = (doc: string): string => {
    const match = doc.match(/^## (.+?)\n/);
    return match ? match[1] : doc.slice(0, 50) + "...";
  };

  // Check if project has facts/people but no summary (for backfill button)
  const hasDataForSummary = projectMemory &&
    ((projectMemory.facts?.length > 0) || (projectMemory.people?.length > 0));

  const tabs: { key: MemoryTab; label: string; icon: string }[] = [
    { key: "memory", label: "Memory", icon: "🧠" },
    { key: "instructions", label: "Instructions", icon: "📋" },
    { key: "documents", label: "Docs", icon: "📄" },
  ];

  // Project detail view
  if (selectedProject) {
    const documentItems = projectMemory?.documents || [];

    return (
      <div className="flex-1 flex flex-col min-h-0 p-4">
        {/* Back button and project header */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => {
              setSelectedProject(null);
              setProjectMemory(null);
            }}
            className="text-lily-muted hover:text-lily-accent"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">{selectedProject.name}</h2>
            {selectedProject.description && (
              <p className="text-xs text-lily-muted">{selectedProject.description}</p>
            )}
          </div>
          <button
            onClick={() => deleteProject(selectedProject.id)}
            className="text-lily-muted hover:text-red-400 p-1"
            title="Delete project"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-lily-border mb-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                tab === t.key
                  ? "text-lily-accent border-b-2 border-lily-accent"
                  : "text-lily-muted hover:text-lily-text"
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Memory tab */}
        {tab === "memory" && (
          <div className="flex-1 flex flex-col min-h-0">
            <p className="text-xs text-lily-muted mb-2">
              A running summary of everything learned across conversations. Auto-updated after each session.
            </p>
            {memorySummaryText ? (
              <>
                <textarea
                  value={memorySummaryText}
                  onChange={(e) => {
                    setMemorySummaryText(e.target.value);
                    setMemorySummaryDirty(true);
                  }}
                  className="flex-1 glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted resize-none min-h-[120px]"
                />
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-lily-muted">
                    {memorySummaryText.length} chars
                  </span>
                  <button
                    onClick={saveMemorySummary}
                    disabled={!memorySummaryDirty || savingMemorySummary}
                    className="px-4 py-1.5 rounded-lg bg-lily-accent text-white text-sm hover:bg-lily-hover disabled:opacity-50 transition-colors"
                  >
                    {savingMemorySummary ? "Saving..." : "Save"}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                <span className="text-3xl mb-3">🧠</span>
                <p className="text-sm text-lily-muted mb-1">No memory yet</p>
                <p className="text-xs text-lily-muted mb-4">
                  Memory builds automatically as you chat with this project attached.
                </p>
                {hasDataForSummary && (
                  <button
                    onClick={generateSummary}
                    disabled={generatingSummary}
                    className="px-4 py-2 rounded-lg bg-lily-accent text-white text-sm hover:bg-lily-hover disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    {generatingSummary ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        Generating...
                      </>
                    ) : (
                      "Generate Summary from Existing Data"
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Instructions tab */}
        {tab === "instructions" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            <p className="text-xs text-lily-muted mb-2">
              Custom instructions that guide Lily when this project is active. These are always included in context.
            </p>
            <textarea
              value={instructionsText}
              onChange={(e) => {
                setInstructionsText(e.target.value);
                setInstructionsDirty(true);
              }}
              placeholder="e.g., Always respond in formal English. Focus on technical accuracy. Reference the project's API documentation when answering questions..."
              className="glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted resize-none min-h-[100px]"
            />
            <div className="flex items-center justify-between mt-2 mb-4">
              <span className="text-xs text-lily-muted">
                {instructionsText.length > 0 ? `${instructionsText.length} chars` : "No instructions set"}
              </span>
              <button
                onClick={saveInstructions}
                disabled={!instructionsDirty || savingInstructions}
                className="px-4 py-1.5 rounded-lg bg-lily-accent text-white text-sm hover:bg-lily-hover disabled:opacity-50 transition-colors"
              >
                {savingInstructions ? "Saving..." : "Save"}
              </button>
            </div>

            {/* Facts section */}
            <div className="mb-3">
              <button
                onClick={() => setFactsOpen(!factsOpen)}
                className="flex items-center gap-2 w-full text-left text-sm font-medium text-lily-text mb-2"
              >
                <span className="text-xs text-lily-muted transition-transform" style={{ transform: factsOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
                  ▶
                </span>
                <span>💡 Facts</span>
                <span className="text-xs text-lily-muted">({projectMemory?.facts?.length || 0})</span>
              </button>
              {factsOpen && (
                <div className="glass-card rounded-lg p-3">
                  {projectMemory?.facts && projectMemory.facts.length > 0 ? (
                    <ul className="space-y-1 mb-2">
                      {projectMemory.facts.map((fact, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-xs text-lily-text group">
                          <span className="flex items-start gap-1.5 min-w-0">
                            <span className="text-lily-accent mt-0.5 shrink-0">•</span>
                            <span className="break-words">{fact}</span>
                          </span>
                          <button
                            onClick={() => removeMemoryItem("facts", fact)}
                            className="text-lily-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            title="Remove"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-lily-muted mb-2">No facts added yet.</p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newFactItem}
                      onChange={(e) => setNewFactItem(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addMemoryItem("facts", newFactItem)}
                      placeholder="Add a fact..."
                      className="flex-1 bg-transparent border border-lily-border rounded px-2 py-1 text-xs text-lily-text outline-none focus:border-lily-accent placeholder:text-lily-muted"
                    />
                    <button
                      onClick={() => addMemoryItem("facts", newFactItem)}
                      disabled={!newFactItem.trim() || addingItem}
                      className="text-xs text-lily-accent hover:text-lily-hover disabled:opacity-50 font-medium px-2"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* People section */}
            <div className="mb-3">
              <button
                onClick={() => setPeopleOpen(!peopleOpen)}
                className="flex items-center gap-2 w-full text-left text-sm font-medium text-lily-text mb-2"
              >
                <span className="text-xs text-lily-muted transition-transform" style={{ transform: peopleOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
                  ▶
                </span>
                <span>👤 People</span>
                <span className="text-xs text-lily-muted">({projectMemory?.people?.length || 0})</span>
              </button>
              {peopleOpen && (
                <div className="glass-card rounded-lg p-3">
                  {projectMemory?.people && projectMemory.people.length > 0 ? (
                    <ul className="space-y-1 mb-2">
                      {projectMemory.people.map((person, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-xs text-lily-text group">
                          <span className="flex items-start gap-1.5 min-w-0">
                            <span className="text-lily-accent mt-0.5 shrink-0">•</span>
                            <span className="break-words">{person}</span>
                          </span>
                          <button
                            onClick={() => removeMemoryItem("people", person)}
                            className="text-lily-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            title="Remove"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-lily-muted mb-2">No people added yet.</p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newPersonItem}
                      onChange={(e) => setNewPersonItem(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addMemoryItem("people", newPersonItem)}
                      placeholder="Add a person..."
                      className="flex-1 bg-transparent border border-lily-border rounded px-2 py-1 text-xs text-lily-text outline-none focus:border-lily-accent placeholder:text-lily-muted"
                    />
                    <button
                      onClick={() => addMemoryItem("people", newPersonItem)}
                      disabled={!newPersonItem.trim() || addingItem}
                      className="text-xs text-lily-accent hover:text-lily-hover disabled:opacity-50 font-medium px-2"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Documents tab */}
        {tab === "documents" && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="mb-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                multiple
                accept={Array.from(SUPPORTED_EXTENSIONS).join(",")}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={adding}
                className="w-full glass-card rounded-lg p-4 text-sm text-lily-muted hover:text-lily-accent hover:ring-1 hover:ring-lily-accent transition-all flex flex-col items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6">
                  <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
                  <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                </svg>
                <span>{adding ? "Adding..." : "Upload files"}</span>
                <span className="text-xs text-lily-muted">Text files, code, JSON, etc.</span>
              </button>
              {fileError && (
                <div className="text-xs text-red-400 mt-2 flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                  </svg>
                  {fileError}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {!projectMemory ? (
                <div className="text-sm text-lily-muted text-center py-8">Loading...</div>
              ) : documentItems.length === 0 ? (
                <div className="text-sm text-lily-muted text-center py-8">
                  No documents stored yet. Upload files above.
                </div>
              ) : (
                <div className="space-y-2">
                  {documentItems.map((item, i) => (
                    <div
                      key={i}
                      className="glass-card rounded-lg p-3 text-sm flex justify-between items-start group"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-lg">📄</span>
                        <span className="truncate">{getDocDisplayName(item)}</span>
                      </div>
                      <button
                        onClick={() => removeDocumentItem(item)}
                        className="text-lily-muted hover:text-red-400 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                          <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Projects list view
  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>🧠</span> Memory
        </h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 rounded-lg bg-lily-accent text-white text-xs hover:bg-lily-hover transition-colors flex items-center gap-1"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
            <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
          </svg>
          New Project
        </button>
      </div>

      <p className="text-xs text-lily-muted mb-4">
        Organize context by project. Each project has memory, instructions, and documents that Lily will use.
      </p>

      {/* Projects list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-sm text-lily-muted text-center py-8">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="text-sm text-lily-muted text-center py-8">
            No projects yet. Create one to start organizing your memories.
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedProject(project)}
                className="w-full glass-card rounded-lg p-3 text-left hover:ring-1 hover:ring-lily-accent transition-all"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">📁</span>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium">{project.name}</h3>
                    {project.description && (
                      <p className="text-xs text-lily-muted mt-0.5 truncate">{project.description}</p>
                    )}
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-lily-muted">
                    <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="text-xs text-lily-muted mt-4 text-center">
        Select a project in Chat to include its context.
      </div>

      {/* Create project modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-lg p-4 w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-4">New Project</h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-lily-muted block mb-1">Project Name</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createProject()}
                  placeholder="e.g., CIMB Job Application"
                  className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-lily-muted block mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="Brief description..."
                  className="w-full glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewProjectName("");
                  setNewProjectDesc("");
                }}
                className="flex-1 px-4 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createProject}
                disabled={creating || !newProjectName.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-lily-accent text-white hover:bg-lily-hover disabled:opacity-50 transition-colors"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
