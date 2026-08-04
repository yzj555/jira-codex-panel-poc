import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_JOBS = 200;
const MAX_WECOM_MARKDOWN_BYTES = 3_800;

function emptyState() {
  return { version: 1, jobs: {} };
}

function normalizeIssue(input = {}) {
  const key = String(input.key || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
    throw new Error("自动分析任务缺少有效的 Jira Issue Key。");
  }
  return {
    key,
    title: String(input.title || input.summary || key).trim().slice(0, 500),
    url: String(input.url || "").trim().slice(0, 2_000),
    statusLabel: String(input.statusLabel || input.status || "").trim().slice(0, 100),
    assignee: String(input.assignee || "").trim().slice(0, 200)
  };
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    issueKey: job.issueKey,
    issueTitle: job.issueTitle,
    threadId: job.threadId,
    status: job.status,
    pushStatus: job.pushStatus,
    startedAt: job.startedAt,
    completedAt: job.completedAt || "",
    error: job.error || ""
  };
}

function truncateUtf8(value, maximumBytes) {
  const text = String(value || "");
  if (Buffer.byteLength(text, "utf8") <= maximumBytes) return text;
  let result = "";
  for (const character of text) {
    if (Buffer.byteLength(`${result}${character}…`, "utf8") > maximumBytes) break;
    result += character;
  }
  return `${result}…`;
}

export function buildWecomAnalysisMessage(job) {
  const header = `**Codex 自动分析完成：${job.issueKey}**`;
  const title = job.issueTitle ? `> ${job.issueTitle}` : "";
  const jiraLink = job.issueUrl ? `[在 Jira 中查看](${job.issueUrl})` : "";
  const result = String(job.result || "未生成分析结果。").trim();
  return truncateUtf8([header, title, jiraLink, "", result].filter(Boolean).join("\n"), MAX_WECOM_MARKDOWN_BYTES);
}

export async function pushWecomAnalysis(webhook, job, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(webhook, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { content: buildWecomAnalysisMessage(job) }
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Number(payload.errcode || 0) !== 0) {
    throw new Error(payload.errmsg || `企业微信机器人返回 HTTP ${response.status}。`);
  }
  return payload;
}

