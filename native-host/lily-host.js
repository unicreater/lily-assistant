#!/usr/bin/env node
// ~/.lily-host/lily-host.js -- Lily native messaging host
// Protocol: Chrome Native Messaging (4-byte LE length prefix on stdin/stdout)
// No dependencies. Node.js stdlib only.

"use strict";

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const VERSION = "0.1.0";
const LILY_DIR = path.join(os.homedir(), "lily");
const SESSIONS_DIR = path.join(LILY_DIR, "sessions");
const STATE_DIR = path.join(LILY_DIR, "state");
const SKILLS_DIR = path.join(LILY_DIR, "skills");
const TEMPLATES_DIR = path.join(LILY_DIR, "templates");
const CLAUDE_MD = path.join(LILY_DIR, "CLAUDE.md");
const GOALS_FILE = path.join(STATE_DIR, "goals.json");
const TIMEOUT_MS = 60000;

// --- PATH resolution for claude binary ---
function findClaude() {
  const tryPaths = [
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    path.join(os.homedir(), ".npm-global/bin/claude"),
    path.join(os.homedir(), ".local/bin/claude"),
    path.join(os.homedir(), ".claude/local/claude"),
  ];
  for (const p of tryPaths) {
    if (fs.existsSync(p)) return p;
  }
  // fallback: try which
  try {
    return execSync("which claude", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

const CLAUDE_PATH = findClaude();

// --- Ensure directories ---
function ensureDirs() {
  for (const d of [LILY_DIR, SESSIONS_DIR, STATE_DIR, SKILLS_DIR, TEMPLATES_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
ensureDirs();

// --- Native Messaging I/O ---
let inputBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const msgLen = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + msgLen) break;
    const msgBytes = inputBuffer.slice(4, 4 + msgLen);
    inputBuffer = inputBuffer.slice(4 + msgLen);
    let msg;
    try {
      msg = JSON.parse(msgBytes.toString("utf-8"));
    } catch (e) {
      sendResponse({ id: null, ok: false, error: "Invalid JSON" });
      continue;
    }
    handleMessage(msg);
  }
});

process.stdin.on("end", () => process.exit(0));

function sendResponse(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// --- Message routing ---
async function handleMessage(msg) {
  const { id, action, payload } = msg;
  try {
    let result;
    switch (action) {
      case "ping":
        result = { ok: true, version: VERSION, lilyDir: LILY_DIR, claudePath: CLAUDE_PATH };
        break;
      case "chat":
        result = await handleChat(payload);
        break;
      case "briefing":
        result = await handleBriefing();
        break;
      case "log":
        result = handleLog(payload);
        break;
      case "getState":
        result = handleGetState(payload);
        break;
      case "setState":
        result = handleSetState(payload);
        break;
      case "getGoals":
        result = handleGetGoals();
        break;
      case "setGoals":
        result = handleSetGoals(payload);
        break;
      default:
        result = { ok: false, error: `Unknown action: ${action}` };
    }
    sendResponse({ id, ...result });
  } catch (e) {
    sendResponse({ id, ok: false, error: e.message || String(e) });
  }
}

// --- Claude CLI spawn ---
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    if (!CLAUDE_PATH) {
      return reject(new Error("Claude CLI not found. Install it and re-run install.sh."));
    }

    let stdout = "";
    let stderr = "";
    const proc = spawn(CLAUDE_PATH, ["-p", prompt], {
      cwd: LILY_DIR,
      timeout: TIMEOUT_MS,
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin" },
    });

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Claude exited ${code}: ${stderr.trim()}`));
    });
    proc.on("error", reject);

    // Hard timeout safety net
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error("Claude CLI timed out after 60s"));
    }, TIMEOUT_MS + 1000);
  });
}

// --- Action handlers ---
async function handleChat(payload) {
  const { text } = payload || {};
  if (!text) return { ok: false, error: "Missing text" };

  // Read CLAUDE.md for system context
  let systemContext = "";
  try {
    systemContext = fs.readFileSync(CLAUDE_MD, "utf-8");
  } catch {}

  const prompt = systemContext
    ? `${systemContext}\n\n---\nUser: ${text}`
    : text;

  const response = await runClaude(prompt);

  // Log to session
  const today = new Date().toISOString().slice(0, 10);
  const sessionFile = path.join(SESSIONS_DIR, `${today}.md`);
  const entry = `\n## ${new Date().toISOString()}\n**User:** ${text}\n\n**Lily:** ${response}\n\n---\n`;
  fs.appendFileSync(sessionFile, entry, "utf-8");

  return { ok: true, response };
}

async function handleBriefing() {
  let goals = [];
  try {
    goals = JSON.parse(fs.readFileSync(GOALS_FILE, "utf-8"));
  } catch {}

  const today = new Date().toISOString().slice(0, 10);
  let recentSession = "";
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    recentSession = fs.readFileSync(path.join(SESSIONS_DIR, `${yesterday}.md`), "utf-8").slice(-2000);
  } catch {}

  const prompt = [
    "You are Lily, a personal AI assistant. Generate a morning briefing.",
    goals.length ? `Current goals:\n${goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}` : "No goals set.",
    recentSession ? `Recent conversation excerpt:\n${recentSession}` : "No recent conversations.",
    `Today is ${today}. Provide a concise, actionable briefing.`,
  ].join("\n\n");

  const response = await runClaude(prompt);
  return { ok: true, response };
}

function handleLog(payload) {
  const { text } = payload || {};
  if (!text) return { ok: false, error: "Missing text" };
  const today = new Date().toISOString().slice(0, 10);
  const sessionFile = path.join(SESSIONS_DIR, `${today}.md`);
  fs.appendFileSync(sessionFile, `\n**Log:** ${text}\n`, "utf-8");
  return { ok: true };
}

function handleGetState(payload) {
  const { key } = payload || {};
  if (!key) return { ok: false, error: "Missing key" };
  // Validate: key must be alphanumeric/dashes/underscores only
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) return { ok: false, error: "Invalid key" };
  const filePath = path.join(STATE_DIR, `${key}.json`);
  // Path traversal check
  if (!filePath.startsWith(STATE_DIR)) return { ok: false, error: "Path traversal blocked" };
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return { ok: true, data };
  } catch {
    return { ok: true, data: null };
  }
}

function handleSetState(payload) {
  const { key, data } = payload || {};
  if (!key) return { ok: false, error: "Missing key" };
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) return { ok: false, error: "Invalid key" };
  const filePath = path.join(STATE_DIR, `${key}.json`);
  if (!filePath.startsWith(STATE_DIR)) return { ok: false, error: "Path traversal blocked" };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return { ok: true };
}

function handleGetGoals() {
  try {
    const data = JSON.parse(fs.readFileSync(GOALS_FILE, "utf-8"));
    return { ok: true, data };
  } catch {
    return { ok: true, data: [] };
  }
}

function handleSetGoals(payload) {
  const { goals } = payload || {};
  if (!Array.isArray(goals)) return { ok: false, error: "goals must be an array" };
  fs.writeFileSync(GOALS_FILE, JSON.stringify(goals, null, 2), "utf-8");
  return { ok: true };
}
