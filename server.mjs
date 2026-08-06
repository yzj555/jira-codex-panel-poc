import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  ConfigurationError,
  buildBoardQueries,
  createConfigStore
} from "./config-store.mjs";
import { JiraApiError, createJiraClient } from "./jira-client.mjs";
import { createJxlClient } from "./jxl-client.mjs";
import { materializeAttachment } from "./lib/attachment-cache.mjs";
import { createAutomationManager } from "./lib/automation-manager.mjs";
import { createCodexSessionReader } from "./lib/codex-session-reader.mjs";
import {
  buildSvnCommitMessage,
  createSvnReviewManager,
  SvnReviewError
} from "./lib/svn-review-manager.mjs";

const VERSION = "0.26.16";
const host = process.env.JIRA_POC_HOST || "127.0.0.1";
const port = Number(process.env.JIRA_POC_PORT || 47823);
const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");
const configStore = createConfigStore();
const attachmentCacheRoot = join(dirname(configStore.configFile), "attachments");
const jira = createJiraClient();
const boardIssueTypeCache = new Map();
const collaboratorFieldCache = new Map();
const jxl = createJxlClient();
const sessionsRoot = process.env.CODEX_SESSIONS_DIR
  || join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
const sessionReader = createCodexSessionReader({ sessionsRoot });
const automation = createAutomationManager({
  stateFile: process.env.JIRA_CODEX_AUTOMATION_FILE || join(dirname(configStore.configFile), "automation.json"),
  configStore,
  sessionReader
});
const svnReviews = createSvnReviewManager({
  sessionReader,
  baselineFile: process.env.JIRA_CODEX_SVN_BASELINES_FILE
    || join(dirname(configStore.configFile), "svn-baselines.json"),
  reviewStateFile: process.env.JIRA_CODEX_SVN_REVIEWS_FILE
    || join(dirname(configStore.configFile), "svn-reviews.json"),
  reviewArtifactsRoot: process.env.JIRA_CODEX_SVN_REVIEW_ARTIFACTS_DIR
    || join(attachmentCacheRoot, "svn-reviews")
});

function boardCollaboratorJqlField(boardSources) {
  const fieldId = String(boardSources?.collaboratorFieldId || "").trim();
  const numericId = fieldId.match(/^customfield_(\d+)$/i);
  if (numericId) return `cf[${numericId[1]}]`;
  const displayName = String(boardSources?.collaboratorJqlName || "").trim();
  return displayName ? `"${displayName.replace(/"/g, '\\"')}"` : "";
}

async function discoverBoardBugTypes(config, boardSources) {
  const builtinRequired = ["requirement", "bug"].some((kind) => boardSources?.[kind]?.mode === "builtin");
  if (!builtinRequired) return [];
  const projectKey = String(boardSources?.projectKey || "").trim().toUpperCase();
  const cacheKey = `${config.baseUrl}|${projectKey}|${boardSources?.collaboratorFieldId || "auto"}`;
  const cached = boardIssueTypeCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) return cached.names;
  const clauses = [];
  if (projectKey) clauses.push(`project = ${projectKey}`);
  const collaboratorField = boardCollaboratorJqlField(boardSources);
  clauses.push(collaboratorField
    ? `(assignee = currentUser() OR ${collaboratorField} = currentUser())`
    : "assignee = currentUser()");
  clauses.push("statusCategory != Done");
  let names = [];
  try {
    const result = await jira.fetchIssues({
      ...config,
      jql: `${clauses.join(" AND ")} ORDER BY updated DESC`
    }, { maxResults: Math.min(Number(config.maxResults || 100), 200) });
    names = [...new Set(result.issues
      .map((issue) => String(issue.typeName || "").trim())
      .filter((name) => /bug|defect|缺陷|故障|错误/i.test(name)))];
  } catch {
    // Type discovery is an optimization. If a project or custom field is not
    // visible, leave the type clause out and let the panel classify results.
  }
  boardIssueTypeCache.set(cacheKey, { names, fetchedAt: Date.now() });
  return names;
}

function collaboratorFieldCandidate(field, preferredName = "") {
  if (!field?.id || field.custom === false || field.searchable === false) return false;
  const name = String(field.name || "").trim();
  const preferred = String(preferredName || "").trim().toLowerCase();
  if (preferred && name.toLowerCase() === preferred) return true;
  return /协同\s*(处理|负责|参与)|协作\s*(处理|负责|参与)|collaborat|co-?worker|watcher/i.test(name);
}

function collaboratorFieldCacheKey(config) {
  const baseUrl = String(config?.baseUrl || "").trim().toLowerCase();
  const token = String(config?.token || "");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
  return `${baseUrl}|${tokenHash}`;
}

