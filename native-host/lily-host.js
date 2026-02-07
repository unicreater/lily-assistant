#!/usr/bin/env node
// ~/.lily-host/lily-host.js -- Lily native messaging host
// Protocol: Chrome Native Messaging (4-byte LE length prefix on stdin/stdout)
// No dependencies. Node.js stdlib only.

"use strict";

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const VERSION = "0.8.0"; // Persistent Claude process with stream-json
const LILY_DIR = path.join(os.homedir(), "lily");
const SESSIONS_DIR = path.join(LILY_DIR, "sessions");
const STATE_DIR = path.join(LILY_DIR, "state");
const SKILLS_DIR = path.join(LILY_DIR, "skills");
const TEMPLATES_DIR = path.join(LILY_DIR, "templates");
const DUMPS_DIR = path.join(LILY_DIR, "dumps");
const MEMORY_DIR = path.join(LILY_DIR, "memory");
const MEMORY_PROJECTS_DIR = path.join(MEMORY_DIR, "projects");
const WORKFLOWS_DIR = path.join(LILY_DIR, "workflows");
const INTEGRATIONS_DIR = path.join(LILY_DIR, "integrations");
const FORMS_DIR = path.join(LILY_DIR, "forms");
const FILES_DIR = path.join(LILY_DIR, "files");
const FILES_UPLOADS_DIR = path.join(FILES_DIR, "uploads");
const FILES_CREATED_DIR = path.join(FILES_DIR, "created");
const FILES_DOWNLOADS_DIR = path.join(FILES_DIR, "downloads");
const FILES_INDEX_FILE = path.join(FILES_DIR, "index.json");
// Starter integrations bundled with native host (copied to ~/lily/integrations on first run)
const STARTER_INTEGRATIONS_DIR = path.join(__dirname, "starter-integrations");
const CLAUDE_MD = path.join(LILY_DIR, "CLAUDE.md");
const CURRENT_STATE_FILE = path.join(STATE_DIR, "current.md");
const PROJECTS_INDEX_FILE = path.join(MEMORY_DIR, "projects.json");
// Legacy flat memory files (kept for backward compatibility)
const FACTS_FILE = path.join(MEMORY_DIR, "facts.md");
const PEOPLE_FILE = path.join(MEMORY_DIR, "people.md");
const PROJECTS_FILE = path.join(MEMORY_DIR, "projects.md");
const GOALS_FILE = path.join(STATE_DIR, "goals.json");
const HISTORY_FILE = path.join(STATE_DIR, "chat-history.json");
const ACTIVE_DUMP_FILE = path.join(STATE_DIR, "active-dump.json");
const CLAUDE_SESSION_FILE = path.join(STATE_DIR, "claude-session.json");
const ACTIVE_WORKFLOWS_FILE = path.join(STATE_DIR, "active-workflows.json");
const TIMEOUT_MS = 180000; // 3 minutes for longer responses
const DUMP_AUTO_SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours - sessions older than this start fresh

// Active session tracking (Lily's session)
let activeSessionId = null;
let activeSessionTitle = null;
let activeSessionStarted = null;

// Claude CLI session tracking (for --resume optimization)
let claudeSessionId = null;      // Claude CLI's native session ID
let claudeMdMtime = null;        // Track CLAUDE.md modification time
let claudeSessionCreatedAt = null; // When this Claude session was created

// Active thought dump tracking (in-memory for current session)
let activeDumpSession = null;

// Active Claude process tracking (for cancellation)
let activeClaudeProc = null;
let activeClaudeRequestId = null;

// Persistent Claude process for stream-json communication
let persistentClaudeProc = null;
let persistentClaudeSessionId = null;
let persistentClaudeBuffer = "";
let currentStreamRequestId = null;
let streamEventCallback = null;
let lastMemoryProjectId = null; // Track attached project to detect changes
let currentProcessTier = null; // null, "standard", "read", "full"

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

// Note: Don't cache CLAUDE_PATH - check on each ping so user can install mid-session

