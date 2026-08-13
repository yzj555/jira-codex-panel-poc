import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import {
  DEFAULT_BUG_MESSAGE_TEMPLATE,
  buildIssuePrompt,
  isBugIssue
} from "../public/prompt-builder.js";

const MAX_SEEN_ISSUES = 2_000;
const MAX_QUEUE_ITEMS = 500;
const MAX_ERROR_LENGTH = 2_000;

export const DEFAULT_BUG_MONITOR_INTERVAL_MS = 30_000;
export const DEFAULT_BUG_MONITOR_RETRY_BASE_MS = 30_000;
export const DEFAULT_BUG_MONITOR_MAX_RETRY_MS = 15 * 60_000;
export const DEFAULT_BUG_ANALYSIS_MAX_RUNTIME_MS = 2 * 60 * 60_000;

function emptyState() {
  return {
    version: 1,
    generation: 0,
    initializedAt: "",
    seen: [],
    queue: [],
    lastScanAt: "",
    lastSuccessfulScanAt: "",
    lastDispatchAt: "",
    legacyImportCompletedAt: "",
    lastError: "",
    consecutiveFailures: 0
  };
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

function issueKey(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]*-\d+$/.test(normalized) ? normalized : "";
}

function activeBugIssues(payload) {
  const issues = Array.isArray(payload?.issues) ? payload.issues : [];
  return issues.filter((issue) => (
    issueKey(issue?.key)
    && isBugIssue(issue)
    && ["todo", "in_progress"].includes(String(issue?.status || "").trim().toLowerCase())
  ));
}

function normalizeQueueItem(value = {}) {
  const key = issueKey(value.issueKey || value.key);
  if (!key) return null;
  return {
    id: String(value.id || randomUUID()),
    issueKey: key,
    attempts: Math.max(0, Number(value.attempts || 0)),
    nextAttemptAt: Math.max(0, Number(value.nextAttemptAt || 0)),
    queuedAt: String(value.queuedAt || new Date().toISOString()),
    threadId: String(value.threadId || "").trim(),
    turnId: String(value.turnId || "").trim(),
    cwd: String(value.cwd || "").trim(),
    projectId: String(value.projectId || "").trim(),
    projectLabel: String(value.projectLabel || "").trim(),
    startedAt: String(value.startedAt || ""),
    lastError: String(value.lastError || "").slice(0, MAX_ERROR_LENGTH)
  };
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const queue = (Array.isArray(source.queue) ? source.queue : [])
    .map(normalizeQueueItem)
    .filter(Boolean)
    .slice(0, MAX_QUEUE_ITEMS);
  const uniqueQueue = [];
  const queuedKeys = new Set();
  for (const item of queue) {
    if (queuedKeys.has(item.issueKey)) continue;
    queuedKeys.add(item.issueKey);
    uniqueQueue.push(item);
  }
  return {
    ...emptyState(),
    ...source,
    version: 1,
    generation: Math.max(0, Number(source.generation || 0)),
    seen: [...new Set((Array.isArray(source.seen) ? source.seen : [])
      .map(issueKey)
      .filter(Boolean))].slice(-MAX_SEEN_ISSUES),
    queue: uniqueQueue,
    consecutiveFailures: Math.max(0, Number(source.consecutiveFailures || 0)),
    lastError: String(source.lastError || "").slice(0, MAX_ERROR_LENGTH)
  };
}

function normalizedSkill(skill) {
  if (!skill || typeof skill !== "object") return null;
  const name = String(skill.name || "").trim();
  const path = String(skill.path || "").trim();
  return name ? { name, path, scope: String(skill.scope || "").trim() } : null;
}

function normalizeSkillList(payload) {
  const groups = [payload?.data, payload?.result?.data, payload?.skills, payload?.result?.skills]
    .find((entry) => Array.isArray(entry)) || [];
  const result = [];
  for (const group of groups) {
    const skills = Array.isArray(group?.skills) ? group.skills : group?.name ? [group] : [];
    for (const skill of skills) {
      const normalized = normalizedSkill(skill);
      if (normalized?.path && skill?.enabled !== false) result.push(normalized);
    }
  }
  return result.filter((skill, index, all) => (
    all.findIndex((candidate) => candidate.path.toLowerCase() === skill.path.toLowerCase()) === index
  ));
}