export function createAutomationManager({
  stateFile,
  configStore,
  sessionReader,
  fetchImpl = globalThis.fetch,
  pollIntervalMs = 3_000
}) {
  let statePromise = null;
  let mutation = Promise.resolve();
  let polling = false;
  let timer = null;

  async function readState() {
    if (!statePromise) {
      statePromise = readFile(stateFile, "utf8")
        .then((content) => {
          const parsed = JSON.parse(content);
          return parsed && typeof parsed.jobs === "object" ? parsed : emptyState();
        })
        .catch((error) => {
          if (error.code === "ENOENT" || error instanceof SyntaxError) return emptyState();
          throw error;
        });
    }
    return statePromise;
  }

  async function writeState(state) {
    await mkdir(dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, stateFile);
  }

  function mutate(mutator) {
    const operation = mutation.then(async () => {
      const current = structuredClone(await readState());
      const result = await mutator(current);
      const ordered = Object.values(current.jobs || {})
        .sort((left, right) => Date.parse(right.startedAt || 0) - Date.parse(left.startedAt || 0))
        .slice(0, MAX_JOBS);
      current.jobs = Object.fromEntries(ordered.map((job) => [job.issueKey, job]));
      statePromise = Promise.resolve(current);
      await writeState(current);
      return result;
    });
    mutation = operation.catch(() => {});
    return operation;
  }

  async function register({ issue, threadId, startedAt, monitorGeneration = 0 }) {
    const normalizedIssue = normalizeIssue(issue);
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) throw new Error("自动分析任务缺少 Codex 会话 ID。");
    return mutate((state) => {
      const existing = state.jobs[normalizedIssue.key];
      if (existing && existing.status !== "failed") return publicJob(existing);
      const job = {
        id: randomUUID(),
        issueKey: normalizedIssue.key,
        issueTitle: normalizedIssue.title,
        issueUrl: normalizedIssue.url,
        issueStatus: normalizedIssue.statusLabel,
        issueAssignee: normalizedIssue.assignee,
        threadId: normalizedThreadId,
        monitorGeneration: Math.max(0, Number(monitorGeneration || 0)),
        status: "running",
        pushStatus: "waiting",
        startedAt: new Date(Number(startedAt || Date.now())).toISOString(),
        completedAt: "",
        result: "",
        error: "",
        pushAttempts: 0,
        nextPushAt: 0
      };
      state.jobs[job.issueKey] = job;
      return publicJob(job);
    });
  }

  async function fail({ issueKey, message }) {
    const normalizedKey = String(issueKey || "").trim().toUpperCase();
    if (!normalizedKey) return null;
    return mutate((state) => {
      const job = state.jobs[normalizedKey] || {
        id: randomUUID(),
        issueKey: normalizedKey,
        issueTitle: normalizedKey,
        issueUrl: "",
        threadId: "",
        startedAt: new Date().toISOString()
      };
      job.status = "failed";
      job.pushStatus = "skipped";
      job.completedAt = new Date().toISOString();
      job.error = String(message || "自动分析启动失败。").slice(0, 1_000);
      state.jobs[normalizedKey] = job;
      return publicJob(job);
    });
  }

  async function markCompletion(issueKey, completion) {
    return mutate((state) => {
      const job = state.jobs[issueKey];
      if (!job || job.status !== "running") return null;
      job.status = completion.status;
      job.completedAt = completion.completedAt || new Date().toISOString();
      job.result = completion.status === "completed" ? String(completion.result || "").trim() : "";
      job.error = completion.status === "failed" ? String(completion.error || "Codex 分析已中止。") : "";
      job.pushStatus = completion.status === "completed" ? "pending" : "skipped";
      job.nextPushAt = 0;
      return publicJob(job);
    });
  }

  async function attemptPush(issueKey) {
    const state = await readState();
    const job = state.jobs[issueKey];
    if (!job || job.status !== "completed" || job.pushStatus !== "pending") return;
    const config = await configStore.load();
    if (!config.wecomWebhook) {
      await mutate((next) => {
        const current = next.jobs[issueKey];
        if (current?.pushStatus === "pending") current.pushStatus = "skipped";
      });
      return;
    }
    try {
      await pushWecomAnalysis(config.wecomWebhook, job, { fetchImpl });
      await mutate((next) => {
        const current = next.jobs[issueKey];
        if (!current) return;
        current.pushStatus = "sent";
        current.pushedAt = new Date().toISOString();
        current.pushError = "";
      });
    } catch (error) {
      await mutate((next) => {
        const current = next.jobs[issueKey];
        if (!current) return;
        current.pushAttempts = Number(current.pushAttempts || 0) + 1;
        current.pushError = String(error.message || error).slice(0, 1_000);
        if (current.pushAttempts >= 3) current.pushStatus = "failed";
        else current.nextPushAt = Date.now() + current.pushAttempts * 30_000;
      });
    }
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const state = await readState();
      const running = Object.values(state.jobs).filter((job) => job.status === "running" && job.threadId);
      for (const job of running) {
        const completion = await sessionReader.readCompletion(job.threadId, {
          after: Math.max(0, Date.parse(job.startedAt || "") - 5_000)
        });
        if (completion) await markCompletion(job.issueKey, completion);
      }
      const refreshed = await readState();
      const pendingPushes = Object.values(refreshed.jobs).filter((job) => (
        job.status === "completed"
        && job.pushStatus === "pending"
        && Number(job.nextPushAt || 0) <= Date.now()
      ));
      for (const job of pendingPushes) await attemptPush(job.issueKey);
    } finally {
      polling = false;
    }
  }

  async function getStatus() {
    const state = await readState();
    const jobs = Object.values(state.jobs)
      .sort((left, right) => Date.parse(right.startedAt || 0) - Date.parse(left.startedAt || 0));
    const activeJob = jobs.find((job) => job.status === "running") || null;
    return {
      busy: Boolean(activeJob),
      activeJob: publicJob(activeJob),
      knownIssueKeys: jobs.map((job) => job.issueKey),
      recentJobs: jobs.slice(0, 20).map(publicJob)
    };
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => void poll().catch((error) => {
      console.error(`[jira-poc] automation poll failed: ${error.message}`);
    }), pollIntervalMs);
    timer.unref?.();
    void poll().catch((error) => console.error(`[jira-poc] automation poll failed: ${error.message}`));
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { register, fail, getStatus, poll, start, stop };
}