// --- Ensure directories ---
function ensureDirs() {
  for (const d of [LILY_DIR, SESSIONS_DIR, STATE_DIR, SKILLS_DIR, TEMPLATES_DIR, DUMPS_DIR, MEMORY_DIR, MEMORY_PROJECTS_DIR, WORKFLOWS_DIR, INTEGRATIONS_DIR, FORMS_DIR, FILES_DIR, FILES_UPLOADS_DIR, FILES_CREATED_DIR, FILES_DOWNLOADS_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
ensureDirs();

// --- Copy starter integrations on first run ---
function copyStarterIntegrations() {
  // Only copy if starter-integrations exists (in development/installed location)
  if (!fs.existsSync(STARTER_INTEGRATIONS_DIR)) return;

  try {
    const integrations = fs.readdirSync(STARTER_INTEGRATIONS_DIR);
    for (const name of integrations) {
      const srcDir = path.join(STARTER_INTEGRATIONS_DIR, name);
      const destDir = path.join(INTEGRATIONS_DIR, name);

      // Skip if already exists (don't overwrite user modifications)
      if (fs.existsSync(destDir)) continue;

      // Skip if not a directory
      const stat = fs.statSync(srcDir);
      if (!stat.isDirectory()) continue;

      // Copy the integration directory
      fs.mkdirSync(destDir, { recursive: true });
      const files = fs.readdirSync(srcDir);
      for (const file of files) {
        const srcFile = path.join(srcDir, file);
        const destFile = path.join(destDir, file);
        fs.copyFileSync(srcFile, destFile);
        // Preserve executable permission for setup.sh
        if (file === "setup.sh") {
          fs.chmodSync(destFile, 0o755);
        }
      }
    }
  } catch (e) {
    // Non-fatal - continue without copying
  }
}
copyStarterIntegrations();

// --- Load active dump session from disk on startup ---
function loadActiveDumpSession() {
  try {
    const data = JSON.parse(fs.readFileSync(ACTIVE_DUMP_FILE, "utf-8"));
    if (data && data.id) {
      // Check if session is stale (30+ min gap)
      const lastActivity = new Date(data.lastActivityAt || data.startedAt);
      const now = new Date();
      if (now.getTime() - lastActivity.getTime() < DUMP_AUTO_SESSION_GAP_MS) {
        activeDumpSession = data;
      }
    }
  } catch {}
}
loadActiveDumpSession();

// --- Load Claude session state from disk on startup ---
function loadClaudeSessionState() {
  try {
    const data = JSON.parse(fs.readFileSync(CLAUDE_SESSION_FILE, "utf-8"));
    if (data && data.claudeSessionId) {
      // Check if session is too old
      const createdAt = new Date(data.createdAt);
      const now = new Date();
      if (now.getTime() - createdAt.getTime() < SESSION_MAX_AGE_MS) {
        claudeSessionId = data.claudeSessionId;
        claudeMdMtime = data.claudeMdMtime;
        claudeSessionCreatedAt = data.createdAt;
        activeSessionId = data.lilySessionId || null;
        activeSessionTitle = data.lilySessionTitle || null;
        activeSessionStarted = data.lilySessionStarted || null;
      }
    }
  } catch {}
}
loadClaudeSessionState();

// --- Save Claude session state to disk ---
function saveClaudeSessionState() {
  try {
    const data = {
      claudeSessionId,
      claudeMdMtime,
      createdAt: claudeSessionCreatedAt,
      lastUsedAt: new Date().toISOString(),
      lilySessionId: activeSessionId,
      lilySessionTitle: activeSessionTitle,
      lilySessionStarted: activeSessionStarted,
    };
    fs.writeFileSync(CLAUDE_SESSION_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    // Non-fatal - continue without persistence
  }
}

// --- Clear Claude session state ---
function clearClaudeSessionState() {
  claudeSessionId = null;
  claudeMdMtime = null;
  claudeSessionCreatedAt = null;
  lastMemoryProjectId = null;
  currentProcessTier = null;
  try {
    fs.unlinkSync(CLAUDE_SESSION_FILE);
  } catch {}
}

// --- Get CLAUDE.md modification time ---
function getClaudeMdMtime() {
  try {
    const stats = fs.statSync(CLAUDE_MD);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

// --- Check if CLAUDE.md has changed ---
function hasClaudeMdChanged() {
  const currentMtime = getClaudeMdMtime();
  if (claudeMdMtime === null) return false; // No previous mtime tracked
  if (currentMtime === null) return false; // File doesn't exist
  return currentMtime !== claudeMdMtime;
}

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

// Track pending async operations
let pendingOps = 0;
let stdinEnded = false;

function maybeExit() {
  if (stdinEnded && pendingOps === 0) {
    process.exit(0);
  }
}

process.stdin.on("end", () => {
  stdinEnded = true;
  maybeExit();
});

function sendResponse(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// --- Check if Claude is authenticated ---
// Skip auth check for now - just check if CLI exists
// The auth check was causing 30+ second delays
async function checkClaudeAuth() {
  const claudePath = findClaude();
  if (!claudePath) return false;
  // For now, assume if claudePath exists, user is authenticated
  // The actual chat will fail if not authenticated and show a proper error
  return true;
}

// --- Message routing ---
async function handleMessage(msg) {
  pendingOps++;
  const { id, action, payload } = msg;
  try {
    let result;
    switch (action) {
      case "ping":
        const claudePath = findClaude();
        const authenticated = claudePath ? await checkClaudeAuth() : false;
        result = { ok: true, version: VERSION, lilyDir: LILY_DIR, claudePath, authenticated };
        break;
      case "chat":
        result = await handleChat(payload, id);
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
      case "login":
        result = await handleLogin();
        break;
      case "newSession":
        result = handleNewSession();
        break;
      case "endSession":
        result = await handleEndSession();
        break;
      case "stopChat":
        result = handleStopChat();
        break;
      case "getHistory":
        result = handleGetHistory();
        break;
      case "resumeSession":
        result = handleResumeSession(payload);
        break;
      case "getActiveSession":
        result = handleGetActiveSession();
        break;
      // Thought dump actions
      case "getDumpSession":
        result = handleGetDumpSession();
        break;
      case "newDumpSession":
        result = handleNewDumpSession();
        break;
      case "addThought":
        result = handleAddThought(payload);
        break;
      case "deleteThought":
        result = handleDeleteThought(payload);
        break;
      case "analyzePartial":
        result = await handleAnalyzePartial(id);
        break;
      case "analyzeFull":
        result = await handleAnalyzeFull(id);
        break;
      case "getDumpHistory":
        result = handleGetDumpHistory();
        break;
      case "saveClaudeMd":
        result = handleSaveClaudeMd(payload);
        break;
      case "hasOnboarded":
        result = handleHasOnboarded();
        break;
      // State tracking actions
      case "getCurrentState":
        result = handleGetCurrentState();
        break;
      case "updateCurrentState":
        result = await handleUpdateCurrentState(payload);
        break;
      // Memory system actions
      case "getMemory":
        result = handleGetMemory(payload);
        break;
      case "addMemory":
        result = handleAddMemory(payload);
        break;
      case "removeMemory":
        result = handleRemoveMemory(payload);
        break;
      case "searchMemory":
        result = handleSearchMemory(payload);
        break;
      case "extractMemory":
        result = await handleExtractMemory(id);
        break;
      // Project-based memory actions
      case "listProjects":
        result = handleListProjects();
        break;
      case "createProject":
        result = handleCreateProject(payload);
        break;
      case "deleteProject":
        result = handleDeleteProject(payload);
        break;
      case "getProjectMemory":
        result = handleGetProjectMemory(payload);
        break;
      case "updateProjectMemory":
        result = handleUpdateProjectMemory(payload);
        break;
      case "extractMemoriesPreview":
        result = await handleExtractMemoriesPreview(payload);
        break;
      case "saveExtractedMemories":
        result = handleSaveExtractedMemories(payload);
        break;
      case "updateMemorySummary":
        result = await handleUpdateMemorySummary(payload);
        break;
      // Skills system actions
      case "listSkills":
        result = handleListSkills();
        break;
      case "getSkill":
        result = handleGetSkill(payload);
        break;
      case "saveSkill":
        result = handleSaveSkill(payload);
        break;
      case "deleteSkill":
        result = handleDeleteSkill(payload);
        break;
      // MCP integration actions
      case "listMcpServers":
        result = await handleListMcpServers();
        break;
      case "getMcpStatus":
        result = await handleGetMcpStatus();
        break;
      case "installMcp":
        result = await handleInstallMcp(payload, id);
        break;
      // Workflow actions
      case "listWorkflows":
        result = handleListWorkflows();
        break;
      case "getWorkflow":
        result = handleGetWorkflow(payload);
        break;
      case "saveWorkflow":
        result = handleSaveWorkflow(payload);
        break;
      case "deleteWorkflow":
        result = handleDeleteWorkflow(payload);
        break;
      // Active workflow tracking
      case "listActiveWorkflows":
        result = handleListActiveWorkflows();
        break;
      case "activateWorkflow":
        result = handleActivateWorkflow(payload);
        break;
      case "updateWorkflowStatus":
        result = handleUpdateWorkflowStatus(payload);
        break;
      case "deactivateWorkflow":
        result = handleDeactivateWorkflow(payload);
        break;
      case "testWorkflowStep":
        result = handleTestWorkflowStep(payload);
        break;
      case "runMcpSetup":
        result = await handleRunMcpSetup(payload);
        break;
      case "listIntegrations":
        result = await handleListIntegrations();
        break;
      case "runIntegrationSetup":
        result = await handleRunIntegrationSetup(payload);
        break;
      case "runIntegrationAuth":
        result = await handleRunIntegrationAuth(payload);
        break;
      case "refreshProcess":
        result = handleRefreshProcess();
        break;
      // Form template actions
      case "listFormTemplates":
        result = handleListFormTemplates();
        break;
      case "getFormTemplate":
        result = handleGetFormTemplate(payload);
        break;
      case "saveFormTemplate":
        result = handleSaveFormTemplate(payload);
        break;
      case "deleteFormTemplate":
        result = handleDeleteFormTemplate(payload);
        break;
      // File tracking actions
      case "listFiles":
        result = handleListFiles(payload);
        break;
      case "saveFile":
        result = handleSaveFile(payload);
        break;
      case "getFile":
        result = handleGetFile(payload);
        break;
      case "deleteFile":
        result = handleDeleteFile(payload);
        break;
      case "openFile":
        result = handleOpenFile(payload);
        break;
      // Version and upgrade actions
      case "getVersion":
        result = handleGetVersion();
        break;
      case "checkForUpdates":
        result = handleCheckForUpdates();
        break;
      case "performUpgrade":
        result = await handlePerformUpgrade();
        break;
      default:
        result = { ok: false, error: `Unknown action: ${action}` };
    }
    sendResponse({ id, ...result });
  } catch (e) {
    sendResponse({ id, ok: false, error: e.message || String(e) });
  } finally {
    pendingOps--;
    maybeExit();
  }
}

// --- Generate UUID ---
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// --- Get environment with proper PATH ---
function getClaudeEnv() {
  const nodePaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    path.join(os.homedir(), ".npm-global/bin"),
    path.join(os.homedir(), ".nvm/versions/node/v18.0.0/bin"),
    path.join(os.homedir(), ".nvm/versions/node/v20.0.0/bin"),
    path.join(os.homedir(), ".local/bin"),
  ].join(":");
  const envPath = nodePaths + (process.env.PATH ? `:${process.env.PATH}` : "");
  return { ...process.env, HOME: os.homedir(), PATH: envPath };
}

// --- Persistent Claude Process Management ---
// Spawns a long-running Claude process that accepts stream-json input
// This keeps MCP servers alive for OAuth and provides faster responses

function ensurePersistentClaudeProcess(requiredScope = "standard") {
  // If process exists, check if current scope is sufficient
  if (persistentClaudeProc && !persistentClaudeProc.killed) {
    const order = { standard: 0, read: 1, full: 2 };
    if ((order[currentProcessTier] || 0) >= (order[requiredScope] || 0)) {
      return persistentClaudeProc; // Current scope is sufficient
    }
    // Need upgrade — kill and restart with higher scope
    const logFile = path.join(LILY_DIR, "debug.log");
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] Upgrading tool scope: ${currentProcessTier} → ${requiredScope}\n`);
    killPersistentClaudeProcess();
    clearClaudeSessionState();
  }

  const claudePath = findClaude();
  if (!claudePath) {
    throw new Error("Claude CLI not found. Please install it with: npm install -g @anthropic-ai/claude-code");
  }

  // Log startup attempt
  const logFile = path.join(LILY_DIR, "debug.log");
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] Starting persistent Claude process: ${claudePath} (scope: ${requiredScope})\n`);

  // Build args with tool restrictions based on scope
  const args = [
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
  ];

  // Apply tool restrictions based on scope
  const disallowed = getDisallowedTools(requiredScope);
  if (disallowed.length > 0) {
    args.push("--disallowedTools", disallowed.join(","));
  }

  // Behavioral reinforcement for standard scope
  if (requiredScope === "standard") {
    args.push("--append-system-prompt",
      "All project data has been provided in your context. " +
      "Do NOT attempt to read or explore files — use the context sections above. " +
      "If the user asks about the project, answer from context only."
    );
  }

  // Spawn persistent process with bidirectional stream-json
  persistentClaudeProc = spawn(claudePath, args, {
    cwd: LILY_DIR,
    env: getClaudeEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  currentProcessTier = requiredScope;

  fs.appendFileSync(logFile, `[${new Date().toISOString()}] Persistent process spawned, PID: ${persistentClaudeProc.pid}\n`);

  persistentClaudeBuffer = "";

  // Handle stdout (stream-json events from Claude)
  persistentClaudeProc.stdout.on("data", (chunk) => {
    persistentClaudeBuffer += chunk.toString();

    // Process complete JSON lines
    const lines = persistentClaudeBuffer.split("\n");
    persistentClaudeBuffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        handlePersistentClaudeEvent(event);
      } catch (e) {
        // Ignore parse errors for incomplete lines
      }
    }
  });

  // Handle stderr (errors/warnings)
  persistentClaudeProc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    // Forward stderr as a special event for debugging
    if (currentStreamRequestId && streamEventCallback) {
      streamEventCallback({
        id: currentStreamRequestId,
        type: "claude-stderr",
        text,
      });
    }
  });

  // Handle process exit
  persistentClaudeProc.on("close", (code, signal) => {
    const logFile = path.join(LILY_DIR, "debug.log");
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] Persistent process exited: code=${code}, signal=${signal}\n`);

    const wasRunning = persistentClaudeProc !== null;
    persistentClaudeProc = null;
    persistentClaudeSessionId = null;
    persistentClaudeBuffer = "";

    // If there's an active request, notify of unexpected exit with user-friendly message
    if (wasRunning && currentStreamRequestId && streamEventCallback) {
      let userMessage = "Claude connection lost. ";

      // Translate exit codes to user-friendly messages
      if (code === 143 || signal === "SIGTERM") {
        userMessage += "The process was stopped. This can happen after OAuth or when restarting. Try sending your message again.";
      } else if (code === 137 || signal === "SIGKILL") {
        userMessage += "The process was forcefully terminated. Try sending your message again.";
      } else if (code === 1) {
        userMessage += "Claude CLI encountered an error. Make sure you're logged in: run 'claude' in Terminal to check.";
      } else if (code === 127) {
        userMessage += "Claude CLI not found. Please install it: npm install -g @anthropic-ai/claude-code";
      } else {
        userMessage += `Process exited unexpectedly (code=${code}). Try sending your message again.`;
      }

      streamEventCallback({
        id: currentStreamRequestId,
        type: "claude-event",
        event: { type: "error", error: userMessage },
      });
      currentStreamRequestId = null;
      streamEventCallback = null;
    }
  });

  persistentClaudeProc.on("error", (err) => {
    if (currentStreamRequestId && streamEventCallback) {
      let userMessage = "Failed to start Claude. ";
      if (err.message.includes("ENOENT")) {
        userMessage += "Claude CLI not found. Please install it: npm install -g @anthropic-ai/claude-code";
      } else {
        userMessage += err.message;
      }
      streamEventCallback({
        id: currentStreamRequestId,
        type: "claude-event",
        event: { type: "error", error: userMessage },
      });
    }
    persistentClaudeProc = null;
  });

  return persistentClaudeProc;
}

// Handle events from the persistent Claude process
function handlePersistentClaudeEvent(event) {
  // Capture session ID from init message
  if (event.type === "system" && event.subtype === "init" && event.session_id) {
    persistentClaudeSessionId = event.session_id;
    // Update our tracked session ID
    claudeSessionId = event.session_id;
    claudeSessionCreatedAt = new Date().toISOString();
    claudeMdMtime = getClaudeMdMtime();
    saveClaudeSessionState();
  }

  // Forward event to the active request callback
  if (currentStreamRequestId && streamEventCallback) {
    streamEventCallback({
      id: currentStreamRequestId,
      type: "claude-event",
      event,
    });
  }
}

// Send a message to the persistent Claude process
function sendToPersistentClaude(text, requestId, onEvent, requiredScope = "standard") {
  const proc = ensurePersistentClaudeProcess(requiredScope);

  // Set up callback for this request
  currentStreamRequestId = requestId;
  streamEventCallback = onEvent;

  // Build the stream-json message
  const msg = {
    type: "user",
    message: {
      role: "user",
      content: text,
    },
  };

  // If we have a session ID, include it
  if (persistentClaudeSessionId) {
    msg.session_id = persistentClaudeSessionId;
  }

  // Send message to Claude's stdin
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

// Kill the persistent process (for cleanup or restart)
function killPersistentClaudeProcess() {
  if (persistentClaudeProc) {
    try {
      persistentClaudeProc.kill("SIGTERM");
    } catch {}
    persistentClaudeProc = null;
    persistentClaudeSessionId = null;
    currentStreamRequestId = null;
    streamEventCallback = null;
  }
}

// Handler to refresh the persistent Claude process
// Called after OAuth completion to pick up new tokens cached by MCP servers
function handleRefreshProcess() {
  // Kill existing persistent process
  killPersistentClaudeProcess();

  // Clear Claude session state so next message starts fresh with new MCP tokens
  clearClaudeSessionState();

  const logFile = path.join(LILY_DIR, "debug.log");
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] Process refreshed via refreshProcess action - MCP tokens will reload on next message\n`);

  return { ok: true, message: "Process refreshed. MCP tokens will reload on next message." };
}

// --- Claude CLI spawn with stream-json for status updates (legacy/fallback) ---
// Returns { result, sessionId } where sessionId is captured from the init message
function runClaude(prompt, options = {}) {
  const { resumeSessionId = null, onStatus = null, requestId = null, requiredScope = "standard" } = options;

  return new Promise((resolve, reject) => {
    const claudePath = findClaude();
    if (!claudePath) {
      return reject(new Error("Claude CLI not found. Please install it with: npm install -g @anthropic-ai/claude-code"));
    }

    // Build args
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];

    // Apply tool restrictions based on scope
    const disallowed = getDisallowedTools(requiredScope);
    if (disallowed.length > 0) {
      args.push("--disallowedTools", disallowed.join(","));
    }

    // Add --resume if we have a session to resume
    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    }

    let buffer = "";
    let finalResult = "";
    let capturedSessionId = null;
    let stderr = "";
    let wasCancelled = false;

    // Use ~/lily as cwd so CLAUDE.md is auto-discovered by Claude CLI
    const proc = spawn(claudePath, args, {
      cwd: LILY_DIR,
      timeout: TIMEOUT_MS,
      env: getClaudeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Track active process for cancellation
    activeClaudeProc = proc;
    activeClaudeRequestId = requestId;

    // Cleanup function
    const cleanup = () => {
      if (activeClaudeProc === proc) {
        activeClaudeProc = null;
        activeClaudeRequestId = null;
      }
    };

    // Handle cancellation
    proc.on("close", (code, signal) => {
      cleanup();
      if (wasCancelled || signal === "SIGTERM" || signal === "SIGKILL") {
        reject(new Error("CANCELLED"));
        return;
      }
      if (code === 0) {
        resolve({ result: finalResult, sessionId: capturedSessionId });
      } else {
        // Check for specific session errors
        const stderrLower = stderr.toLowerCase();
        if (stderrLower.includes("session") && (stderrLower.includes("not found") || stderrLower.includes("invalid") || stderrLower.includes("error"))) {
          reject(new Error(`SESSION_ERROR: ${stderr.trim()}`));
        } else {
          reject(new Error(`Claude exited ${code}: ${stderr.trim()}`));
        }
      }
    });

    // Mark as cancelled when killed
    proc.cancelRequest = () => {
      wasCancelled = true;
      try { proc.kill("SIGTERM"); } catch {}
    };

    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      // Process complete JSON lines
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          // Capture session ID from init message
          if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
            capturedSessionId = msg.session_id;
          }

          // Send status updates
          if (onStatus) {
            if (msg.type === "system" && msg.subtype === "init") {
              onStatus({ status: "initializing", tools: msg.tools?.length || 0 });
            } else if (msg.type === "assistant" && msg.message?.content) {
              // Extract text from content
              for (const block of msg.message.content) {
                if (block.type === "text" && block.text) {
                  onStatus({ status: "responding", text: block.text });
                } else if (block.type === "tool_use") {
                  onStatus({ status: "tool", tool: block.name });
                }
              }
            } else if (msg.type === "user" && msg.message?.content) {
              // Tool results
              for (const block of msg.message.content) {
                if (block.type === "tool_result") {
                  onStatus({ status: "tool_done", tool: block.tool_use_id });
                }
              }
            } else if (msg.type === "result") {
              finalResult = msg.result || "";
              onStatus({ status: "done" });
            }
          }

          // Capture final result
          if (msg.type === "result") {
            finalResult = msg.result || "";
          }
        } catch (e) {
          // Ignore JSON parse errors for incomplete lines
        }
      }
    });

    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("error", (err) => {
      cleanup();
      reject(err);
    });

    // Hard timeout safety net
    setTimeout(() => {
      if (activeClaudeProc === proc) {
        cleanup();
        try { proc.kill("SIGKILL"); } catch {}
        reject(new Error("Claude CLI timed out after 180s"));
      }
    }, TIMEOUT_MS + 1000);
  });
}

// Alias for backward compatibility
function runClaudeStreaming(prompt, sessionId, requestId, onChunk) {
  // Convert old chunk callback to new status callback
  const onStatus = (status) => {
    if (status.text) {
      onChunk(status.text);
    }
  };
  return runClaude(prompt, { resumeSessionId: sessionId, onStatus }).then(r => r.result);
}

// --- Chat History Management ---
function loadChatHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
  } catch {
    return [];
  }
}