function workspacePath(config) {
  const candidates = [config?.codexProjectPath, config?.codexProjectId];
  return candidates.map((value) => String(value || "").trim()).find((value) => isAbsolute(value)) || "";
}

function analysisTitle(issue) {
  return [`分析 ${issue.key}`, issue.title || issue.summary || ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 180);
}

function retryDelay(attempts, baseMs, maximumMs) {
  return Math.min(maximumMs, baseMs * (2 ** Math.min(Math.max(0, attempts - 1), 8)));
}

function publicQueueItem(item) {
  return {
    issueKey: item.issueKey,
    attempts: item.attempts,
    nextAttemptAt: item.nextAttemptAt ? new Date(item.nextAttemptAt).toISOString() : "",
    queuedAt: item.queuedAt,
    launched: Boolean(item.threadId && item.turnId),
    threadId: item.threadId || "",
    turnId: item.turnId || "",
    lastError: item.lastError || ""
  };
}

/**
 * Persistent, page-independent Bug monitor. It owns discovery, deduplication,
 * App Server dispatch and recovery; automationManager remains the single owner
 * of turn completion and WeCom delivery state.
 */
export function createBugMonitorService({
  stateFile,
  configStore,
  loadIssues,
  issueBindings,
  runtime,
  automationManager,
  prepareAttachments = async () => [],
  resolveWorkspace = async (config) => workspacePath(config),
  fallbackSkill = null,
  intervalMs = DEFAULT_BUG_MONITOR_INTERVAL_MS,
  retryBaseMs = DEFAULT_BUG_MONITOR_RETRY_BASE_MS,
  maxRetryMs = DEFAULT_BUG_MONITOR_MAX_RETRY_MS,
  maxAnalysisRuntimeMs = DEFAULT_BUG_ANALYSIS_MAX_RUNTIME_MS,
  now = Date.now
} = {}) {
  if (!stateFile) throw new TypeError("Bug monitor requires a state file.");
  if (typeof configStore?.load !== "function") throw new TypeError("Bug monitor requires configStore.load().");
  if (typeof loadIssues !== "function") throw new TypeError("Bug monitor requires loadIssues().");
  if (typeof issueBindings?.snapshot !== "function" || typeof issueBindings?.applyMutations !== "function") {
    throw new TypeError("Bug monitor requires the issue binding store.");
  }
  if (typeof runtime?.startReadOnlyAnalysis !== "function") {
    throw new TypeError("Bug monitor requires an App Server runtime.");
  }
  if (typeof automationManager?.register !== "function" || typeof automationManager?.getStatus !== "function") {
    throw new TypeError("Bug monitor requires automationManager.");
  }

  let statePromise = null;
  let mutation = Promise.resolve();
  let polling = null;
  let timer = null;
  let wakeTimer = null;
  let nextScheduledAt = 0;

  async function readState() {
    if (!statePromise) {
      statePromise = readFile(stateFile, "utf8")
        .then((content) => normalizeState(JSON.parse(content)))
        .catch((error) => {
          if (error?.code === "ENOENT" || error instanceof SyntaxError) return emptyState();
          throw error;
        });
    }
    return statePromise;
  }

  async function persist(state) {
    const normalized = normalizeState(state);
    await mkdir(dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, stateFile);
    statePromise = Promise.resolve(normalized);
    return normalized;
  }

  function mutate(operation) {
    const pending = mutation.then(async () => persist(await operation(structuredClone(await readState()))));
    mutation = pending.catch(() => {});
    return pending;
  }

  async function resolveSkills(config, cwd = "") {
    let available = [];
    try {
      if (typeof runtime.listSkills === "function") {
        available = normalizeSkillList(await runtime.listSkills({
          cwds: cwd ? [cwd] : undefined,
          forceReload: false
        }));
      }
    } catch {
      // The fallback Skill still has an installer-owned absolute path. A
      // configured Skill is omitted rather than sending a stale user path.
    }
    const requested = normalizedSkill(config?.promptTemplates?.bug?.skill);
    const selected = requested
      ? available.find((skill) => requested.path && skill.path.toLowerCase() === requested.path.toLowerCase())
        || available.find((skill) => skill.name === requested.name)
      : null;
    const bundled = normalizedSkill(fallbackSkill);
    return [selected, bundled?.path ? bundled : null]
      .filter(Boolean)
      .filter((skill, index, all) => all.findIndex((entry) => entry.path === skill.path) === index);
  }

  async function analysisPayload(issue, config) {
    let cwd = "";
    try {
      cwd = String(await resolveWorkspace(config) || "").trim();
    } catch {
      cwd = workspacePath(config);
    }
    const [attachments, skills] = await Promise.all([
      prepareAttachments(issue, config),
      resolveSkills(config, cwd)
    ]);
    const configuredSkill = normalizedSkill(config?.promptTemplates?.bug?.skill);
    const selectedSkill = configuredSkill
      ? skills.find((skill) => (
        (configuredSkill.path && skill.path.toLowerCase() === configuredSkill.path.toLowerCase())
        || skill.name === configuredSkill.name
      ))
      : null;
    const selectedConfiguredSkill = Boolean(selectedSkill);
    const fallbackNotice = configuredSkill && !selectedConfiguredSkill
      ? `绑定 Skill“${configuredSkill.name}”当前不可用，已降级为分析模板和内置 Jira Skill。`
      : "";
    return {
      message: buildIssuePrompt(issue, {
        messageTemplate: config?.promptTemplates?.bug?.content || DEFAULT_BUG_MESSAGE_TEMPLATE,
        includeAnalysisInstructions: !selectedConfiguredSkill,
        fallbackNotice,
        automated: true
      }),
      title: analysisTitle(issue),
      cwd: cwd || undefined,
      skills: selectedConfiguredSkill
        ? [selectedSkill]
        : skills.filter((skill) => skill.name === normalizedSkill(fallbackSkill)?.name),
      attachments: Array.isArray(attachments) ? attachments : []
    };
  }

  async function saveBinding(issue, launched) {
    const storedThreadId = `local:${String(launched.threadId || "").replace(/^local:/i, "")}`;
    const binding = {
      threadId: storedThreadId,
      runtimeOwner: "standalone-appserver",
      hostReference: "codex-app-server",
      threadTitle: analysisTitle(issue),
      issueTitle: issue.title || issue.summary || "",
      analysisTurnId: launched.turnId,
      firstMessageStatus: "sent",
      firstMessageUpdatedAt: nowIso(now),
      automated: true,
      boundAt: nowIso(now),
      updatedAt: nowIso(now)
    };
    if (launched.cwd) {
      binding.workspace = {
        cwd: launched.cwd,
        workspaceRoots: [launched.cwd],
        projectId: launched.projectId || "",
        projectLabel: launched.projectLabel || "",
        kind: launched.projectId ? "project" : "workspace",
        source: "bug-monitor-app-server",
        observedAt: nowIso(now)
      };
    }
    if (typeof issueBindings.bindIfAbsent === "function") {
      const result = await issueBindings.bindIfAbsent(issue.key, binding);
      return result.binding;
    }
    const existing = await issueBindings.snapshot();
    if (existing.bindings?.[issue.key]?.threadId) return existing.bindings[issue.key];
    try {
      const updated = await issueBindings.applyMutations({
        upserts: { [issue.key]: binding },
        expectedRevision: existing.revision
      });
      return updated.bindings?.[issue.key] || binding;
    } catch (error) {
      if (error?.code !== "ISSUE_BINDINGS_REVISION_CONFLICT") throw error;
      const refreshed = await issueBindings.snapshot();
      if (refreshed.bindings?.[issue.key]?.threadId) return refreshed.bindings[issue.key];
      const updated = await issueBindings.applyMutations({
        upserts: { [issue.key]: binding },
        expectedRevision: refreshed.revision
      });
      return updated.bindings?.[issue.key] || binding;
    }
  }

  async function recoverLaunchedItem(item, issue, generation) {
    await automationManager.register({
      issue,
      threadId: `local:${String(item.threadId).replace(/^local:/i, "")}`,
      turnId: item.turnId,
      startedAt: Date.parse(item.startedAt || "") || now(),
      monitorGeneration: generation
    });
    await saveBinding(issue, item);
  }

  async function dispatch(state, issues, config, bindings, automationStatus) {
    const issueByKey = new Map(issues.map((issue) => [issue.key, issue]));
    const recentByKey = new Map((automationStatus.recentJobs || []).map((job) => [job.issueKey, job]));

    state.queue = state.queue.filter((item) => {
      const issue = issueByKey.get(item.issueKey);
      if (!issue || bindings.bindings?.[item.issueKey]?.threadId) return false;
      const job = recentByKey.get(item.issueKey);
      return !(job && Number(job.monitorGeneration || 0) >= state.generation && job.status !== "failed");
    });
    if (automationStatus.busy) return state;

    const dueIndex = state.queue.findIndex((item) => Number(item.nextAttemptAt || 0) <= now());
    if (dueIndex < 0) return state;
    // The user may disable monitoring while Jira or attachment discovery is in
    // flight. Re-read the persisted switch immediately before creating a new
    // App Server task so an acknowledged disable never launches another job.
    const latestConfig = await configStore.load();
    if (!latestConfig?.bugMonitorEnabled
      || Math.max(0, Number(latestConfig.monitorGeneration || 0)) !== state.generation) {
      return state;
    }
    config = latestConfig;
    const item = state.queue[dueIndex];
    const issue = issueByKey.get(item.issueKey);
    try {
      if (item.threadId && item.turnId) {
        await recoverLaunchedItem(item, issue, state.generation);
      } else {
        const payload = await analysisPayload(issue, config);
        const launched = await runtime.startReadOnlyAnalysis({
          ...payload,
          referenceFiles: true,
          requireAllAttachments: false
        });
        const threadId = String(launched?.threadId || "").trim().replace(/^local:/i, "");
        const turnId = String(launched?.turnId || "").trim();
        if (!threadId || !turnId) throw new Error("Codex App Server 未返回真实的 threadId/turnId。");

        item.threadId = threadId;
        item.turnId = turnId;
        item.cwd = String(payload.cwd || "").trim();
        item.projectId = String(config?.codexProjectId || "").trim();
        item.projectLabel = String(config?.codexProjectLabel || "").trim();
        item.startedAt = nowIso(now);
        item.lastError = "";
        await persist(state);
        await recoverLaunchedItem(item, issue, state.generation);
      }
      state.queue.splice(dueIndex, 1);
      state.lastDispatchAt = nowIso(now);
      state.lastError = "";
      state.consecutiveFailures = 0;
    } catch (error) {
      item.attempts += 1;
      item.lastError = String(error?.message || error).slice(0, MAX_ERROR_LENGTH);
      item.nextAttemptAt = now() + retryDelay(item.attempts, retryBaseMs, maxRetryMs);
      state.queue.splice(dueIndex, 1);
      state.queue.push(item);
      state.lastError = `自动分析 ${item.issueKey} 暂时失败：${item.lastError}`.slice(0, MAX_ERROR_LENGTH);
      state.consecutiveFailures += 1;
    }
    return state;
  }

  async function expireStaleJob(status) {
    const job = status?.activeJob;
    const startedAt = Date.parse(job?.startedAt || "");
    if (!job || !startedAt || now() - startedAt <= maxAnalysisRuntimeMs) return status;
    await automationManager.fail({
      issueKey: job.issueKey,
      message: `自动分析超过 ${Math.round(maxAnalysisRuntimeMs / 60_000)} 分钟，已释放队列；原会话仍保留，可人工查看。`
    });
    return automationManager.getStatus();
  }

  async function runPoll() {
    const config = await configStore.load();
    if (typeof automationManager.poll === "function") await automationManager.poll();
    let automationStatus = await expireStaleJob(await automationManager.getStatus());
    if (!config?.configured || !config?.token || !config?.bugMonitorEnabled) {
      return readState();
    }

    const [payload, bindings] = await Promise.all([loadIssues(), issueBindings.snapshot()]);
    const issues = activeBugIssues(payload);
    const generation = Math.max(0, Number(config.monitorGeneration || 0));
    return mutate(async (state) => {
      state.lastScanAt = nowIso(now);
      if (state.generation !== generation || !state.initializedAt) {
        state.generation = generation;
        state.initializedAt = nowIso(now);
        state.seen = issues.map((issue) => issue.key).slice(-MAX_SEEN_ISSUES);
        state.queue = issues.map((issue) => normalizeQueueItem({ issueKey: issue.key, queuedAt: nowIso(now) }));
      } else {
        const seen = new Set(state.seen);
        const queued = new Set(state.queue.map((item) => item.issueKey));
        for (const issue of issues) {
          if (seen.has(issue.key)) continue;
          seen.add(issue.key);
          if (!queued.has(issue.key)) state.queue.push(normalizeQueueItem({ issueKey: issue.key, queuedAt: nowIso(now) }));
        }
        state.seen = Array.from(seen).slice(-MAX_SEEN_ISSUES);
      }
      state.lastSuccessfulScanAt = nowIso(now);
      state.lastError = "";
      state.consecutiveFailures = 0;
      automationStatus = await expireStaleJob(await automationManager.getStatus());
      return dispatch(state, issues, config, bindings, automationStatus);
    });
  }

  async function poll() {
    if (polling) return polling;
    polling = runPoll().catch(async (error) => {
      await mutate((state) => {
        state.lastScanAt = nowIso(now);
        state.lastError = String(error?.message || error).slice(0, MAX_ERROR_LENGTH);
        state.consecutiveFailures += 1;
        return state;
      }).catch(() => {});
      throw error;
    }).finally(() => {
      polling = null;
    });
    return polling;
  }

  function wake({ delayMs = 0 } = {}) {
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      void poll().catch((error) => console.error(`[jira-poc] Bug monitor poll failed: ${error.message}`));
    }, Math.max(0, Number(delayMs || 0)));
    wakeTimer.unref?.();
  }

  async function getStatus() {
    const [state, config, automation] = await Promise.all([
      readState(),
      configStore.load().catch(() => ({})),
      automationManager.getStatus()
    ]);
    const queueKeys = state.queue.map((item) => item.issueKey);
    return {
      monitorOwner: "local-service",
      schedulerRunning: Boolean(timer),
      monitorEnabled: Boolean(config?.bugMonitorEnabled),
      monitorGeneration: Math.max(0, Number(config?.monitorGeneration || 0)),
      wecomConfigured: Boolean(config?.wecomWebhook || config?.wecomConfigured),
      initializedAt: state.initializedAt,
      lastScanAt: state.lastScanAt,
      lastSuccessfulScanAt: state.lastSuccessfulScanAt,
      legacyImportCompletedAt: state.legacyImportCompletedAt,
      nextScanAt: nextScheduledAt ? new Date(nextScheduledAt).toISOString() : "",
      lastError: state.lastError,
      consecutiveFailures: state.consecutiveFailures,
      queueLength: state.queue.length,
      queue: state.queue.slice(0, 50).map(publicQueueItem),
      ...automation,
      knownIssueKeys: [...new Set([...(automation.knownIssueKeys || []), ...queueKeys])]
    };
  }

  async function importLegacyState(value = {}) {
    return mutate((state) => {
      if (state.legacyImportCompletedAt) return state;
      const generation = Math.max(0, Number(value.generation || 0));
      if (!state.initializedAt && generation) state.generation = generation;
      state.seen = [...new Set([
        ...state.seen,
        ...(Array.isArray(value.seen) ? value.seen : [])
      ].map(issueKey).filter(Boolean))].slice(-MAX_SEEN_ISSUES);
      const queued = new Set(state.queue.map((item) => item.issueKey));
      for (const key of Array.isArray(value.queue) ? value.queue : []) {
        const normalizedKey = issueKey(key);
        if (!normalizedKey || queued.has(normalizedKey)) continue;
        queued.add(normalizedKey);
        state.queue.push(normalizeQueueItem({ issueKey: normalizedKey, queuedAt: nowIso(now) }));
      }
      state.legacyImportCompletedAt = nowIso(now);
      return state;
    }).then(() => getStatus());
  }

  function start() {
    if (timer) return;
    nextScheduledAt = now() + intervalMs;
    timer = setInterval(() => {
      nextScheduledAt = now() + intervalMs;
      void poll().catch((error) => console.error(`[jira-poc] Bug monitor poll failed: ${error.message}`));
    }, intervalMs);
    timer.unref?.();
    wake();
  }

  async function stop() {
    if (timer) clearInterval(timer);
    if (wakeTimer) clearTimeout(wakeTimer);
    timer = null;
    wakeTimer = null;
    nextScheduledAt = 0;
    await polling?.catch(() => {});
  }

  return { getStatus, importLegacyState, poll, start, stop, wake };
}
