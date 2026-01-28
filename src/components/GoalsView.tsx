import { useState, useEffect } from "react";

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

export function GoalsView() {
  const [goals, setGoals] = useState<string[]>([]);
  const [newGoal, setNewGoal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchGoals = async () => {
    setLoading(true);
    try {
      const res = await sendNative("getGoals");
      if (res?.ok && Array.isArray(res.data)) {
        setGoals(res.data);
      }
    } catch {}
    setLoading(false);
  };

  const saveGoals = async (updated: string[]) => {
    setSaving(true);
    try {
      await sendNative("setGoals", { goals: updated });
      setGoals(updated);
    } catch {}
    setSaving(false);
  };

  const addGoal = () => {
    const text = newGoal.trim();
    if (!text) return;
    setNewGoal("");
    saveGoals([...goals, text]);
  };

  const removeGoal = (index: number) => {
    saveGoals(goals.filter((_, i) => i !== index));
  };

  useEffect(() => {
    fetchGoals();
  }, []);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-sm font-semibold">Goals</h2>

      {loading ? (
        <p className="text-sm text-lily-muted">Loading...</p>
      ) : (
        <div className="space-y-2">
          {goals.length === 0 && (
            <p className="text-sm text-lily-muted">No goals yet. Add one below.</p>
          )}
          {goals.map((g, i) => (
            <div
              key={i}
              className="flex items-center justify-between glass-card rounded-lg px-3 py-2"
            >
              <span className="text-sm flex-1">{g}</span>
              <button
                onClick={() => removeGoal(i)}
                className="text-xs text-red-400 hover:text-red-300 ml-2"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addGoal()}
          placeholder="New goal..."
          className="flex-1 glass-card text-lily-text rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lily-accent placeholder:text-lily-muted"
        />
        <button
          onClick={addGoal}
          disabled={saving || !newGoal.trim()}
          className="px-3 py-2 rounded-lg bg-lily-accent text-white text-sm hover:bg-lily-hover disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