// --- Parse daily logs to extract messages for a session ---
function getSessionMessagesFromLogs(sessionId, startDate) {
  const messages = [];
  const shortId = sessionId.slice(0, 8);

  // Get list of log files to search (from session start date to today)
  const start = new Date(startDate);
  const today = new Date();
  const logFiles = [];

  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const logFile = path.join(SESSIONS_DIR, `${dateStr}.md`);
    if (fs.existsSync(logFile)) {
      logFiles.push(logFile);
    }
  }

  // Parse each log file for messages with this session ID
  for (const logFile of logFiles) {
    try {
      const content = fs.readFileSync(logFile, "utf-8");
      // Split by session entries (## timestamp [session-id])
      const entries = content.split(/\n(?=## \d{4}-\d{2}-\d{2}T)/);

      for (const entry of entries) {
        // Check if this entry belongs to our session
        if (!entry.includes(`[${shortId}]`)) continue;

        // Extract user message
        const userMatch = entry.match(/\*\*User:\*\* ([\s\S]*?)(?=\n\n\*\*Lily:\*\*)/);
        // Extract assistant message
        const lilyMatch = entry.match(/\*\*Lily:\*\* ([\s\S]*?)(?=\n\n---|\n---)/);

        if (userMatch && userMatch[1]) {
          messages.push({ role: "user", text: userMatch[1].trim() });
        }
        if (lilyMatch && lilyMatch[1]) {
          messages.push({ role: "assistant", text: lilyMatch[1].trim() });
        }
      }
    } catch (e) {
      // Skip files that can't be read
    }
  }

  return messages;
}

function saveChatHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

function saveActiveSession() {
  if (!activeSessionId) return;

  const history = loadChatHistory();
  const existingIdx = history.findIndex(s => s.id === activeSessionId);

  const sessionData = {
    id: activeSessionId,
    title: activeSessionTitle || "Untitled Chat",
    started: activeSessionStarted,
    lastActive: new Date().toISOString(),
    claudeSessionId: claudeSessionId, // Store Claude's session ID for resume
    // Messages are stored in daily logs (~/lily/sessions/{date}.md), not here
  };

  if (existingIdx >= 0) {
    history[existingIdx] = sessionData;
  } else {
    history.unshift(sessionData); // Add to beginning (most recent first)
  }

  // Keep only last 50 sessions
  if (history.length > 50) {
    history.length = 50;
  }

  saveChatHistory(history);
}

// --- Build attachment section for prompts ---
function buildAttachmentSection(attachments) {
  if (!attachments || attachments.length === 0) return "";

  let section = "## Attached Files\n\n";
  for (const att of attachments) {
    section += `### ${att.name}\n\`\`\`\n${att.content}\n\`\`\`\n\n`;
  }
  section += "---\n\n";
  return section;
}

// --- Analyze message to determine context needs and tool scope ---
function analyzeContextNeeds(text) {
  const lower = (text || "").toLowerCase();
  const result = {
    needsSessionHistory: false,
    sessionHistoryDays: 0,
    toolScope: "standard", // "standard" | "read" | "full"
  };

  // Session history detection
  const sessionPatterns = [
    /\byesterday\b/, /\blast (time|session|conversation|chat)\b/,
    /\bearlier today\b/, /\bwe (talked|discussed|spoke) about\b/,
    /\byou (said|mentioned|told|suggested)\b/, /\bremember when\b/,
    /\bprevious(ly)?\b/, /\bwhat did (we|you|i)\b/,
    /\bfollow.?up on\b/, /\bcontinue (from|where)\b/,
  ];
  for (const p of sessionPatterns) {
    if (p.test(lower)) {
      result.needsSessionHistory = true;
      result.sessionHistoryDays = /yesterday/.test(lower) ? 1
        : /last week/.test(lower) ? 7 : 3;
      break;
    }
  }

  // Full access: write/edit/bash (check first — overrides read)
  const fullPatterns = [
    /\b(edit|modify|update|change|write|create|save|delete|remove) .{0,20}(file|document|script)/,
    /\b(run|execute) .{0,20}(command|script|bash|terminal)/,
    /\bsave (this|it|that) (to|as|in)\b/,
    /\bmake (a |the )?(new )?(file|document|script)\b/,
  ];
  for (const p of fullPatterns) {
    if (p.test(lower)) {
      result.toolScope = "full";
      return result;
    }
  }

  // Read-only: browse/check files
  const readPatterns = [
    /\b(look|check|read|open|show|find|search|explore|view) .{0,20}(file|folder|directory|document)/,
    /\bwhat.{0,10}in (my |the |~\/)/,
    /\b(list|show) (my |the )?(files|folders|documents)/,
    /~\//, /\/users\//, // Direct paths (lowercase since we match against lower)
  ];
  for (const p of readPatterns) {
    if (p.test(lower)) {
      result.toolScope = "read";
      break;
    }
  }

  return result;
}

// --- Get disallowed tools for a given scope ---
function getDisallowedTools(scope) {
  switch (scope) {
    case "standard": return ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
    case "read":     return ["Bash", "Write", "Edit"];
    case "full":     return [];
    default:         return ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
  }
}

// --- Build session history context for on-demand injection ---
function buildSessionHistoryContext(daysBack = 3) {
  let history = "";
  const today = new Date();
  for (let i = 0; i <= daysBack; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);
    const sessionFile = path.join(SESSIONS_DIR, `${dateStr}.md`);
    try {
      const content = fs.readFileSync(sessionFile, "utf-8");
      const trimmed = content.length > 3000
        ? "...\n" + content.slice(-3000) : content;
      history += `### ${dateStr}\n${trimmed}\n\n`;
    } catch {}
  }
  return history || null;
}

// --- Build context section with state and memory ---
function buildContextSection(memoryProjectId = null, analysis = null) {
  let context = "";

  // Step 1: Add current state if exists
  try {
    const currentState = fs.readFileSync(CURRENT_STATE_FILE, "utf-8");
    if (currentState && currentState.trim()) {
      context += `## Current State\n${currentState}\n\n---\n\n`;
    }
  } catch {}

  // Step 2: Always load general memory (legacy flat files)
  try {
    const factsContent = fs.readFileSync(FACTS_FILE, "utf-8");
    const factItems = factsContent.split("\n").filter(l => l.startsWith("- ")).slice(0, 20);
    if (factItems.length > 0) {
      context += `## General Memory\n${factItems.join("\n")}\n`;
    }
  } catch {}

  try {
    const peopleContent = fs.readFileSync(PEOPLE_FILE, "utf-8");
    const peopleItems = peopleContent.split("\n").filter(l => l.startsWith("- ")).slice(0, 15);
    if (peopleItems.length > 0) {
      context += `\n### People\n${peopleItems.join("\n")}\n`;
    }
  } catch {}

  context += "\n---\n\n";

  // Step 3: If project attached, add project-specific context
  if (memoryProjectId) {
    const projectDir = path.join(MEMORY_PROJECTS_DIR, memoryProjectId);
    if (projectDir.startsWith(MEMORY_PROJECTS_DIR) && fs.existsSync(projectDir)) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(projectDir, "meta.json"), "utf-8"));
        const projectName = meta.name || memoryProjectId;

        context += `## Active Project: "${projectName}"\n`;
        if (meta.description) {
          context += `${meta.description}\n`;
        }
        context += `\n**IMPORTANT**: The user has attached this memory project to the current conversation. When they ask about "this project", "the project", "the attached project", or what you know about it — they mean THIS memory project ("${projectName}"), NOT the ~/lily/ directory or codebase. Refer ONLY to the information in this section. Do NOT explore the filesystem to describe the project.\n\n`;

        // Project instructions (like Claude.ai custom instructions)
        if (meta.instructions && meta.instructions.trim()) {
          context += `### Project Instructions\n${meta.instructions}\n\n`;
        }

        // Load project memory — prefer narrative summary over raw items
        let hasMemorySummary = false;
        try {
          const memorySummary = fs.readFileSync(path.join(projectDir, "memory.md"), "utf-8");
          if (memorySummary && memorySummary.trim()) {
            context += `### Project Memory\n${memorySummary}\n\n`;
            hasMemorySummary = true;
          }
        } catch {}

        // Fallback: if no summary, use raw facts/people lists
        if (!hasMemorySummary) {
          const facts = JSON.parse(fs.readFileSync(path.join(projectDir, "facts.json"), "utf-8") || "[]");
          const people = JSON.parse(fs.readFileSync(path.join(projectDir, "people.json"), "utf-8") || "[]");
          if (facts.length > 0) {
            context += `### Project Facts\n${facts.map(f => `- ${f}`).join("\n")}\n\n`;
          }
          if (people.length > 0) {
            context += `### Project People\n${people.map(p => `- ${p}`).join("\n")}\n\n`;
          }
        }

        // Always include documents (separate from memory summary)
        const documents = JSON.parse(fs.readFileSync(path.join(projectDir, "documents.json"), "utf-8") || "[]");
        if (documents.length > 0) {
          context += `### Project Documents\n${documents.map(d => `- ${d}`).join("\n")}\n\n`;
        }

        if (!hasMemorySummary && documents.length === 0 && (!meta.instructions || !meta.instructions.trim())) {
          context += `*No project-specific data stored yet.*\n\n`;
        }

        context += "---\n\n";
      } catch (e) {
        // If project memory fails, continue without it
      }
    }
  }

  // Session history (on-demand — only when user references past conversations)
  if (analysis && analysis.needsSessionHistory) {
    const history = buildSessionHistoryContext(analysis.sessionHistoryDays);
    if (history) {
      context += `## Recent Session History\n${history}\n\n---\n\n`;
    }
  }

  return context;
}

// --- Check if user input matches any skill triggers ---
function matchSkillTrigger(text) {
  const textLower = text.toLowerCase();

  try {
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".md"));

    for (const file of files) {
      const content = fs.readFileSync(path.join(SKILLS_DIR, file), "utf-8");
      const { metadata, body } = parseSkillFrontmatter(content);

      if (!metadata.trigger) continue;

      const triggers = Array.isArray(metadata.trigger) ? metadata.trigger : [metadata.trigger];

      for (const trigger of triggers) {
        const triggerLower = trigger.toLowerCase();
        // Check slash command trigger (e.g., "/email")
        if (trigger.startsWith("/") && textLower.startsWith(triggerLower)) {
          return { skill: metadata.name || file, content: body, metadata };
        }
        // Check phrase trigger (e.g., "draft email")
        if (!trigger.startsWith("/") && textLower.includes(triggerLower)) {
          return { skill: metadata.name || file, content: body, metadata };
        }
      }
    }
  } catch {}

  return null;
}

// --- Action handlers ---

// NEW: Persistent process chat handler with rich event streaming
async function handleChatPersistent(payload, requestId = null) {
  const { text, stream = false, attachments = [], memoryProjectId = null } = payload || {};
  if (!text) return { ok: false, error: "Missing text" };

  // Analyze message to determine context needs and tool scope
  const analysis = analyzeContextNeeds(text);

  // Check if CLAUDE.md has changed - if so, restart the persistent process
  if (persistentClaudeProc && hasClaudeMdChanged()) {
    killPersistentClaudeProcess();
    clearClaudeSessionState();
  }

  // Check if attached project changed - if so, restart to rebuild context
  if (persistentClaudeSessionId && memoryProjectId !== lastMemoryProjectId) {
    killPersistentClaudeProcess();
    clearClaudeSessionState();
  }
  lastMemoryProjectId = memoryProjectId;

  // Start new Lily session if none active
  if (!activeSessionId) {
    activeSessionId = generateUUID();
    activeSessionStarted = new Date().toISOString();
    activeSessionTitle = null;
  }

  // Set title from first message
  if (!activeSessionTitle) {
    activeSessionTitle = text.length > 50 ? text.slice(0, 47) + "..." : text;
  }

  return new Promise((resolve, reject) => {
    // Build the full prompt
    let prompt = "";

    // For new sessions (no persistent process yet), include system context
    if (!persistentClaudeSessionId) {
      try {
        const systemContext = fs.readFileSync(CLAUDE_MD, "utf-8");
        if (systemContext) {
          prompt = systemContext + "\n\n---\n\n";
        }
      } catch {}

      // Add state and memory context (with analysis for conditional layers)
      prompt += buildContextSection(memoryProjectId, analysis);
    } else if (analysis.needsSessionHistory) {
      // Mid-session: inject session history if user references past conversations
      const history = buildSessionHistoryContext(analysis.sessionHistoryDays);
      if (history) {
        prompt += `## Recent Session History\n${history}\n\n---\n\n`;
      }
    }

    // Check for skill trigger and inject skill content
    const matchedSkill = matchSkillTrigger(text);
    if (matchedSkill) {
      prompt += `## Active Skill: ${matchedSkill.skill}\n${matchedSkill.content}\n\n---\n\n`;
    }

    // Add attachments if present
    prompt += buildAttachmentSection(attachments);

    // Add user message
    prompt += persistentClaudeSessionId ? text : `User: ${text}`;

    // Track accumulated result for final response
    let finalResult = "";
    let hasError = false;
    let errorMessage = "";

    // Event callback - forwards events and accumulates result
    const onEvent = (eventMsg) => {
      // Forward to extension
      sendResponse(eventMsg);

      // Process the event
      const event = eventMsg.event;
      if (!event) return;

      // Capture final text from assistant messages
      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            finalResult += block.text;
          }
        }
      }

      // Capture final result
      if (event.type === "result" && event.result) {
        finalResult = event.result;

        // Turn complete - resolve the promise
        saveActiveSession();

        // Log to daily session file
        const today = new Date().toISOString().slice(0, 10);
        const sessionFile = path.join(SESSIONS_DIR, `${today}.md`);
        const attachmentNote = attachments.length > 0
          ? `\n*Attachments: ${attachments.map(a => a.name).join(", ")}*\n`
          : "";
        const entry = `\n## ${new Date().toISOString()} [${activeSessionId.slice(0, 8)}]\n**User:** ${text}${attachmentNote}\n\n**Lily:** ${finalResult}\n\n---\n`;
        fs.appendFileSync(sessionFile, entry, "utf-8");

        currentStreamRequestId = null;
        streamEventCallback = null;

        resolve({
          ok: true,
          response: finalResult,
          sessionId: activeSessionId,
          claudeSessionId: persistentClaudeSessionId,
          type: "done",
        });
      }

      // Handle errors
      if (event.type === "error") {
        hasError = true;
        errorMessage = event.error || "Unknown error";
        currentStreamRequestId = null;
        streamEventCallback = null;
        resolve({ ok: false, error: errorMessage });
      }
    };

    try {
      // Send to persistent process (with tool scope from message analysis)
      sendToPersistentClaude(prompt, requestId, onEvent, analysis.toolScope);

      // Track active process for cancellation
      activeClaudeProc = persistentClaudeProc;
      activeClaudeRequestId = requestId;

      // Set timeout for the request
      setTimeout(() => {
        if (currentStreamRequestId === requestId) {
          currentStreamRequestId = null;
          streamEventCallback = null;
          resolve({ ok: false, error: "Request timed out" });
        }
      }, TIMEOUT_MS);
    } catch (e) {
      currentStreamRequestId = null;
      streamEventCallback = null;
      resolve({ ok: false, error: e.message });
    }
  });
}