async function resolveCollaboratorFieldConfig(config) {
  const configuredId = String(
    config?.collaboratorFieldId || config?.boardSources?.collaboratorFieldId || ""
  ).trim();
  const baseSources = config?.boardSources && typeof config.boardSources === "object"
    ? config.boardSources
    : {};
  if (configuredId) {
    const cacheKey = collaboratorFieldCacheKey(config);
    const cached = collaboratorFieldCache.get(cacheKey);
    if (cached?.configuredId === configuredId && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
      return cached.config ? { ...config, ...cached.config } : config;
    }
    try {
      const result = await jira.fetchFields(config);
      const exact = result.fields.find((field) => field.id.toLowerCase() === configuredId.toLowerCase());
      const replacement = exact || result.fields.find((field) => collaboratorFieldCandidate(
        field,
        baseSources.collaboratorJqlName
      ));
      if (replacement) {
        const resolved = {
          collaboratorFieldId: replacement.id,
          boardSources: {
            ...baseSources,
            collaboratorFieldId: replacement.id,
            collaboratorJqlName: replacement.name
          }
        };
        collaboratorFieldCache.set(cacheKey, {
          configuredId,
          config: resolved,
          fetchedAt: Date.now()
        });
        return { ...config, ...resolved };
      }
      if (result.fields.length) {
        const cleared = {
          collaboratorFieldId: "",
          boardSources: { ...baseSources, collaboratorFieldId: "", collaboratorJqlName: "" }
        };
        collaboratorFieldCache.set(cacheKey, { configuredId, config: cleared, fetchedAt: Date.now() });
        return { ...config, ...cleared };
      }
      collaboratorFieldCache.set(cacheKey, { configuredId, config: null, fetchedAt: Date.now() });
    } catch {
      // Preserve an explicitly configured field when an older Jira version
      // does not expose /field; the issue endpoint can still return it.
    }
    return {
      ...config,
      collaboratorFieldId: configuredId,
      boardSources: { ...baseSources, collaboratorFieldId: configuredId }
    };
  }
  const cacheKey = collaboratorFieldCacheKey(config);
  const cached = collaboratorFieldCache.get(cacheKey);
  if (cached && !cached.configuredId && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
    return cached.config ? { ...config, ...cached.config } : config;
  }
  try {
    const result = await jira.fetchFields(config);
    const preferredName = baseSources.collaboratorJqlName;
    const field = result.fields.find((candidate) => collaboratorFieldCandidate(candidate, preferredName));
    const resolved = field
      ? {
          collaboratorFieldId: field.id,
          boardSources: {
            ...baseSources,
            collaboratorFieldId: field.id,
            collaboratorJqlName: field.name
          }
        }
      : null;
    collaboratorFieldCache.set(cacheKey, { configuredId: "", config: resolved, fetchedAt: Date.now() });
    return resolved ? { ...config, ...resolved } : config;
  } catch {
    // Field discovery is optional. Built-in boards remain usable with the
    // assignee-only rule when Jira does not expose field metadata.
    collaboratorFieldCache.set(cacheKey, { configuredId: "", config: null, fetchedAt: Date.now() });
    return config;
  }
}

async function validateConfiguredFilters(config) {
  const selected = ["requirement", "bug"].flatMap((kind) => (
    config?.boardSources?.[kind]?.mode === "filter"
      ? (config.boardSources[kind].filterIds || []).map(String)
      : []
  ));
  if (!selected.length) return;
  const discovered = await jira.fetchFilters(config, {
    projectKey: config.boardSources?.projectKey || ""
  });
  const available = new Set((discovered.filters || []).map((filter) => String(filter.id)));
  const missing = [...new Set(selected.filter((id) => !available.has(id)))];
  if (missing.length) {
    throw new ConfigurationError(`当前 Jira Token 无法访问所选 Filter：${missing.join(", ")}。请刷新列表后重新选择。`, {
      code: "BOARD_FILTER_UNAVAILABLE"
    });
  }
}

async function boardQueriesForConfig(config) {
  const bugTypeNames = await discoverBoardBugTypes(config, config.boardSources);
  return buildBoardQueries(config.boardSources, { bugTypeNames });
}

