import { useState, useCallback, useEffect } from "react";

export interface Thought {
  id: string;
  text: string;
  createdAt: string;
}

export interface DumpAnalysis {
  themes: string[];
  priorities: { thought: string; reason: string; urgency: "high" | "medium" | "low" }[];
  quickWins: string[];
  suggestedGoals: string[];
  summary: string;
  analyzedAt: string;
  isPartial: boolean;
  thoughtCount: number;
}

export interface ThoughtDumpSession {
  id: string;
  thoughts: Thought[];
  startedAt: string;
  lastActivityAt: string;
  status: "active" | "locked" | "stale";
  analysis: DumpAnalysis | null;
}

async function sendNative(action: string, payload: any = {}): Promise<any> {
  return chrome.runtime.sendMessage({ type: "native", action, payload });
}

export function useThoughtDump() {
  const [session, setSession] = useState<ThoughtDumpSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load session on mount
  useEffect(() => {
    loadSession();
  }, []);

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sendNative("getDumpSession");
      if (res?.ok) {
        setSession(res.session);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const startNewSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await sendNative("newDumpSession");
      if (res?.ok) {
        setSession(res.session);
      } else {
        setError(res?.error || "Failed to create session");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const addThought = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setError(null);
    try {
      const res = await sendNative("addThought", { text });
      if (res?.ok) {
        setSession(res.session);
      } else {
        setError(res?.error || "Failed to add thought");
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const deleteThought = useCallback(async (thoughtId: string) => {
    setError(null);
    try {
      const res = await sendNative("deleteThought", { thoughtId });
      if (res?.ok) {
        setSession(res.session);
      } else {
        setError(res?.error || "Failed to delete thought");
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const analyzePartial = useCallback(async () => {
    if (!session || session.thoughts.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await sendNative("analyzePartial");
      if (res?.ok) {
        setSession(res.session);
      } else {
        setError(res?.error || "Failed to analyze");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }, [session]);

  const analyzeFull = useCallback(async () => {
    if (!session || session.thoughts.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await sendNative("analyzeFull");
      if (res?.ok) {
        setSession(res.session);
      } else {
        setError(res?.error || "Failed to analyze");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }, [session]);

  return {
    session,
    loading,
    analyzing,
    error,
    loadSession,
    startNewSession,
    addThought,
    deleteThought,
    analyzePartial,
    analyzeFull,
  };
}