// LEGACY: Per-message Claude spawn (fallback if persistent mode fails)
async function handleChat(payload, requestId = null) {
  const { text, stream = false, attachments = [], memoryProjectId = null, usePersistent = true } = payload || {};
  if (!text) return { ok: false, error: "Missing text" };

  // Try persistent mode first if enabled
  if (usePersistent) {
    try {
      return await handleChatPersistent(payload, requestId);
    } catch (e) {
      // Log to file for debugging
      const logFile = path.join(LILY_DIR, "debug.log");
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] Persistent mode failed: ${e.message}\n${e.stack}\n\n`);
      // Fall back to legacy mode if persistent fails
    }
  }

  // Check if CLAUDE.md has changed - if so, start fresh session
  if (claudeSessionId && hasClaudeMdChanged()) {
    clearClaudeSessionState();
  }

  // Start new Lily session if none active
  if (!activeSessionId) {
    activeSessionId = generateUUID();
    activeSessionStarted = new Date().toISOString();
    activeSessionTitle = null; // Will be set from first message
  }

  // Set title from first message
  if (!activeSessionTitle) {
    activeSessionTitle = text.length > 50 ? text.slice(0, 47) + "..." : text;
  }

  // Map tool names to friendly status messages
  const toolStatusMap = {
    WebSearch: "Searching the web",
    WebFetch: "Fetching webpage",
    Read: "Reading file",
    Write: "Writing file",
    Edit: "Editing file",
    Bash: "Running command",
    Glob: "Finding files",
    Grep: "Searching code",
    Task: "Running task",
    TodoWrite: "Updating todos",
  };

  // Status callback to send updates to extension
  const onStatus = requestId ? (status) => {
    if (status.status === "tool") {
      const friendlyName = toolStatusMap[status.tool] || `Using ${status.tool}`;
      sendResponse({ id: requestId, type: "status", status: "tool", tool: friendlyName });
    } else if (status.status === "responding" && status.text) {
      sendResponse({ id: requestId, type: "stream", chunk: status.text });
    } else if (status.status === "initializing") {
      sendResponse({ id: requestId, type: "status", status: "thinking" });
    }
  } : null;

  let response;
  let newSessionId;

  // Determine if we should resume or start fresh
  if (claudeSessionId) {
    // RESUME MODE: Use --resume with existing session
    // Prompt includes attachments (if any) + user message
    const attachmentSection = buildAttachmentSection(attachments);
    const resumePrompt = attachmentSection + text;
    try {
      const result = await runClaude(resumePrompt, { resumeSessionId: claudeSessionId, onStatus, requestId });
      response = result.result;
      // Session ID stays the same on resume
    } catch (e) {
      // Check if request was cancelled
      if (e.message === "CANCELLED") {
        return { ok: false, cancelled: true, error: "Request cancelled" };
      }
      // Check if this is a session error - if so, fallback to fresh start
      if (e.message && e.message.startsWith("SESSION_ERROR:")) {
        // Session invalid/expired - clear and retry as new
        clearClaudeSessionState();
        // Fall through to NEW MODE below
      } else {
        throw e;
      }
    }
  }

  // NEW MODE: Start fresh session (either first message or fallback from resume failure)
  if (!response) {
    // Build prompt with CLAUDE.md context for first message
    let prompt = "";
    try {
      const systemContext = fs.readFileSync(CLAUDE_MD, "utf-8");
      if (systemContext) {
        prompt = systemContext + "\n\n---\n\n";
      }
    } catch {}

    // Analyze message for context needs (legacy fallback uses same analysis)
    const legacyAnalysis = analyzeContextNeeds(text);

    // Add state and memory context (pass memoryProjectId for project-specific context)
    prompt += buildContextSection(memoryProjectId, legacyAnalysis);

    // Check for skill trigger and inject skill content
    const matchedSkill = matchSkillTrigger(text);
    if (matchedSkill) {
      prompt += `## Active Skill: ${matchedSkill.skill}\n${matchedSkill.content}\n\n---\n\n`;
    }

    // Add attachments if present
    prompt += buildAttachmentSection(attachments);
    prompt += `User: ${text}`;

    try {
      const result = await runClaude(prompt, { onStatus, requestId, requiredScope: legacyAnalysis.toolScope });
      response = result.result;
      newSessionId = result.sessionId;
    } catch (e) {
      // Check if request was cancelled
      if (e.message === "CANCELLED") {
        return { ok: false, cancelled: true, error: "Request cancelled" };
      }
      throw e;
    }

    // Save the new Claude session ID
    if (newSessionId) {
      claudeSessionId = newSessionId;
      claudeMdMtime = getClaudeMdMtime();
      claudeSessionCreatedAt = new Date().toISOString();
      saveClaudeSessionState();
    }
  }

  // Save Lily session to history (messages are in daily logs)
  saveActiveSession();

  // Log to daily session file
  const today = new Date().toISOString().slice(0, 10);
  const sessionFile = path.join(SESSIONS_DIR, `${today}.md`);
  const attachmentNote = attachments.length > 0
    ? `\n*Attachments: ${attachments.map(a => a.name).join(", ")}*\n`
    : "";
  const entry = `\n## ${new Date().toISOString()} [${activeSessionId.slice(0, 8)}]\n**User:** ${text}${attachmentNote}\n\n**Lily:** ${response}\n\n---\n`;
  fs.appendFileSync(sessionFile, entry, "utf-8");

  return { ok: true, response, sessionId: activeSessionId, claudeSessionId, type: "done" };
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

  // Get current state
  let currentState = "";
  try {
    currentState = fs.readFileSync(CURRENT_STATE_FILE, "utf-8");
  } catch {}

  // Get key facts
  let facts = "";
  try {
    const factsContent = fs.readFileSync(FACTS_FILE, "utf-8");
    const factItems = factsContent.split("\n").filter(l => l.startsWith("- ")).slice(0, 10);
    facts = factItems.join("\n");
  } catch {}

  const prompt = [
    "You are Lily, a personal AI assistant. Generate a morning briefing.",
    goals.length ? `Current goals:\n${goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}` : "No goals set.",
    currentState ? `Current state from last session:\n${currentState}` : "",
    facts ? `Key facts about the user:\n${facts}` : "",
    recentSession ? `Recent conversation excerpt:\n${recentSession}` : "No recent conversations.",
    `Today is ${today}. Provide a concise, actionable briefing that:
1. References any active priorities or open threads
2. Suggests focus areas for today
3. Mentions any pending items that need attention`,
  ].filter(Boolean).join("\n\n");

  // Briefing doesn't use session resume - it's a standalone query
  const result = await runClaude(prompt, {});
  return { ok: true, response: result.result };
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

async function handleLogin() {
  const claudePath = findClaude();
  if (!claudePath) {
    return { ok: false, error: "Claude CLI not found. Please run the installer first." };
  }

  // Open Terminal.app with claude command for authentication
  return new Promise((resolve) => {
    const script = `tell application "Terminal"
      activate
      do script "${claudePath}"
    end tell`;

    const proc = spawn("osascript", ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: "Terminal opened. Complete authentication there, then click 'Check Status'." });
      } else {
        resolve({ ok: false, error: "Failed to open Terminal" });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, error: `Failed to open Terminal: ${err.message}` });
    });
  });
}

function handleNewSession() {
  // End current session if any
  if (activeSessionId) {
    saveActiveSession();
  }

  // Kill persistent process so next message starts fresh with new context
  killPersistentClaudeProcess();

  // Clear Claude session state so next message starts fresh
  clearClaudeSessionState();

  // Start fresh Lily session
  activeSessionId = generateUUID();
  activeSessionStarted = new Date().toISOString();
  activeSessionTitle = null;

  return { ok: true, sessionId: activeSessionId };
}

async function handleEndSession() {
  if (activeSessionId) {
    saveActiveSession();
    const endedId = activeSessionId;
    const endedClaudeId = claudeSessionId;
    activeSessionId = null;
    activeSessionTitle = null;
    activeSessionStarted = null;

    // Update current state asynchronously (memory extraction is now handled by the UI)
    setImmediate(async () => {
      try {
        await handleUpdateCurrentState({});
      } catch (e) {
        console.error("Failed to update state:", e.message);
      }
    });

    // Note: We DON'T clear claudeSessionId here - user might want to resume
    // It will be cleared when they explicitly start a new session
    return { ok: true, endedSessionId: endedId, claudeSessionId: endedClaudeId };
  }
  return { ok: true, endedSessionId: null };
}

function handleStopChat() {
  const requestId = activeClaudeRequestId || currentStreamRequestId;

  // Stop persistent process stream if active
  if (currentStreamRequestId) {
    // Clear the callback so no more events are forwarded
    const stoppedRequestId = currentStreamRequestId;
    currentStreamRequestId = null;
    streamEventCallback = null;

    // Send a cancellation event
    sendResponse({
      id: stoppedRequestId,
      type: "claude-event",
      event: { type: "cancelled" },
    });

    return { ok: true, stopped: true, requestId: stoppedRequestId };
  }

  // Stop legacy process if active
  if (activeClaudeProc && activeClaudeProc.cancelRequest) {
    try {
      activeClaudeProc.cancelRequest();
    } catch (e) {
      // Process may have already exited
    }
    return { ok: true, stopped: true, requestId };
  }

  return { ok: true, stopped: false };
}

function handleGetHistory() {
  const history = loadChatHistory();
  return { ok: true, history };
}

function handleResumeSession(payload) {
  const { sessionId } = payload || {};
  if (!sessionId) return { ok: false, error: "Missing sessionId" };

  // End current session first
  if (activeSessionId && activeSessionId !== sessionId) {
    saveActiveSession();
  }

  // Find session in history
  const history = loadChatHistory();
  const session = history.find(s => s.id === sessionId);

  if (!session) {
    return { ok: false, error: "Session not found in history" };
  }

  // Resume Lily session
  activeSessionId = session.id;
  activeSessionTitle = session.title;
  activeSessionStarted = session.started;

  // Resume Claude session if available
  if (session.claudeSessionId) {
    claudeSessionId = session.claudeSessionId;
    claudeMdMtime = getClaudeMdMtime(); // Refresh mtime tracking
    claudeSessionCreatedAt = session.started;
    saveClaudeSessionState();
  } else {
    // No Claude session stored - will start fresh on next message
    clearClaudeSessionState();
  }

  // Parse daily logs to recover messages for UI display
  const messages = getSessionMessagesFromLogs(session.id, session.started);

  return {
    ok: true,
    session,
    hasClaudeSession: !!session.claudeSessionId,
    messages, // Messages parsed from daily logs
  };
}

function handleGetActiveSession() {
  if (activeSessionId) {
    return {
      ok: true,
      session: {
        id: activeSessionId,
        title: activeSessionTitle,
        started: activeSessionStarted,
        claudeSessionId: claudeSessionId,
        hasContext: !!claudeSessionId, // Indicates if Claude has conversation history
      }
    };
  }
  return { ok: true, session: null };
}

// --- Thought Dump Handlers ---

function saveDumpSession() {
  if (!activeDumpSession) return;

  // Save to active dump file for recovery
  fs.writeFileSync(ACTIVE_DUMP_FILE, JSON.stringify(activeDumpSession, null, 2), "utf-8");

  // Also save to dumps directory
  const dumpFile = path.join(DUMPS_DIR, `${activeDumpSession.id}.json`);
  fs.writeFileSync(dumpFile, JSON.stringify(activeDumpSession, null, 2), "utf-8");
}

function handleGetDumpSession() {
  // Check for auto-session (30+ min gap)
  if (activeDumpSession) {
    const lastActivity = new Date(activeDumpSession.lastActivityAt || activeDumpSession.startedAt);
    const now = new Date();
    if (now.getTime() - lastActivity.getTime() >= DUMP_AUTO_SESSION_GAP_MS) {
      // Session is stale, archive it
      activeDumpSession.status = "stale";
      saveDumpSession();
      activeDumpSession = null;
    }
  }

  return { ok: true, session: activeDumpSession };
}

function handleGetDumpHistory() {
  // Read all dump session files from DUMPS_DIR
  const sessions = [];
  try {
    const files = fs.readdirSync(DUMPS_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DUMPS_DIR, file), "utf-8"));
        if (data && data.id && data.analysis) {
          sessions.push(data);
        }
      } catch {}
    }
    // Sort by date descending
    sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  } catch {}
  return { ok: true, sessions };
}

function handleNewDumpSession() {
  // Archive current session if exists
  if (activeDumpSession && activeDumpSession.thoughts.length > 0) {
    saveDumpSession();
  }

  // Create new session
  activeDumpSession = {
    id: generateUUID(),
    thoughts: [],
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    status: "active",
    analysis: null,
  };

  saveDumpSession();
  return { ok: true, session: activeDumpSession };
}

function handleAddThought(payload) {
  const { text } = payload || {};
  if (!text || !text.trim()) {
    return { ok: false, error: "Missing thought text" };
  }

  // Create new session if none active or session is locked
  if (!activeDumpSession || activeDumpSession.status === "locked") {
    handleNewDumpSession();
  }

  const thought = {
    id: generateUUID(),
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };

  activeDumpSession.thoughts.push(thought);
  activeDumpSession.lastActivityAt = new Date().toISOString();
  saveDumpSession();

  return { ok: true, thought, session: activeDumpSession };
}

function handleDeleteThought(payload) {
  const { thoughtId } = payload || {};
  if (!thoughtId) {
    return { ok: false, error: "Missing thoughtId" };
  }

  if (!activeDumpSession || activeDumpSession.status === "locked") {
    return { ok: false, error: "No active dump session or session is locked" };
  }

  const idx = activeDumpSession.thoughts.findIndex(t => t.id === thoughtId);
  if (idx === -1) {
    return { ok: false, error: "Thought not found" };
  }

  activeDumpSession.thoughts.splice(idx, 1);
  activeDumpSession.lastActivityAt = new Date().toISOString();
  saveDumpSession();

  return { ok: true, session: activeDumpSession };
}

async function handleAnalyzePartial(requestId) {
  if (!activeDumpSession || activeDumpSession.thoughts.length === 0) {
    return { ok: false, error: "No thoughts to analyze" };
  }

  const thoughts = activeDumpSession.thoughts.map(t => t.text);
  const prompt = `You are Lily, a personal AI assistant. The user has been dumping thoughts freely. Analyze these thoughts and provide helpful insights.

## Thoughts to analyze (${thoughts.length} total):
${thoughts.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## Your analysis should include:
1. **Themes Detected** - Group related thoughts into categories
2. **Suggested Priorities** - Which items seem most urgent or important, with reasoning
3. **Quick Wins** - Easy actions the user could take right now
4. **Potential Goals** - Larger goals that might be worth tracking

Keep your response concise and actionable. The user may continue adding more thoughts after this partial analysis.`;

  // Analysis doesn't use session resume - standalone query
  const result = await runClaude(prompt, {});

  // Store partial analysis
  activeDumpSession.analysis = {
    themes: [],
    priorities: [],
    quickWins: [],
    suggestedGoals: [],
    summary: result.result,
    analyzedAt: new Date().toISOString(),
    isPartial: true,
    thoughtCount: thoughts.length,
  };
  activeDumpSession.lastActivityAt = new Date().toISOString();
  saveDumpSession();

  return { ok: true, analysis: activeDumpSession.analysis, session: activeDumpSession };
}