async function jiraConfigForPreview(request) {
  if (request.method !== "POST") return configStore.load();
  const input = await readJson(request);
  const current = await configStore.load();
  // Preview endpoints deliberately use the token currently in the form but
  // never persist it. This lets first-time setup discover projects/filters
  // before the user commits the configuration.
  return configStore.prepare({
    deployment: "data_center",
    baseUrl: input.baseUrl ?? current.baseUrl,
    token: input.token ?? ""
  });
}

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/prompt-builder.js", ["prompt-builder.js", "text/javascript; charset=utf-8"]],
  ["/issue-views.js", ["issue-views.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) {
      throw new ConfigurationError("配置请求内容过大。", { code: "REQUEST_TOO_LARGE", statusCode: 413 });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ConfigurationError("请求不是有效的 JSON。", { code: "INVALID_JSON" });
  }
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    const config = await configStore.getPublic();
    return json(response, 200, {
      ok: true,
      name: "jira-codex-panel-poc",
      version: VERSION,
      jiraConfigured: config.configured
    });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return json(response, 200, { config: await configStore.getPublic() });
  }

  if (request.method === "GET" && url.pathname === "/api/codex/runtime") {
    return json(response, 200, {
      analysisSkill: {
        name: "jira-first-turn-analysis",
        path: join(root, "skills", "jira-first-turn-analysis", "SKILL.md"),
        scope: "app"
      }
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/config") {
    const candidate = await resolveCollaboratorFieldConfig(
      await configStore.prepare(await readJson(request))
    );
    await validateConfiguredFilters(candidate);
    if (candidate.boardSources?.legacy && candidate.jql) {
      await jira.fetchIssues(candidate, { maxResults: 1 });
    } else {
      const queries = buildBoardQueries(candidate.boardSources);
      await jira.fetchIssues({ ...candidate, jql: queries.activeJql }, { maxResults: 1 });
    }
    const config = await configStore.save(candidate);
    return json(response, 200, { config, connection: { ok: true } });
  }

  if (request.method === "DELETE" && url.pathname === "/api/config") {
    await configStore.clear();
    return json(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/automation/status") {
    const config = await configStore.getPublic();
    return json(response, 200, {
      monitorEnabled: config.bugMonitorEnabled,
      monitorGeneration: config.monitorGeneration,
      wecomConfigured: config.wecomConfigured,
      ...(await automation.getStatus())
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/monitor") {
    const input = await readJson(request);
    const config = await configStore.setBugMonitorEnabled(input.enabled);
    return json(response, 200, {
      config,
      automation: {
        monitorEnabled: config.bugMonitorEnabled,
        monitorGeneration: config.monitorGeneration,
        wecomConfigured: config.wecomConfigured,
        ...(await automation.getStatus())
      }
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/jobs") {
    const input = await readJson(request);
    return json(response, 200, {
      job: await automation.register(input),
      automation: await automation.getStatus()
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/automation/jobs/fail") {
    const input = await readJson(request);
    return json(response, 200, {
      job: await automation.fail(input),
      automation: await automation.getStatus()
    });
  }

  if (["GET", "POST"].includes(request.method) && url.pathname === "/api/filters") {
    const config = await jiraConfigForPreview(request);
    if (!config.baseUrl || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    return json(response, 200, await jira.fetchFilters(config, {
      projectKey: url.searchParams.get("projectKey") || ""
    }));
  }

  if (["GET", "POST"].includes(request.method) && url.pathname === "/api/projects") {
    const config = await jiraConfigForPreview(request);
    if (!config.baseUrl || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    return json(response, 200, await jira.fetchProjects(config));
  }

  if (request.method === "GET" && url.pathname === "/api/issues") {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const effectiveConfig = await resolveCollaboratorFieldConfig(config);
    const result = effectiveConfig.boardSources?.legacy && effectiveConfig.jql
      ? await jira.fetchIssues(effectiveConfig)
      : await jira.fetchTaskBoardIssues(effectiveConfig, await boardQueriesForConfig(effectiveConfig));
    return json(response, 200, result);
  }

  if (request.method === "GET" && url.pathname === "/api/svn/context") {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const issueKey = url.searchParams.get("issueKey");
    const threadId = url.searchParams.get("threadId");
    const issue = await jira.fetchIssue(await resolveCollaboratorFieldConfig(config), issueKey);
    return json(response, 200, {
      context: await svnReviews.inspect({ threadId, issue }),
      message: buildSvnCommitMessage(issue),
      history: svnReviews.listCommitHistory({ threadId, issueKey }),
      review: url.searchParams.get("includeReview") === "0"
        ? null
        : svnReviews.findLatestReview({ threadId, issueKey })
    });
  }

  if (request.method === "GET" && url.pathname === "/api/svn/reviews/latest") {
    await svnReviews.poll();
    return json(response, 200, {
      review: svnReviews.findLatestReview({
        threadId: url.searchParams.get("threadId"),
        issueKey: url.searchParams.get("issueKey")
      })
    });
  }

  if (request.method === "GET" && url.pathname === "/api/svn/diff") {
    return json(response, 200, {
      preview: await svnReviews.previewDiff({
        threadId: url.searchParams.get("threadId"),
        path: url.searchParams.get("path")
      })
    });
  }

  if (request.method === "POST" && url.pathname === "/api/svn/diff/open") {
    const input = await readJson(request);
    return json(response, 200, {
      result: await svnReviews.openExternalDiff({
        threadId: input.threadId,
        path: input.path
      })
    });
  }

  if (request.method === "PUT" && url.pathname === "/api/svn/baselines") {
    const input = await readJson(request);
    return json(response, 200, {
      baseline: await svnReviews.recordBaseline({
        threadId: input.threadId,
        issueKey: input.issueKey,
        boundAt: input.boundAt
      })
    });
  }

  if (request.method === "POST" && url.pathname === "/api/svn/reviews") {
    const input = await readJson(request);
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const issue = await jira.fetchIssue(config, input.issueKey);
    return json(response, 201, await svnReviews.createReview({
      threadId: input.threadId,
      activeThreadId: input.activeThreadId,
      issue,
      selectedPaths: input.selectedPaths,
      summary: input.summary,
      codexReviewEnabled: input.codexReviewEnabled === true
    }));
  }

  const svnReviewMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})$/i)
    : null;
  if (svnReviewMatch) {
    await svnReviews.poll();
    return json(response, 200, { review: svnReviews.getReview(svnReviewMatch[1]) });
  }

  const svnCancelMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/cancel$/i)
    : null;
  if (svnCancelMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnReviews.cancel(svnCancelMatch[1], input.message)
    });
  }

  const svnDispatchMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/dispatch$/i)
    : null;
  if (svnDispatchMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnReviews.beginDispatch(svnDispatchMatch[1], {
        auditThreadId: input.auditThreadId,
        auditTurnId: input.auditTurnId
      })
    });
  }

  const svnDispatchFailedMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/dispatch-failed$/i)
    : null;
  if (svnDispatchFailedMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnReviews.failDispatch(svnDispatchFailedMatch[1], input.message)
    });
  }

  const svnRetryMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/retry$/i)
    : null;
  if (svnRetryMatch) {
    const input = await readJson(request);
    const config = await configStore.load();
    const issue = await jira.fetchIssue(config, input.issueKey);
    return json(response, 200, await svnReviews.retryDispatch(svnRetryMatch[1], issue));
  }

  const svnConfirmMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/confirm$/i)
    : null;
  if (svnConfirmMatch) {
    const input = await readJson(request);
    const config = await configStore.load();
    const issue = await jira.fetchIssue(config, input.issueKey);
    return json(response, 200, await svnReviews.confirm(svnConfirmMatch[1], {
      issue,
      issueKey: input.issueKey,
      reviewed: input.reviewed,
      riskAcknowledged: input.riskAcknowledged,
      overlapAcknowledged: input.overlapAcknowledged
    }));
  }

  const svnCommitMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/commit$/i)
    : null;
  if (svnCommitMatch) {
    const input = await readJson(request);
    const config = await configStore.load();
    const issue = await jira.fetchIssue(config, input.issueKey);
    return json(response, 200, {
      review: await svnReviews.commit(svnCommitMatch[1], {
        issue,
        confirmationToken: input.confirmationToken
      })
    });
  }

  const svnReconcileMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/reconcile$/i)
    : null;
  if (svnReconcileMatch) {
    return json(response, 200, {
      review: await svnReviews.reconcileCommit(svnReconcileMatch[1])
    });
  }

  const svnAbandonMatch = request.method === "POST"
    ? url.pathname.match(/^\/api\/svn\/reviews\/([0-9a-f-]{36})\/abandon$/i)
    : null;
  if (svnAbandonMatch) {
    const input = await readJson(request);
    return json(response, 200, {
      review: await svnReviews.abandon(svnAbandonMatch[1], {
        acknowledged: input.acknowledged,
        message: input.message
      })
    });
  }

  const issueMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/issues\/([A-Za-z][A-Za-z0-9_]*-\d+)$/)
    : null;
  if (issueMatch) {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const effectiveConfig = await resolveCollaboratorFieldConfig(config);
    return json(response, 200, {
      issue: await jira.fetchIssue(effectiveConfig, issueMatch[1]),
      fetchedAt: new Date().toISOString()
    });
  }

  const issueTransitionsMatch = ["GET", "POST"].includes(request.method)
    ? url.pathname.match(/^\/api\/issues\/([A-Za-z][A-Za-z0-9_]*-\d+)\/transitions$/)
    : null;
  if (issueTransitionsMatch) {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const issueKey = issueTransitionsMatch[1];
    if (request.method === "GET") {
      return json(response, 200, await jira.fetchTransitions(config, issueKey));
    }
    const input = await readJson(request);
    return json(response, 200, await jira.executeTransition(config, issueKey, input.transitionId));
  }

  if (request.method === "GET" && url.pathname === "/api/jxl/sheets") {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    return json(response, 200, await jxl.listSheets(config));
  }

  const jxlSheetIssuesMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/jxl\/sheets\/(\d+)\/([A-Za-z0-9_-]+)\/issues$/)
    : null;
  if (jxlSheetIssuesMatch) {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const sheet = await jxl.getSheet(config, {
      projectId: jxlSheetIssuesMatch[1],
      sheetId: jxlSheetIssuesMatch[2]
    });
    if (!sheet) {
      throw new JiraApiError("JXL Sheet 不存在或当前用户无权查看。", {
        code: "JXL_SHEET_NOT_FOUND",
        upstreamStatus: 404
      });
    }
    if (sheet._scope?.type !== "jql" || !sheet._scope.value) {
      throw new JiraApiError("当前 JXL Sheet 不是 JQL 范围，暂时只能在 Jira 中打开。", {
        code: "JXL_SCOPE_UNSUPPORTED",
        upstreamStatus: 400
      });
    }
    const { _scope, ...sheetInfo } = sheet;
    const effectiveConfig = await resolveCollaboratorFieldConfig(config);
    const result = await jira.fetchIssues({ ...effectiveConfig, jql: _scope.value });
    return json(response, 200, { ...result, sheet: sheetInfo });
  }

  const attachmentMaterializeMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/attachments\/(\d+)\/materialize$/)
    : null;
  if (attachmentMaterializeMatch) {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const attachmentId = attachmentMaterializeMatch[1];
    const attachment = await jira.fetchAttachment(config, attachmentId);
    const materialized = await materializeAttachment({
      cacheRoot: attachmentCacheRoot,
      attachmentId,
      attachment
    });
    return json(response, 200, { attachment: materialized });
  }

  const attachmentMatch = request.method === "GET"
    ? url.pathname.match(/^\/api\/attachments\/(\d+)$/)
    : null;
  if (attachmentMatch) {
    const config = await configStore.load();
    if (!config.configured || !config.token) {
      throw new ConfigurationError("请先配置 Jira 地址和 Token。", {
        code: "JIRA_NOT_CONFIGURED",
        statusCode: 428
      });
    }
    const attachment = await jira.fetchAttachment(config, attachmentMatch[1], {
      thumbnail: url.searchParams.get("thumbnail") === "1"
    });
    const disposition = attachment.thumbnail
      ? "inline"
      : `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`;
    const headers = {
      "content-type": attachment.contentType,
      "content-disposition": disposition,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    };
    if (attachment.contentLength) headers["content-length"] = attachment.contentLength;
    response.writeHead(200, headers);
    if (!attachment.body) return response.end();
    Readable.fromWeb(attachment.body).pipe(response);
    return;
  }

  return false;
}

