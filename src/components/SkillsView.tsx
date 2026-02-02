import { useState, useEffect, useCallback } from "react";

interface Skill {
  filename: string;
  name: string;
  description: string;
  trigger: string | string[];
  requires_mcp: string | null;
}

interface SkillDetail {
  content: string;
  metadata: Record<string, any>;
  body: string;
}

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

export function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sendNative("listSkills");
      if (res?.ok) {
        setSkills(res.skills || []);
      }
    } catch (e) {
      console.error("Failed to load skills:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const loadSkillDetail = async (filename: string) => {
    try {
      const res = await sendNative("getSkill", { filename });
      if (res?.ok) {
        setSkillDetail(res);
        setEditContent(res.content);
        setSelectedSkill(filename);
      }
    } catch (e) {
      console.error("Failed to load skill:", e);
    }
  };

  const saveSkill = async () => {
    if (!selectedSkill || !editContent.trim()) return;
    setSaving(true);
    try {
      const res = await sendNative("saveSkill", {
        filename: selectedSkill,
        content: editContent,
      });
      if (res?.ok) {
        setEditing(false);
        loadSkills();
        loadSkillDetail(selectedSkill);
      }
    } catch (e) {
      console.error("Failed to save skill:", e);
    } finally {
      setSaving(false);
    }
  };

  const deleteSkill = async (filename: string) => {
    const confirmed = window.confirm(`Delete skill "${filename}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const res = await sendNative("deleteSkill", { filename });
      if (res?.ok) {
        setSelectedSkill(null);
        setSkillDetail(null);
        loadSkills();
      }
    } catch (e) {
      console.error("Failed to delete skill:", e);
    }
  };

  const createSkill = async () => {
    if (!newSkillName.trim()) return;

    const filename = newSkillName.toLowerCase().replace(/[^a-z0-9-]/g, "-") + ".md";
    const template = `---
name: ${newSkillName}
trigger: /${newSkillName.toLowerCase().replace(/\s+/g, "-")}
description: Description of what this skill does
---

# ${newSkillName}

Instructions for Lily when this skill is triggered:

1. Step one
2. Step two
3. Step three
`;

    try {
      const res = await sendNative("saveSkill", {
        filename,
        content: template,
      });
      if (res?.ok) {
        setCreating(false);
        setNewSkillName("");
        loadSkills();
        loadSkillDetail(res.filename);
        setEditing(true);
      }
    } catch (e) {
      console.error("Failed to create skill:", e);
    }
  };

  const formatTriggers = (trigger: string | string[]): string => {
    if (Array.isArray(trigger)) {
      return trigger.join(", ");
    }
    return trigger || "No trigger";
  };

  if (selectedSkill && skillDetail) {
    return (
      <div className="flex-1 flex flex-col min-h-0 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => {
              setSelectedSkill(null);
              setSkillDetail(null);
              setEditing(false);
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
            Back to Skills
          </button>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditContent(skillDetail.content);
                  }}
                  className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-text"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSkill}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-lily-accent text-white text-xs hover:bg-lily-hover disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-lily-accent"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteSkill(selectedSkill)}
                  className="px-3 py-1.5 rounded-lg glass-card text-lily-muted text-xs hover:text-red-400"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Skill info */}
        <div className="mb-4">
          <h3 className="text-lg font-semibold">{skillDetail.metadata.name || selectedSkill}</h3>
          <p className="text-sm text-lily-muted">{skillDetail.metadata.description}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {(Array.isArray(skillDetail.metadata.trigger)
              ? skillDetail.metadata.trigger
              : [skillDetail.metadata.trigger]
            )
              .filter(Boolean)
              .map((t: string, i: number) => (
                <span key={i} className="px-2 py-0.5 glass-card rounded text-xs text-lily-accent">
                  {t}
                </span>
              ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {editing ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full glass-card text-lily-text rounded-lg p-3 text-sm resize-none outline-none focus:ring-1 focus:ring-lily-accent font-mono"
              placeholder="Skill content..."
            />
          ) : (
            <div className="h-full overflow-y-auto glass-card rounded-lg p-3">
              <pre className="text-sm whitespace-pre-wrap font-mono">{skillDetail.content}</pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>⚡</span> Skills
        </h2>
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1.5 rounded-lg bg-lily-accent text-white text-xs hover:bg-lily-hover"
        >
          + New Skill
        </button>
      </div>

      {/* Create new skill modal */}
      {creating && (
        <div className="mb-4 p-4 glass-card rounded-lg">
          <h3 className="text-sm font-semibold mb-2">Create New Skill</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createSkill()}
              placeholder="Skill name (e.g., 'Interview Prep')"
              className="flex-1 glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
              autoFocus
            />
            <button
              onClick={createSkill}
              disabled={!newSkillName.trim()}
              className="px-3 py-2 rounded-lg bg-lily-accent text-white hover:bg-lily-hover disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setNewSkillName("");
              }}
              className="px-3 py-2 rounded-lg glass-card text-lily-muted hover:text-lily-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Info */}
      <p className="text-xs text-lily-muted mb-4">
        Skills are instructions that activate when you use specific triggers. Try typing a trigger
        like "/email" to activate a skill.
      </p>

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-sm text-lily-muted text-center py-8">Loading...</div>
        ) : skills.length === 0 ? (
          <div className="text-sm text-lily-muted text-center py-8">
            No skills yet. Create one above or add .md files to ~/lily/skills/
          </div>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <button
                key={skill.filename}
                onClick={() => loadSkillDetail(skill.filename)}
                className="w-full glass-card rounded-lg p-3 text-left hover:ring-1 hover:ring-lily-accent transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-medium">{skill.name}</h3>
                    <p className="text-xs text-lily-muted mt-0.5">{skill.description}</p>
                  </div>
                  {skill.requires_mcp && (
                    <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px]">
                      MCP
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(Array.isArray(skill.trigger) ? skill.trigger : [skill.trigger])
                    .filter(Boolean)
                    .map((t, i) => (
                      <span key={i} className="px-1.5 py-0.5 glass rounded text-xs text-lily-accent">
                        {t}
                      </span>
                    ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-xs text-lily-muted mt-4 text-center">
        Skills are markdown files in ~/lily/skills/
      </div>
    </div>
  );
}