async function handleAnalyzeFull(requestId) {
  if (!activeDumpSession || activeDumpSession.thoughts.length === 0) {
    return { ok: false, error: "No thoughts to analyze" };
  }

  const thoughts = activeDumpSession.thoughts.map(t => t.text);
  const prompt = `You are Lily, a personal AI assistant. The user has finished dumping thoughts and wants a comprehensive analysis.

## Thoughts to analyze (${thoughts.length} total):
${thoughts.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## Your comprehensive analysis should include:
1. **Summary** - Brief overview of what the user was thinking about
2. **Themes Detected** - Group related thoughts into clear categories
3. **Priority Matrix** - Organize by urgency and importance with reasoning
4. **Quick Wins** - Easy actions to take immediately
5. **Goals to Track** - Specific, actionable goals to add to the goals list
6. **Reminders** - Any time-sensitive items that need scheduling
7. **Insights** - Any patterns, connections, or observations worth noting

This is the final analysis for this session. Be thorough and provide maximum value.`;

  // Analysis doesn't use session resume - standalone query
  const result = await runClaude(prompt, {});

  // Store full analysis and lock session
  activeDumpSession.analysis = {
    themes: [],
    priorities: [],
    quickWins: [],
    suggestedGoals: [],
    summary: result.result,
    analyzedAt: new Date().toISOString(),
    isPartial: false,
    thoughtCount: thoughts.length,
  };
  activeDumpSession.status = "locked";
  activeDumpSession.lastActivityAt = new Date().toISOString();
  saveDumpSession();

  const completedSession = { ...activeDumpSession };

  // Clear active session (user needs to start new one)
  try { fs.unlinkSync(ACTIVE_DUMP_FILE); } catch {}
  activeDumpSession = null;

  return { ok: true, analysis: completedSession.analysis, session: completedSession };
}

// --- Onboarding Handlers ---

function handleSaveClaudeMd(payload) {
  const { content } = payload || {};
  if (!content) return { ok: false, error: "Missing content" };

  try {
    fs.writeFileSync(CLAUDE_MD, content, "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to save CLAUDE.md: ${e.message}` };
  }
}

function handleHasOnboarded() {
  try {
    const content = fs.readFileSync(CLAUDE_MD, "utf-8");
    // Check if it's personalized (contains user's name section from onboarding)
    const onboarded = content.includes("Personal Assistant for");
    return { ok: true, onboarded };
  } catch {
    // File doesn't exist = not onboarded
    return { ok: true, onboarded: false };
  }
}

// --- State Tracking Handlers ---

function handleGetCurrentState() {
  try {
    const content = fs.readFileSync(CURRENT_STATE_FILE, "utf-8");
    return { ok: true, content };
  } catch {
    // File doesn't exist - return empty state
    return { ok: true, content: null };
  }
}

async function handleUpdateCurrentState(payload) {
  const { content } = payload || {};

  // If content is provided directly, just save it
  if (content) {
    try {
      fs.writeFileSync(CURRENT_STATE_FILE, content, "utf-8");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Failed to save state: ${e.message}` };
    }
  }

  // Otherwise, use Claude to extract state from recent conversation
  // This is called at session end
  const today = new Date().toISOString().slice(0, 10);
  let recentConversation = "";
  try {
    recentConversation = fs.readFileSync(path.join(SESSIONS_DIR, `${today}.md`), "utf-8").slice(-8000);
  } catch {}

  if (!recentConversation) {
    return { ok: true, message: "No recent conversation to extract state from" };
  }

  // Get existing state to preserve ongoing items
  let existingState = "";
  try {
    existingState = fs.readFileSync(CURRENT_STATE_FILE, "utf-8");
  } catch {}

  const prompt = `You are Lily, a personal AI assistant. Analyze the recent conversation and update the user's current state.

${existingState ? `## Existing State\n${existingState}\n` : ""}
## Recent Conversation
${recentConversation}

## Task
Update the current state file in this exact format:

\`\`\`markdown
# Current State
Last updated: ${new Date().toISOString()}

## Active Priorities
[List 3-5 most important items the user is working on, numbered]

## Open Threads
[Checkbox list of things waiting on others or pending]
- [ ] Example pending item

## Recent Context
[Brief notes about what was discussed that might be relevant in future sessions]
\`\`\`

Keep it concise and actionable. Focus on what's most useful for the next session.`;

  try {
    const result = await runClaude(prompt, {});

    // Extract the markdown content from Claude's response
    let stateContent = result.result;

    // If Claude wrapped it in a code block, extract it
    const codeBlockMatch = stateContent.match(/```markdown\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      stateContent = codeBlockMatch[1];
    }

    fs.writeFileSync(CURRENT_STATE_FILE, stateContent, "utf-8");
    return { ok: true, content: stateContent };
  } catch (e) {
    return { ok: false, error: `Failed to extract state: ${e.message}` };
  }
}

// --- Memory System Handlers ---

function initializeMemoryFiles() {
  const defaultFacts = `# Facts & Preferences
Last updated: ${new Date().toISOString()}

## User Preferences
<!-- Lily will add learned preferences here -->

## Learned Facts
<!-- Lily will add facts learned from conversations here -->
`;

  const defaultPeople = `# People
Last updated: ${new Date().toISOString()}

## Contacts
<!-- Lily will add people mentioned in conversations here -->
`;

  const defaultProjects = `# Projects
Last updated: ${new Date().toISOString()}

## Active Projects
<!-- Lily will add project-specific knowledge here -->
`;

  if (!fs.existsSync(FACTS_FILE)) {
    fs.writeFileSync(FACTS_FILE, defaultFacts, "utf-8");
  }
  if (!fs.existsSync(PEOPLE_FILE)) {
    fs.writeFileSync(PEOPLE_FILE, defaultPeople, "utf-8");
  }
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, defaultProjects, "utf-8");
  }
}

// Initialize memory files on startup
initializeMemoryFiles();

function handleGetMemory(payload) {
  const { type } = payload || {}; // "facts", "people", "projects", or null for all

  const readFile = (filepath) => {
    try {
      return fs.readFileSync(filepath, "utf-8");
    } catch {
      return null;
    }
  };

  if (type === "facts") {
    return { ok: true, content: readFile(FACTS_FILE) };
  } else if (type === "people") {
    return { ok: true, content: readFile(PEOPLE_FILE) };
  } else if (type === "projects") {
    return { ok: true, content: readFile(PROJECTS_FILE) };
  } else {
    // Return all memory
    return {
      ok: true,
      facts: readFile(FACTS_FILE),
      people: readFile(PEOPLE_FILE),
      projects: readFile(PROJECTS_FILE),
    };
  }
}

function handleAddMemory(payload) {
  const { type, fact, category } = payload || {};
  if (!type || !fact) {
    return { ok: false, error: "Missing type or fact" };
  }

  const fileMap = {
    facts: FACTS_FILE,
    people: PEOPLE_FILE,
    projects: PROJECTS_FILE,
  };

  const filepath = fileMap[type];
  if (!filepath) {
    return { ok: false, error: `Invalid memory type: ${type}` };
  }

  try {
    let content = fs.readFileSync(filepath, "utf-8");
    const timestamp = new Date().toISOString().slice(0, 10);
    const newEntry = `- ${fact} (added ${timestamp})`;

    // Find the right section to add to, or add at the end
    if (category) {
      // Try to find the category section
      const sectionMatch = content.match(new RegExp(`## ${category}[\\s\\S]*?(?=\\n## |$)`));
      if (sectionMatch) {
        const sectionEnd = content.indexOf(sectionMatch[0]) + sectionMatch[0].length;
        content = content.slice(0, sectionEnd) + "\n" + newEntry + content.slice(sectionEnd);
      } else {
        // Add new section
        content += `\n## ${category}\n${newEntry}\n`;
      }
    } else {
      // Add to the first section after the header
      const firstSection = content.indexOf("\n## ");
      if (firstSection >= 0) {
        const nextSection = content.indexOf("\n## ", firstSection + 1);
        const insertPoint = nextSection >= 0 ? nextSection : content.length;
        content = content.slice(0, insertPoint) + "\n" + newEntry + content.slice(insertPoint);
      } else {
        content += "\n" + newEntry;
      }
    }

    // Update timestamp
    content = content.replace(/Last updated: .*/, `Last updated: ${new Date().toISOString()}`);

    fs.writeFileSync(filepath, content, "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to add memory: ${e.message}` };
  }
}

function handleRemoveMemory(payload) {
  const { type, searchText } = payload || {};
  if (!type || !searchText) {
    return { ok: false, error: "Missing type or searchText" };
  }

  const fileMap = {
    facts: FACTS_FILE,
    people: PEOPLE_FILE,
    projects: PROJECTS_FILE,
  };

  const filepath = fileMap[type];
  if (!filepath) {
    return { ok: false, error: `Invalid memory type: ${type}` };
  }

  try {
    let content = fs.readFileSync(filepath, "utf-8");
    const lines = content.split("\n");
    const filteredLines = lines.filter(line => !line.toLowerCase().includes(searchText.toLowerCase()));

    if (lines.length === filteredLines.length) {
      return { ok: false, error: "No matching memory found" };
    }

    content = filteredLines.join("\n");
    content = content.replace(/Last updated: .*/, `Last updated: ${new Date().toISOString()}`);

    fs.writeFileSync(filepath, content, "utf-8");
    return { ok: true, removed: lines.length - filteredLines.length };
  } catch (e) {
    return { ok: false, error: `Failed to remove memory: ${e.message}` };
  }
}

function handleSearchMemory(payload) {
  const { query } = payload || {};
  if (!query) {
    return { ok: false, error: "Missing query" };
  }

  const results = [];
  const queryLower = query.toLowerCase();

  const searchFile = (filepath, type) => {
    try {
      const content = fs.readFileSync(filepath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.startsWith("- ") && line.toLowerCase().includes(queryLower)) {
          results.push({ type, content: line.slice(2) });
        }
      }
    } catch {}
  };

  searchFile(FACTS_FILE, "facts");
  searchFile(PEOPLE_FILE, "people");
  searchFile(PROJECTS_FILE, "projects");

  return { ok: true, results };
}

async function handleExtractMemory(requestId) {
  // Get recent conversation
  const today = new Date().toISOString().slice(0, 10);
  let recentConversation = "";
  try {
    recentConversation = fs.readFileSync(path.join(SESSIONS_DIR, `${today}.md`), "utf-8").slice(-8000);
  } catch {}

  if (!recentConversation) {
    return { ok: true, extracted: [], message: "No recent conversation to extract from" };
  }

  // Get existing memories for context
  const existingFacts = fs.existsSync(FACTS_FILE) ? fs.readFileSync(FACTS_FILE, "utf-8") : "";
  const existingPeople = fs.existsSync(PEOPLE_FILE) ? fs.readFileSync(PEOPLE_FILE, "utf-8") : "";

  const prompt = `You are Lily, a personal AI assistant. Extract useful facts from the conversation to remember.

## Recent Conversation
${recentConversation}

## Already Known
${existingFacts.slice(0, 2000)}
${existingPeople.slice(0, 1000)}

## Task
Extract NEW facts worth remembering. Output JSON array:
\`\`\`json
[
  {"type": "facts", "category": "User Preferences", "fact": "Prefers morning meetings"},
  {"type": "people", "category": "Contacts", "fact": "John from accounting - handles expense reports"},
  {"type": "projects", "category": "Active Projects", "fact": "Working on Lily extension - Chrome side panel AI assistant"}
]
\`\`\`

Rules:
- Only extract genuinely useful, long-term facts
- Skip temporary information (today's tasks, etc.)
- Don't duplicate existing memories
- Be concise
- If nothing worth remembering, return empty array: []`;

  try {
    const result = await runClaude(prompt, {});

    // Parse the JSON response
    const jsonMatch = result.result.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      return { ok: true, extracted: [], message: "No facts extracted" };
    }

    const extracted = JSON.parse(jsonMatch[1]);

    // Add each extracted fact
    for (const item of extracted) {
      handleAddMemory(item);
    }

    return { ok: true, extracted };
  } catch (e) {
    return { ok: false, error: `Failed to extract memories: ${e.message}` };
  }
}

// --- Memory Consolidation Handlers ---

async function handleExtractMemoriesPreview(payload) {
  const { conversationText, projectId } = payload || {};

  if (!conversationText || !conversationText.trim()) {
    return { ok: true, items: [], summary: null };
  }

  // Load existing memories to avoid duplicates
  let existingFacts = "";
  let existingPeople = "";

  if (projectId) {
    // Load from project
    const projectDir = path.join(MEMORY_PROJECTS_DIR, projectId);
    if (projectDir.startsWith(MEMORY_PROJECTS_DIR) && fs.existsSync(projectDir)) {
      try {
        const facts = JSON.parse(fs.readFileSync(path.join(projectDir, "facts.json"), "utf-8") || "[]");
        const people = JSON.parse(fs.readFileSync(path.join(projectDir, "people.json"), "utf-8") || "[]");
        existingFacts = facts.map(f => `- ${f}`).join("\n");
        existingPeople = people.map(p => `- ${p}`).join("\n");
      } catch {}
    }
  } else {
    // Load from legacy files
    try { existingFacts = fs.readFileSync(FACTS_FILE, "utf-8").slice(0, 2000); } catch {}
    try { existingPeople = fs.readFileSync(PEOPLE_FILE, "utf-8").slice(0, 1000); } catch {}
  }

  const prompt = `You are Lily, a personal AI assistant. Extract useful facts and people from the conversation to remember long-term.

## Recent Conversation
${conversationText.slice(-8000)}

## Already Known (do NOT duplicate these)
${existingFacts ? `### Existing Facts\n${existingFacts}\n` : ""}
${existingPeople ? `### Existing People\n${existingPeople}\n` : ""}

## Task
Extract NEW facts and people worth remembering. Output JSON:
\`\`\`json
{
  "items": [
    {"type": "facts", "content": "Prefers morning meetings"},
    {"type": "people", "content": "John from accounting - handles expense reports"}
  ],
  "summary": "Brief 1-2 sentence summary of conversation"
}
\`\`\`

Rules:
- Only extract genuinely useful, long-term facts
- Skip temporary information (today's tasks, one-off requests, etc.)
- Don't duplicate existing memories listed above
- Be concise - each item should be a single clear statement
- "type" must be either "facts" or "people"
- ALWAYS provide a summary of the conversation, even if no items are extracted
- If nothing worth remembering, return: {"items": [], "summary": "Brief summary of what was discussed"}`;

  try {
    const result = await runClaude(prompt, {});

    // Parse the JSON response
    const jsonMatch = result.result.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      // No JSON found — generate a basic summary from conversation
      const firstLine = (conversationText || "").split("\n").find(l => l.startsWith("User:"));
      const fallbackSummary = firstLine
        ? `Conversation about: ${firstLine.replace("User: ", "").slice(0, 100)}`
        : "General conversation.";
      return { ok: true, items: [], summary: fallbackSummary };
    }

    const parsed = JSON.parse(jsonMatch[1]);
    return {
      ok: true,
      items: (parsed.items || []).filter(i => i.type && i.content),
      summary: parsed.summary || "General conversation.",
    };
  } catch (e) {
    return { ok: true, items: [], summary: "Session ended." };
  }
}

function handleSaveExtractedMemories(payload) {
  const { items, projectId, dateTag } = payload || {};

  if (!items || items.length === 0) {
    return { ok: true, saved: 0 };
  }

  const tag = dateTag || new Date().toISOString().slice(0, 10);
  let saved = 0;

  for (const item of items) {
    if (!item.type || !item.content) continue;

    const taggedContent = `[${tag}] ${item.content}`;

    if (projectId) {
      // Save to project memory
      const result = handleUpdateProjectMemory({
        projectId,
        type: item.type,
        action: "add",
        item: taggedContent,
      });
      if (result.ok) saved++;
    } else {
      // Save to legacy flat files
      const result = handleAddMemory({
        type: item.type,
        fact: taggedContent,
      });
      if (result.ok) saved++;
    }
  }

  return { ok: true, saved };
}

async function handleUpdateMemorySummary(payload) {
  const { projectId, newItems = [] } = payload || {};
  if (!projectId) return { ok: false, error: "Missing projectId" };

  // Validate projectId
  if (projectId.includes("/") || projectId.includes("..")) {
    return { ok: false, error: "Invalid projectId" };
  }

  const projectDir = path.join(MEMORY_PROJECTS_DIR, projectId);
  if (!projectDir.startsWith(MEMORY_PROJECTS_DIR) || !fs.existsSync(projectDir)) {
    return { ok: false, error: "Project not found" };
  }

  // Read existing data
  let existingSummary = "";
  try { existingSummary = fs.readFileSync(path.join(projectDir, "memory.md"), "utf-8"); } catch {}

  let allFacts = [];
  let allPeople = [];
  try { allFacts = JSON.parse(fs.readFileSync(path.join(projectDir, "facts.json"), "utf-8")); } catch {}
  try { allPeople = JSON.parse(fs.readFileSync(path.join(projectDir, "people.json"), "utf-8")); } catch {}

  let projectName = projectId;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(projectDir, "meta.json"), "utf-8"));
    projectName = meta.name || projectId;
  } catch {}

  const prompt = `You are updating the memory summary for the project "${projectName}". This summary captures everything important learned across all conversations.

## Existing Memory Summary
${existingSummary || "(empty — this is the first summary)"}

## All Known Facts
${allFacts.length > 0 ? allFacts.map(f => `- ${f}`).join("\n") : "(none)"}

## All Known People
${allPeople.length > 0 ? allPeople.map(p => `- ${p}`).join("\n") : "(none)"}

## Newly Added Items
${newItems.length > 0 ? newItems.map(i => `- [${i.type}] ${i.content}`).join("\n") : "(none)"}

## Task
Write an updated memory summary that:
1. Integrates new items naturally into the existing summary
2. Uses concise narrative format (short paragraphs, not bullet points)
3. Organizes by topic/theme rather than chronologically
4. Removes redundant or outdated information when superseded by newer info
5. Stays under 500 words
6. Includes key people and their roles/relationships when relevant

Output ONLY the updated summary text, nothing else.`;

  try {
    const result = await runClaude(prompt, {});
    const summary = result.result.trim();

    // Save the updated summary
    fs.writeFileSync(path.join(projectDir, "memory.md"), summary, "utf-8");

    // Update timestamp
    const metaPath = path.join(projectDir, "meta.json");
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      meta.updatedAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    } catch {}

    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: `Failed to update memory summary: ${e.message}` };
  }
}