async function serveStatic(request, response, url) {
  const staticFile = request.method === "GET" ? staticFiles.get(url.pathname) : null;
  if (!staticFile) return json(response, 404, { error: "Not found", code: "NOT_FOUND" });

  const [fileName, contentType] = staticFile;
  const filePath = join(publicDir, fileName);
  const fileStat = await stat(filePath);
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": fileStat.size,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  });
  createReadStream(filePath).pipe(response);
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(request, response, url);
    if (handled !== false) return;
  }
  await serveStatic(request, response, url);
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const known = error instanceof ConfigurationError
      || error instanceof JiraApiError
      || error instanceof SvnReviewError;
    const statusCode = known ? error.statusCode : 500;
    console.error(`[jira-poc] ${request.method} ${request.url}: ${error.code || error.name}: ${error.message}`);
    if (response.headersSent) return response.destroy(error);
    json(response, statusCode, {
      error: known ? error.message : "本地 Jira 服务发生内部错误。",
      code: error.code || "INTERNAL_ERROR",
      upstreamStatus: error.upstreamStatus || undefined,
      details: error.details || undefined
    });
  });
});

await svnReviews.initialize();

server.listen(port, host, () => {
  automation.start();
  svnReviews.start();
  console.log(`[jira-poc] panel server: http://${host}:${port}`);
  console.log(`[jira-poc] credential store: ${configStore.configFile}`);
});

async function shutdown() {
  automation.stop();
  await svnReviews.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