// --- Skills System Handlers ---

function parseSkillFrontmatter(content) {
  // Parse YAML frontmatter from skill file
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { metadata: {}, body: content };
  }

  const yaml = frontmatterMatch[1];
  const body = content.slice(frontmatterMatch[0].length).trim();

  // Simple YAML parser for our needs
  const metadata = {};
  const lines = yaml.split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();

      // Handle arrays (comma-separated for triggers)
      if (value.includes(",") && key === "trigger") {
        value = value.split(",").map(v => v.trim().replace(/^["']|["']$/g, ""));
      } else {
        value = value.replace(/^["']|["']$/g, "");
      }

      metadata[key] = value;
    }
  }

  return { metadata, body };
}

function handleListSkills() {
  try {
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".md"));
    const skills = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(SKILLS_DIR, file), "utf-8");
      const { metadata } = parseSkillFrontmatter(content);
      skills.push({
        filename: file,
        name: metadata.name || file.replace(".md", ""),
        description: metadata.description || "",
        trigger: metadata.trigger || [],
        requires_mcp: metadata.requires_mcp || null,
      });
    }

    return { ok: true, skills };
  } catch (e) {
    return { ok: false, error: `Failed to list skills: ${e.message}` };
  }
}

function handleGetSkill(payload) {
  const { filename } = payload || {};
  if (!filename) {
    return { ok: false, error: "Missing filename" };
  }

  // Validate filename (prevent path traversal)
  if (filename.includes("/") || filename.includes("..")) {
    return { ok: false, error: "Invalid filename" };
  }

  try {
    const filepath = path.join(SKILLS_DIR, filename);
    if (!filepath.startsWith(SKILLS_DIR)) {
      return { ok: false, error: "Path traversal blocked" };
    }

    const content = fs.readFileSync(filepath, "utf-8");
    const { metadata, body } = parseSkillFrontmatter(content);

    return { ok: true, content, metadata, body };
  } catch (e) {
    return { ok: false, error: `Failed to read skill: ${e.message}` };
  }
}

function handleSaveSkill(payload) {
  const { filename, content } = payload || {};
  if (!filename || !content) {
    return { ok: false, error: "Missing filename or content" };
  }

  // Validate filename
  if (filename.includes("/") || filename.includes("..")) {
    return { ok: false, error: "Invalid filename" };
  }

  // Ensure .md extension
  const finalFilename = filename.endsWith(".md") ? filename : filename + ".md";

  try {
    const filepath = path.join(SKILLS_DIR, finalFilename);
    if (!filepath.startsWith(SKILLS_DIR)) {
      return { ok: false, error: "Path traversal blocked" };
    }

    fs.writeFileSync(filepath, content, "utf-8");
    return { ok: true, filename: finalFilename };
  } catch (e) {
    return { ok: false, error: `Failed to save skill: ${e.message}` };
  }
}

function handleDeleteSkill(payload) {
  const { filename } = payload || {};
  if (!filename) {
    return { ok: false, error: "Missing filename" };
  }

  // Validate filename
  if (filename.includes("/") || filename.includes("..")) {
    return { ok: false, error: "Invalid filename" };
  }

  try {
    const filepath = path.join(SKILLS_DIR, filename);
    if (!filepath.startsWith(SKILLS_DIR)) {
      return { ok: false, error: "Path traversal blocked" };
    }

    fs.unlinkSync(filepath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to delete skill: ${e.message}` };
  }
}

// --- Form Template Handlers ---

// Helper to generate ID from name
function generateTemplateId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Get index of templates
function getTemplatesIndex() {
  const indexPath = path.join(FORMS_DIR, "index.json");
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } catch {
    return { templates: [] };
  }
}

// Save index of templates
function saveTemplatesIndex(index) {
  const indexPath = path.join(FORMS_DIR, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

function handleListFormTemplates() {
  try {
    const index = getTemplatesIndex();
    const templates = [];

    for (const entry of index.templates) {
      try {
        const templatePath = path.join(FORMS_DIR, `${entry.id}.json`);
        const template = JSON.parse(fs.readFileSync(templatePath, "utf-8"));
        templates.push({
          id: template.id,
          name: template.name,
          description: template.description || "",
          isDefault: template.isDefault || false,
          fieldCount: template.fields?.length || 0,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
        });
      } catch {
        // Skip templates that can't be read
      }
    }

    return { ok: true, templates };
  } catch (e) {
    return { ok: false, error: `Failed to list templates: ${e.message}` };
  }
}

function handleGetFormTemplate(payload) {
  const { templateId } = payload || {};
  if (!templateId) {
    return { ok: false, error: "Missing templateId" };
  }

  // Validate templateId
  if (templateId.includes("/") || templateId.includes("..")) {
    return { ok: false, error: "Invalid templateId" };
  }

  try {
    const templatePath = path.join(FORMS_DIR, `${templateId}.json`);
    if (!templatePath.startsWith(FORMS_DIR)) {
      return { ok: false, error: "Path traversal blocked" };
    }

    const template = JSON.parse(fs.readFileSync(templatePath, "utf-8"));
    return { ok: true, template };
  } catch (e) {
    return { ok: false, error: `Failed to get template: ${e.message}` };
  }
}

function handleSaveFormTemplate(payload) {
  const { template } = payload || {};
  if (!template || !template.name) {
    return { ok: false, error: "Missing template or template.name" };
  }

  try {
    const now = new Date().toISOString();
    const index = getTemplatesIndex();

    // Generate ID if new template
    if (!template.id) {
      template.id = generateTemplateId(template.name);
      template.createdAt = now;
    }

    template.updatedAt = now;

    // Ensure fields array exists
    if (!template.fields) {
      template.fields = [];
    }

    // If this template is set as default, unset others
    if (template.isDefault) {
      for (const entry of index.templates) {
        if (entry.id !== template.id) {
          try {
            const otherPath = path.join(FORMS_DIR, `${entry.id}.json`);
            const other = JSON.parse(fs.readFileSync(otherPath, "utf-8"));
            if (other.isDefault) {
              other.isDefault = false;
              fs.writeFileSync(otherPath, JSON.stringify(other, null, 2), "utf-8");
            }
          } catch {}
        }
      }
    }

    // Save template file
    const templatePath = path.join(FORMS_DIR, `${template.id}.json`);
    fs.writeFileSync(templatePath, JSON.stringify(template, null, 2), "utf-8");

    // Update index
    const existingIndex = index.templates.findIndex(t => t.id === template.id);
    if (existingIndex >= 0) {
      index.templates[existingIndex] = { id: template.id };
    } else {
      index.templates.push({ id: template.id });
    }
    saveTemplatesIndex(index);

    return { ok: true, template };
  } catch (e) {
    return { ok: false, error: `Failed to save template: ${e.message}` };
  }
}

function handleDeleteFormTemplate(payload) {
  const { templateId } = payload || {};
  if (!templateId) {
    return { ok: false, error: "Missing templateId" };
  }

  // Validate templateId
  if (templateId.includes("/") || templateId.includes("..")) {
    return { ok: false, error: "Invalid templateId" };
  }

  try {
    const templatePath = path.join(FORMS_DIR, `${templateId}.json`);
    if (!templatePath.startsWith(FORMS_DIR)) {
      return { ok: false, error: "Path traversal blocked" };
    }

    // Delete file
    fs.unlinkSync(templatePath);

    // Update index
    const index = getTemplatesIndex();
    index.templates = index.templates.filter(t => t.id !== templateId);
    saveTemplatesIndex(index);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to delete template: ${e.message}` };
  }
}

// --- File Tracking Handlers ---

// Get files index
function getFilesIndex() {
  try {
    return JSON.parse(fs.readFileSync(FILES_INDEX_FILE, "utf-8"));
  } catch {
    return { files: [] };
  }
}

// Save files index
function saveFilesIndex(index) {
  fs.writeFileSync(FILES_INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

// Generate unique file ID
function generateFileId() {
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function handleListFiles(payload) {
  const { type, limit, offset } = payload || {};
  try {
    const index = getFilesIndex();
    let files = index.files || [];

    // Filter by type if specified
    if (type) {
      files = files.filter(f => f.type === type);
    }

    // Sort by createdAt descending (newest first)
    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply pagination
    const start = offset || 0;
    const end = limit ? start + limit : files.length;
    files = files.slice(start, end);

    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: `Failed to list files: ${e.message}` };
  }
}

function handleSaveFile(payload) {
  const { name, content, type, mimeType, sourceUrl, sessionId, originalPath } = payload || {};
  if (!name || !type) {
    return { ok: false, error: "Missing name or type" };
  }

  try {
    const id = generateFileId();
    const now = new Date().toISOString();

    // Determine storage subdirectory based on type
    let subdir;
    switch (type) {
      case "upload":
        subdir = FILES_UPLOADS_DIR;
        break;
      case "created":
        subdir = FILES_CREATED_DIR;
        break;
      case "download":
        subdir = FILES_DOWNLOADS_DIR;
        break;
      default:
        return { ok: false, error: `Invalid file type: ${type}` };
    }

    // Sanitize filename
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedName = `${id}_${safeName}`;
    const filePath = path.join(subdir, storedName);
    const relativePath = path.relative(FILES_DIR, filePath);

    // Write file content if provided
    if (content) {
      fs.writeFileSync(filePath, content, "utf-8");
    }

    // Create file metadata
    const fileEntry = {
      id,
      name,
      type,
      mimeType: mimeType || "text/plain",
      size: content ? Buffer.byteLength(content, "utf-8") : 0,
      path: relativePath,
      originalPath: originalPath || null,
      sourceUrl: sourceUrl || null,
      sessionId: sessionId || null,
      createdAt: now,
      tags: [],
    };

    // Update index
    const index = getFilesIndex();
    index.files.push(fileEntry);
    saveFilesIndex(index);

    return { ok: true, file: fileEntry };
  } catch (e) {
    return { ok: false, error: `Failed to save file: ${e.message}` };
  }
}

function handleGetFile(payload) {
  const { fileId } = payload || {};
  if (!fileId) {
    return { ok: false, error: "Missing fileId" };
  }

  try {
    const index = getFilesIndex();
    const file = index.files.find(f => f.id === fileId);

    if (!file) {
      return { ok: false, error: "File not found" };
    }

    // Read content if file exists on disk
    const fullPath = path.join(FILES_DIR, file.path);
    let content = null;
    if (fs.existsSync(fullPath)) {
      content = fs.readFileSync(fullPath, "utf-8");
    }

    return { ok: true, file, content };
  } catch (e) {
    return { ok: false, error: `Failed to get file: ${e.message}` };
  }
}

function handleDeleteFile(payload) {
  const { fileId } = payload || {};
  if (!fileId) {
    return { ok: false, error: "Missing fileId" };
  }

  try {
    const index = getFilesIndex();
    const fileIndex = index.files.findIndex(f => f.id === fileId);

    if (fileIndex === -1) {
      return { ok: false, error: "File not found" };
    }

    const file = index.files[fileIndex];

    // Delete actual file if it exists
    const fullPath = path.join(FILES_DIR, file.path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    // Remove from index
    index.files.splice(fileIndex, 1);
    saveFilesIndex(index);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to delete file: ${e.message}` };
  }
}

function handleOpenFile(payload) {
  const { fileId } = payload || {};
  if (!fileId) {
    return { ok: false, error: "Missing fileId" };
  }

  try {
    const index = getFilesIndex();
    const file = index.files.find(f => f.id === fileId);

    if (!file) {
      return { ok: false, error: "File not found" };
    }

    const fullPath = path.join(FILES_DIR, file.path);
    if (!fs.existsSync(fullPath)) {
      // If file was created elsewhere (originalPath), open that instead
      if (file.originalPath && fs.existsSync(file.originalPath)) {
        execSync(`open "${file.originalPath}"`);
        return { ok: true, opened: file.originalPath };
      }
      return { ok: false, error: "File not found on disk" };
    }

    // Open file with default application
    execSync(`open "${fullPath}"`);
    return { ok: true, opened: fullPath };
  } catch (e) {
    return { ok: false, error: `Failed to open file: ${e.message}` };
  }
}

// --- Version and Upgrade Handlers ---

function handleGetVersion() {
  try {
    // Get git info from repo (native-host is inside the repo)
    const repoPath = path.dirname(__dirname);

    let gitCommit = "unknown";
    let gitBranch = "unknown";

    try {
      gitCommit = execSync("git rev-parse --short HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
      gitBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
    } catch {
      // Git not available or not a repo
    }

    return {
      ok: true,
      version: VERSION,
      gitCommit,
      gitBranch,
      repoPath,
    };
  } catch (e) {
    return { ok: false, error: `Failed to get version: ${e.message}` };
  }
}

function handleCheckForUpdates() {
  try {
    const repoPath = path.dirname(__dirname);

    // Fetch latest from remote
    execSync("git fetch origin", { cwd: repoPath, encoding: "utf-8", timeout: 30000 });

    const localCommit = execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
    const remoteCommit = execSync(`git rev-parse origin/${branch}`, { cwd: repoPath, encoding: "utf-8" }).trim();

    const hasUpdates = localCommit !== remoteCommit;

    // Get commit count behind
    let commitsBehind = 0;
    if (hasUpdates) {
      const count = execSync(`git rev-list --count HEAD..origin/${branch}`, { cwd: repoPath, encoding: "utf-8" }).trim();
      commitsBehind = parseInt(count, 10);
    }

    return {
      ok: true,
      hasUpdates,
      localCommit: localCommit.slice(0, 7),
      remoteCommit: remoteCommit.slice(0, 7),
      commitsBehind,
      branch,
    };
  } catch (e) {
    return { ok: false, error: `Failed to check for updates: ${e.message}` };
  }
}

async function handlePerformUpgrade() {
  try {
    const repoPath = path.dirname(__dirname);
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();

    // 1. Git pull
    execSync(`git pull origin ${branch}`, { cwd: repoPath, encoding: "utf-8", timeout: 60000 });

    // 2. pnpm install
    execSync("pnpm install", { cwd: repoPath, encoding: "utf-8", timeout: 120000 });

    // 3. pnpm build
    execSync("pnpm build", { cwd: repoPath, encoding: "utf-8", timeout: 120000 });

    // 4. Reinstall native host
    execSync("./install.sh", { cwd: path.join(repoPath, "native-host"), encoding: "utf-8", timeout: 30000 });

    // Get new version info
    const newCommit = execSync("git rev-parse --short HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();

    return {
      ok: true,
      newCommit,
      message: "Upgrade complete! Please reload the extension from chrome://extensions and restart Chrome.",
    };
  } catch (e) {
    return { ok: false, error: `Upgrade failed: ${e.message}` };
  }
}

// --- MCP Integration Handlers ---

// Read MCP servers from ~/.claude.json (Claude Code's config file)
function readMcpServersFromConfig() {
  const configPath = path.join(os.homedir(), ".claude.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const allServers = [];

    // MCP servers are stored under config.projects.<path>.mcpServers
    const projects = config.projects || {};
    for (const [projectPath, projectConfig] of Object.entries(projects)) {
      if (typeof projectConfig === "object" && projectConfig !== null && projectConfig.mcpServers) {
        for (const [serverName, serverConfig] of Object.entries(projectConfig.mcpServers)) {
          // Avoid duplicates
          if (!allServers.some(s => s.name === serverName)) {
            allServers.push({
              name: serverName,
              type: serverConfig.type || "stdio",
              command: serverConfig.command || "",
              project: projectPath,
              status: "configured",
            });
          }
        }
      }
    }

    return allServers;
  } catch (e) {
    return [];
  }
}

async function handleListMcpServers() {
  try {
    const servers = readMcpServersFromConfig();
    return { ok: true, servers };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleGetMcpStatus() {
  const servers = readMcpServersFromConfig();
  return {
    ok: true,
    configured: servers.length > 0,
    servers,
  };
}

async function handleInstallMcp(payload, requestId) {
  const { serverName } = payload || {};
  if (!serverName) {
    return { ok: false, error: "Missing serverName" };
  }

  // Validate server name (alphanumeric, dashes, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(serverName)) {
    return { ok: false, error: "Invalid server name" };
  }

  const claudePath = findClaude();
  if (!claudePath) {
    return { ok: false, error: "Claude CLI not found" };
  }

  return new Promise((resolve) => {
    const proc = spawn(claudePath, ["mcp", "add", serverName], {
      env: getClaudeEnv(),
      stdio: ["inherit", "pipe", "pipe"], // inherit stdin for interactive auth
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      // Stream progress back to extension
      if (requestId) {
        sendResponse({ id: requestId, type: "mcpProgress", output: chunk });
      }
    });

    proc.stderr.on("data", (d) => {
      const chunk = d.toString();
      stderr += chunk;
      // Stream stderr as progress too (some tools output progress to stderr)
      if (requestId) {
        sendResponse({ id: requestId, type: "mcpProgress", output: chunk });
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, output: stdout, type: "mcpComplete" });
      } else {
        resolve({ ok: false, error: stderr || stdout || `Exit code ${code}`, type: "mcpComplete" });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, error: err.message, type: "mcpComplete" });
    });

    // Timeout after 5 minutes (auth might require user interaction)
    setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve({ ok: false, error: "Installation timed out after 5 minutes", type: "mcpComplete" });
    }, 300000);
  });
}

// --- Integration Handlers (Marvin-style) ---

// Parse README.md frontmatter for integration metadata
function parseIntegrationReadme(readmePath) {
  try {
    const content = fs.readFileSync(readmePath, "utf-8");
    // Extract title from first # heading
    const titleMatch = content.match(/^# (.+)$/m);
    const title = titleMatch ? titleMatch[1] : null;

    // Extract description from first paragraph after title
    const lines = content.split("\n");
    let description = "";
    let foundTitle = false;
    for (const line of lines) {
      if (line.startsWith("# ")) {
        foundTitle = true;
        continue;
      }
      if (foundTitle && line.trim() && !line.startsWith("#")) {
        description = line.trim();
        break;
      }
    }

    return { title, description };
  } catch {
    return { title: null, description: "" };
  }
}

// Integration metadata (icons, MCP server names for status checking)
const INTEGRATION_META = {
  "google-workspace": {
    icon: "📧",
    mcpName: "google-workspace",
    name: "Google Workspace",
    description: "Gmail, Calendar, Drive, Docs, Sheets, Slides",
  },
  "atlassian": {
    icon: "🔷",
    mcpName: "atlassian",
    name: "Atlassian",
    description: "Jira & Confluence access",
  },
  "ms365": {
    icon: "📘",
    mcpName: "ms365",
    name: "Microsoft 365",
    description: "Outlook, Calendar, OneDrive, Teams",
  },
  "parallel-search": {
    icon: "🔍",
    mcpName: "parallel-search",
    name: "Parallel Search",
    description: "Free web search capability",
  },
};

async function handleListIntegrations() {
  try {
    // Read ~/lily/integrations/ directory
    const integrations = [];
    const mcpServers = readMcpServersFromConfig();
    const configuredNames = mcpServers.map(s => s.name.toLowerCase());

    // List integration directories
    let dirs = [];
    try {
      dirs = fs.readdirSync(INTEGRATIONS_DIR);
    } catch {
      // Directory may not exist yet
    }

    for (const name of dirs) {
      const intDir = path.join(INTEGRATIONS_DIR, name);
      const stat = fs.statSync(intDir);
      if (!stat.isDirectory()) continue;

      // Check if setup.sh exists
      const setupPath = path.join(intDir, "setup.sh");
      const readmePath = path.join(intDir, "README.md");
      if (!fs.existsSync(setupPath)) continue;

      // Get metadata
      const meta = INTEGRATION_META[name] || {};
      const readme = fs.existsSync(readmePath) ? parseIntegrationReadme(readmePath) : {};

      // Check if configured (MCP server exists in Claude config)
      const mcpName = meta.mcpName || name;
      const isConfigured = configuredNames.some(n => n.includes(mcpName));

      integrations.push({
        id: name,
        name: meta.name || readme.title || name,
        description: meta.description || readme.description || "",
        icon: meta.icon || "🔌",
        status: isConfigured ? "configured" : "available",
        hasReadme: fs.existsSync(readmePath),
      });
    }

    return { ok: true, integrations };
  } catch (e) {
    return { ok: false, error: `Failed to list integrations: ${e.message}` };
  }
}

async function handleRunIntegrationSetup(payload) {
  const { integrationId } = payload || {};
  if (!integrationId) {
    return { ok: false, error: "Missing integrationId" };
  }

  // Validate integration ID (prevent path traversal)
  if (integrationId.includes("/") || integrationId.includes("..")) {
    return { ok: false, error: "Invalid integrationId" };
  }

  const setupPath = path.join(INTEGRATIONS_DIR, integrationId, "setup.sh");
  if (!setupPath.startsWith(INTEGRATIONS_DIR)) {
    return { ok: false, error: "Path traversal blocked" };
  }

  if (!fs.existsSync(setupPath)) {
    return { ok: false, error: `Setup script not found: ${integrationId}` };
  }

  // Open Terminal.app with the setup script (macOS)
  return new Promise((resolve) => {
    const escapedPath = setupPath.replace(/"/g, '\\"');
    const script = `tell application "Terminal"
      activate
      do script "cd \\"${path.dirname(setupPath)}\\" && ./setup.sh"
    end tell`;

    const proc = spawn("osascript", ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: "Terminal opened with setup script" });
      } else {
        resolve({ ok: false, error: stderr || "Failed to open Terminal" });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, error: `Failed to open Terminal: ${err.message}` });
    });
  });
}

// --- Integration Auth Handler ---
// Opens Terminal with MCP CLI for OAuth authentication (keeps process alive)
const INTEGRATION_AUTH_COMMANDS = {
  // Run Claude interactively - it will keep MCP alive for OAuth callback
  "google-workspace": `echo "Type: List my recent Gmail messages" && echo "This will trigger OAuth. Complete sign-in in your browser, then close this terminal." && echo "" && claude`,
  "atlassian": `claude mcp add atlassian --transport http https://mcp.atlassian.com/v1/mcp && echo "Atlassian configured - use Claude to authenticate"`,
  "ms365": `npx -y @softeria/ms-365-mcp-server`,
};

async function handleRunIntegrationAuth(payload) {
  const { integrationId } = payload || {};
  if (!integrationId) {
    return { ok: false, error: "Missing integrationId" };
  }

  const authCommand = INTEGRATION_AUTH_COMMANDS[integrationId];
  if (!authCommand) {
    return { ok: false, error: `No auth command for: ${integrationId}` };
  }

  // Open Terminal.app with the auth command (macOS)
  return new Promise((resolve) => {
    const script = `tell application "Terminal"
      activate
      do script "${authCommand.replace(/"/g, '\\"')}"
    end tell`;

    const proc = spawn("osascript", ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: "Terminal opened for authentication" });
      } else {
        resolve({ ok: false, error: stderr || "Failed to open Terminal" });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, error: `Failed to open Terminal: ${err.message}` });
    });
  });
}

// --- Workflow Handlers ---

function handleListWorkflows() {
  try {
    const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith(".json"));
    const workflows = [];

    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf-8"));
        workflows.push({
          filename: file,
          name: content.name || file.replace(".json", ""),
          description: content.description || "",
          steps: content.steps?.length || 0,
          createdAt: content.createdAt,
          lastRun: content.lastRun,
        });
      } catch {}
    }

    return { ok: true, workflows };
  } catch (e) {
    return { ok: false, error: `Failed to list workflows: ${e.message}` };
  }
}

function handleGetWorkflow(payload) {
  const { filename } = payload || {};
  if (!filename) {
    return { ok: false, error: "Missing filename" };
  }

  // Validate filename
  if (filename.includes("/") || filename.includes("..")) {
    return { ok: false, error: "Invalid filename" };
  }

  try {
    const filepath = path.join(WORKFLOWS_DIR, filename);
    if (!filepath.startsWith(WORKFLOWS_DIR)) {
      return { ok: false, error: "Path traversal blocked" };
    }

    const content = JSON.parse(fs.readFileSync(filepath, "utf-8"));
    return { ok: true, workflow: content };
  } catch (e) {
    return { ok: false, error: `Failed to read workflow: ${e.message}` };
  }
}

function handleSaveWorkflow(payload) {
  const { filename, workflow } = payload || {};
  if (!filename || !workflow) {
    return { ok: false, error: "Missing filename or workflow" };
  }

  // Validate filename
  if (filename.includes("/") || filename.includes("..")) {
    return { ok: false, error: "Invalid filename" };
  }

  const finalFilename = filename.endsWith(".json") ? filename : filename + ".json";

  try {
    const filepath = path.join(WORKFLOWS_DIR, finalFilename);
    if (!filepath.startsWith(WORKFLOWS_DIR)) {
      return { ok: false, error: "Path traversal blocked" };
    }

    // Add metadata
    workflow.createdAt = workflow.createdAt || new Date().toISOString();
    workflow.updatedAt = new Date().toISOString();

    fs.writeFileSync(filepath, JSON.stringify(workflow, null, 2), "utf-8");
    return { ok: true, filename: finalFilename };
  } catch (e) {
    return { ok: false, error: `Failed to save workflow: ${e.message}` };
  }
}

function handleDeleteWorkflow(payload) {
  const { filename } = payload || {};
  if (!filename) {
    return { ok: false, error: "Missing filename" };
  }

  // Validate filename
  if (filename.includes("/") || filename.includes("..")) {
    return { ok: false, error: "Invalid filename" };
  }

  try {
    const filepath = path.join(WORKFLOWS_DIR, filename);
    if (!filepath.startsWith(WORKFLOWS_DIR)) {
      return { ok: false, error: "Path traversal blocked" };
    }

    fs.unlinkSync(filepath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to delete workflow: ${e.message}` };
  }
}

// --- Active Workflow Handlers ---

function loadActiveWorkflows() {
  try {
    if (fs.existsSync(ACTIVE_WORKFLOWS_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIVE_WORKFLOWS_FILE, "utf-8"));
    }
  } catch (e) {
    log(`Failed to load active workflows: ${e.message}`);
  }
  return [];
}

function saveActiveWorkflows(workflows) {
  try {
    fs.writeFileSync(ACTIVE_WORKFLOWS_FILE, JSON.stringify(workflows, null, 2), "utf-8");
    return true;
  } catch (e) {
    log(`Failed to save active workflows: ${e.message}`);
    return false;
  }
}

function handleListActiveWorkflows() {
  try {
    const workflows = loadActiveWorkflows();
    return { ok: true, workflows };
  } catch (e) {
    return { ok: false, error: `Failed to list active workflows: ${e.message}` };
  }
}

function handleActivateWorkflow(payload) {
  const { workflow } = payload || {};
  if (!workflow) {
    return { ok: false, error: "Missing workflow data" };
  }

  try {
    const workflows = loadActiveWorkflows();

    // Generate unique ID
    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const activeWorkflow = {
      ...workflow,
      id,
      activatedAt: new Date().toISOString(),
      runCount: 0,
      status: workflow.status || "pending",
    };

    workflows.push(activeWorkflow);
    saveActiveWorkflows(workflows);

    log(`Activated workflow: ${id} - ${workflow.workflowName}`);
    return { ok: true, id, workflow: activeWorkflow };
  } catch (e) {
    return { ok: false, error: `Failed to activate workflow: ${e.message}` };
  }
}

function handleUpdateWorkflowStatus(payload) {
  const { id, status, stepId, stepStatus, error, result, lastRunAt } = payload || {};
  if (!id) {
    return { ok: false, error: "Missing workflow id" };
  }

  try {
    const workflows = loadActiveWorkflows();
    const index = workflows.findIndex(w => w.id === id);

    if (index === -1) {
      return { ok: false, error: "Workflow not found" };
    }

    const workflow = workflows[index];

    // Update overall status if provided
    if (status) {
      workflow.status = status;
    }

    // Update overall error if provided
    if (error !== undefined) {
      workflow.error = error;
    }

    // Update last run time
    if (lastRunAt) {
      workflow.lastRunAt = lastRunAt;
      workflow.runCount = (workflow.runCount || 0) + 1;
    }

    // Update specific step status if provided
    if (stepId && stepStatus) {
      const step = workflow.steps.find(s => s.id === stepId);
      if (step) {
        step.status = stepStatus;
        step.lastExecuted = new Date().toISOString();
        if (result !== undefined) {
          step.result = result;
        }
        if (error !== undefined) {
          step.error = error;
        }
      }
    }

    workflows[index] = workflow;
    saveActiveWorkflows(workflows);

    return { ok: true, workflow };
  } catch (e) {
    return { ok: false, error: `Failed to update workflow: ${e.message}` };
  }
}

function handleDeactivateWorkflow(payload) {
  const { id } = payload || {};
  if (!id) {
    return { ok: false, error: "Missing workflow id" };
  }

  try {
    const workflows = loadActiveWorkflows();
    const index = workflows.findIndex(w => w.id === id);

    if (index === -1) {
      return { ok: false, error: "Workflow not found" };
    }

    const removed = workflows.splice(index, 1)[0];
    saveActiveWorkflows(workflows);

    log(`Deactivated workflow: ${id} - ${removed.workflowName}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to deactivate workflow: ${e.message}` };
  }
}

function handleTestWorkflowStep(payload) {
  const { workflowId, stepId, testResult } = payload || {};
  if (!workflowId || !stepId) {
    return { ok: false, error: "Missing workflowId or stepId" };
  }

  try {
    const workflows = loadActiveWorkflows();
    const workflow = workflows.find(w => w.id === workflowId);

    if (!workflow) {
      return { ok: false, error: "Workflow not found" };
    }

    const step = workflow.steps.find(s => s.id === stepId);
    if (!step) {
      return { ok: false, error: "Step not found" };
    }

    // If testResult is provided, record it
    if (testResult) {
      step.lastExecuted = new Date().toISOString();
      step.status = testResult.success ? "completed" : "failed";
      step.result = testResult.result;
      step.error = testResult.error;
      saveActiveWorkflows(workflows);
    }

    // Return the step info for the extension to execute the actual test
    return {
      ok: true,
      step: {
        id: step.id,
        action: step.action,
        description: step.description,
        mechanics: step.mechanics,
      },
      workflow: {
        id: workflow.id,
        pageUrl: workflow.pageUrl,
      }
    };
  } catch (e) {
    return { ok: false, error: `Failed to test step: ${e.message}` };
  }
}

// --- Project-Based Memory Handlers ---

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

function loadProjectsIndex() {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_INDEX_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveProjectsIndex(projects) {
  fs.writeFileSync(PROJECTS_INDEX_FILE, JSON.stringify(projects, null, 2), "utf-8");
}

function handleListProjects() {
  const projects = loadProjectsIndex();
  return { ok: true, projects };
}

function handleCreateProject(payload) {
  const { name, description, instructions } = payload || {};
  if (!name || !name.trim()) {
    return { ok: false, error: "Missing project name" };
  }

  const id = slugify(name) + '-' + Date.now().toString(36);
  const projectDir = path.join(MEMORY_PROJECTS_DIR, id);

  // Validate path
  if (!projectDir.startsWith(MEMORY_PROJECTS_DIR)) {
    return { ok: false, error: "Invalid project name" };
  }

  try {
    // Create project directory
    fs.mkdirSync(projectDir, { recursive: true });

    // Create project metadata
    const project = {
      id,
      name: name.trim(),
      description: (description || "").trim(),
      instructions: (instructions || "").trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save project meta.json
    fs.writeFileSync(
      path.join(projectDir, "meta.json"),
      JSON.stringify(project, null, 2),
      "utf-8"
    );

    // Initialize empty memory files
    fs.writeFileSync(path.join(projectDir, "facts.json"), "[]", "utf-8");
    fs.writeFileSync(path.join(projectDir, "people.json"), "[]", "utf-8");
    fs.writeFileSync(path.join(projectDir, "documents.json"), "[]", "utf-8");
    fs.writeFileSync(path.join(projectDir, "memory.md"), "", "utf-8");

    // Add to projects index
    const projects = loadProjectsIndex();
    projects.push(project);
    saveProjectsIndex(projects);

    return { ok: true, project };
  } catch (e) {
    return { ok: false, error: `Failed to create project: ${e.message}` };
  }
}

function handleDeleteProject(payload) {
  const { projectId } = payload || {};
  if (!projectId) {
    return { ok: false, error: "Missing projectId" };
  }

  // Validate projectId (prevent path traversal)
  if (projectId.includes("/") || projectId.includes("..")) {
    return { ok: false, error: "Invalid projectId" };
  }

  const projectDir = path.join(MEMORY_PROJECTS_DIR, projectId);
  if (!projectDir.startsWith(MEMORY_PROJECTS_DIR)) {
    return { ok: false, error: "Path traversal blocked" };
  }

  try {
    // Remove project directory
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true });
    }

    // Remove from projects index
    const projects = loadProjectsIndex();
    const filtered = projects.filter(p => p.id !== projectId);
    saveProjectsIndex(filtered);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to delete project: ${e.message}` };
  }
}

function handleGetProjectMemory(payload) {
  const { projectId } = payload || {};
  if (!projectId) {
    return { ok: false, error: "Missing projectId" };
  }

  // Validate projectId
  if (projectId.includes("/") || projectId.includes("..")) {
    return { ok: false, error: "Invalid projectId" };
  }

  const projectDir = path.join(MEMORY_PROJECTS_DIR, projectId);
  if (!projectDir.startsWith(MEMORY_PROJECTS_DIR)) {
    return { ok: false, error: "Path traversal blocked" };
  }

  const readJsonArray = (filename) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(projectDir, filename), "utf-8"));
    } catch {
      return [];
    }
  };

  try {
    // Read instructions from meta.json
    let instructions = "";
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(projectDir, "meta.json"), "utf-8"));
      instructions = meta.instructions || "";
    } catch {}

    // Read memory summary
    let memorySummary = "";
    try {
      memorySummary = fs.readFileSync(path.join(projectDir, "memory.md"), "utf-8");
    } catch {}

    const memory = {
      facts: readJsonArray("facts.json"),
      people: readJsonArray("people.json"),
      documents: readJsonArray("documents.json"),
      instructions,
      memorySummary,
    };

    return { ok: true, memory };
  } catch (e) {
    return { ok: false, error: `Failed to get project memory: ${e.message}` };
  }
}

async function handleRunMcpSetup(payload) {
  const { serverName, serverUrl } = payload || {};
  if (!serverName || !serverUrl) {
    return { ok: false, error: "Missing serverName or serverUrl" };
  }

  // Validate server name (alphanumeric, dashes, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(serverName)) {
    return { ok: false, error: "Invalid server name" };
  }

  const command = `claude mcp add ${serverName} "${serverUrl}"`;

  // Open Terminal.app with command (macOS)
  return new Promise((resolve) => {
    // Escape for AppleScript
    const escapedCommand = command.replace(/"/g, '\\"');
    const script = `tell application "Terminal"
      activate
      do script "${escapedCommand}"
    end tell`;

    const proc = spawn("osascript", ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: "Terminal opened with setup command" });
      } else {
        resolve({ ok: false, error: stderr || "Failed to open Terminal" });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, error: `Failed to open Terminal: ${err.message}` });
    });
  });
}

function handleUpdateProjectMemory(payload) {
  const { projectId, type, action, item } = payload || {};

  if (!projectId || !type) {
    return { ok: false, error: "Missing required fields" };
  }

  // Validate projectId
  if (projectId.includes("/") || projectId.includes("..")) {
    return { ok: false, error: "Invalid projectId" };
  }

  const projectDir = path.join(MEMORY_PROJECTS_DIR, projectId);
  if (!projectDir.startsWith(MEMORY_PROJECTS_DIR)) {
    return { ok: false, error: "Path traversal blocked" };
  }

  // Handle memorySummary type — writes directly to memory.md
  if (type === "memorySummary") {
    const memoryPath = path.join(projectDir, "memory.md");
    try {
      fs.writeFileSync(memoryPath, (item || "").trim(), "utf-8");

      // Update project timestamp
      const metaPath = path.join(projectDir, "meta.json");
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        meta.updatedAt = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

        const projects = loadProjectsIndex();
        const idx = projects.findIndex(p => p.id === projectId);
        if (idx >= 0) {
          projects[idx].updatedAt = meta.updatedAt;
          saveProjectsIndex(projects);
        }
      } catch {}

      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Failed to update memory summary: ${e.message}` };
    }
  }

  // Handle instructions type — updates meta.json directly
  if (type === "instructions") {
    const metaPath = path.join(projectDir, "meta.json");
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      meta.instructions = (item || "").trim();
      meta.updatedAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

      // Update timestamp in index
      const projects = loadProjectsIndex();
      const idx = projects.findIndex(p => p.id === projectId);
      if (idx >= 0) {
        projects[idx].updatedAt = meta.updatedAt;
        saveProjectsIndex(projects);
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Failed to update instructions: ${e.message}` };
    }
  }

  // For array-based types (facts, people, documents)
  if (!action || !item) {
    return { ok: false, error: "Missing required fields" };
  }

  if (!["facts", "people", "documents"].includes(type)) {
    return { ok: false, error: "Invalid memory type" };
  }

  if (!["add", "remove"].includes(action)) {
    return { ok: false, error: "Invalid action" };
  }

  const filename = `${type}.json`;
  const filepath = path.join(projectDir, filename);

  try {
    // Read current items
    let items = [];
    try {
      items = JSON.parse(fs.readFileSync(filepath, "utf-8"));
    } catch {}

    if (action === "add") {
      // Add item if not already present
      if (!items.includes(item)) {
        items.push(item);
      }
    } else if (action === "remove") {
      // Remove item
      items = items.filter(i => i !== item);
    }

    // Save updated items
    fs.writeFileSync(filepath, JSON.stringify(items, null, 2), "utf-8");

    // Update project timestamp
    const metaPath = path.join(projectDir, "meta.json");
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      meta.updatedAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

      // Update in index too
      const projects = loadProjectsIndex();
      const idx = projects.findIndex(p => p.id === projectId);
      if (idx >= 0) {
        projects[idx].updatedAt = meta.updatedAt;
        saveProjectsIndex(projects);
      }
    } catch {}

    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to update project memory: ${e.message}` };
  }
}
