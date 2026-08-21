// @jira-workbench/dsh 进程内 host 插件。
//
// 把宿主无关的 core 工具面（@jira-workbench/core 的 buildToolDefinitions）
// 直接注册到 DSH 的 ctx.tools，替代第一版的独立 HTTP 进程 + mcp-client。
// 模型侧工具名就是 core 的原始工具名（jira_list_my_tasks 等），不再有
// mcp__jira-workbench__ 前缀。
//
// 本插件注入 tools、workspaceRegistry、sessionQuery、apiProxy 与 agentDefaultModel：前两类目录
// 分别提供 DSH 项目/会话，apiProxy 负责原生新建会话、读取 Skill 并发送首条
// 消息。credentials/approval/webServer/settings 仍按能力可选注入。core 通过
// ESM import 直接加载，不 import 任何 DSH 的 TypeScript 包。

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import sm from "schemastery";
import { z } from "zod/v4";
import {
  buildIssueDetailSnapshot,
  createCoreService,
  createJiraTaskBoardMcpHttpHandler
} from "@jira-workbench/core/index.mjs";
import {
  buildToolDefinitions,
  CODEX_BIND_ISSUE_TOOL,
  CODEX_CLEAR_BINDING_TOOL,
  CODEX_CREATE_ISSUE_ANALYSIS_TOOL,
  JIRA_PREPARE_TRANSITION_TOOL,
  JIRA_BIND_WORKSPACE_TOOL,
  JIRA_UNBIND_WORKSPACE_TOOL,
  SVN_CREATE_REVIEW_TOOL,
  SVN_CANCEL_REVIEW_TOOL,
  SVN_CONFIRM_REVIEW_TOOL,
  SVN_RECONCILE_COMMIT_TOOL,
  SVN_CONFIRM_COMMITTED_TOOL,
  SVN_ABANDON_REVIEW_TOOL
} from "@jira-workbench/core/tools.mjs";
import { createDshCredentialSecretStore } from "./lib/dsh-credential-secret-store.mjs";
import { createDshApprovalProvider, runWithAgent } from "./lib/dsh-approval-provider.mjs";
import { createDshConversationService } from "./lib/dsh-conversation-service.mjs";
import { createDshAnalysisService } from "./lib/dsh-analysis-service.mjs";

// DSH settings schema 用 schemastery（DSH 的 ctx.settings.register 要求 schema 是
// 可调用 + 有 toJSON 的校验函数，zod 不满足）。上游 schemastery@3.18 与 DSH
// vendored 的 @deepseek-ai/schemastery@3.18 同源，API 兼容。
const smz = sm;

// DSH settings namespace（可视配置：baseUrl 等非 secret；token 走 credential-ref
// 不进 settings）。命名空间须匹配 ^[a-z][a-z0-9-]*$。
const SETTINGS_NAMESPACE = "jira-workbench";
const CREDENTIAL_REF_TOKEN = "JIRA_WORKBENCH_TOKEN";
const MAX_CONFIG_BODY_BYTES = 32 * 1024;

// DSH 侧看板 HTML 文件路径（core 的 mcp/ui/task-board.html，已由 core exports 暴露）。
const taskBoardHtmlPath = fileURLToPath(
  import.meta.resolve("@jira-workbench/core/mcp/ui/task-board.html")
);

// DSH 侧的独立配置目录：DSH home 下，与 Codex 的 LOCALAPPDATA/jira-workbench
// 分离（DESIGN.md 决策 1：同一份 config.json 只能一种 secretStore，DSH 走
// credential-ref，必须独立文件）。plugin.mjs 是纯 JS，不 import DSH 的 TS 包，
// 因此 DSH home 用 DSH_HOME 环境变量或 ~/.dsh 解析。
export function dshDataRoot(env = process.env, osHome = homedir()) {
  const home = env.DSH_HOME && String(env.DSH_HOME).trim()
    ? env.DSH_HOME
    : join(osHome, ".dsh");
  return join(home, "jira-workbench");
}

export function dshConfigFile(env = process.env, osHome = homedir()) {
  return env.JIRA_WORKBENCH_CONFIG_FILE
    || join(dshDataRoot(env, osHome), "config.json");
}

export const name = "jira-workbench";

export const inject = ["tools", "workspaceRegistry", "sessionQuery", "apiProxy", "agentDefaultModel"];

export function createDshWorkspaceCatalog(ctx) {
  return {
    async list() {
      const registry = ctx.get("workspaceRegistry");
      if (!registry || typeof registry.list !== "function") {
        throw new Error("jira-workbench: DSH workspaceRegistry 不可用，无法读取项目列表。");
      }
      return {
        host: "dsh",
        available: true,
        workspaces: registry.list().map((workspace) => ({
          id: String(workspace.id || ""),
          workspaceId: String(workspace.id || ""),
          path: String(workspace.path || ""),
          title: String(workspace.title || basename(String(workspace.path || ""))),
          source: "dsh-workspace-registry"
        }))
      };
    }
  };
}

// 宽松 JSON 输出 schema：core 工具的 structuredContent 是「每个工具不同 view
// 字段」的对象，无固定结构，用空 schema 声明「任意 JSON」。
const OPEN_JSON_OUTPUT_SCHEMA = {};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sameOriginWrite(request) {
  const origin = String(request.headers?.origin || "").trim();
  if (!origin) return true;
  try {
    return new URL(origin).host === String(request.headers?.host || "").trim();
  } catch {
    return false;
  }
}

async function readJsonRequest(request) {
  const contentType = String(request.headers?.["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    const error = new Error("请求必须使用 application/json。");
    error.statusCode = 415;
    error.code = "UNSUPPORTED_MEDIA_TYPE";
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_CONFIG_BODY_BYTES) {
      const error = new Error("配置请求内容过大。");
      error.statusCode = 413;
      error.code = "REQUEST_TOO_LARGE";
      throw error;
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("配置请求不是有效 JSON。");
    error.statusCode = 400;
    error.code = "INVALID_JSON";
    throw error;
  }
}

export function createDshConnectionConfigHandler(configStore) {
  return async (request, response) => {
    if (request.method === "GET" || request.method === "HEAD") {
      try {
        const configuration = await configStore.getPublic();
        if (request.method === "HEAD") {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.end();
        } else {
          sendJson(response, 200, { ok: true, configuration });
        }
      } catch (error) {
        sendJson(response, Number(error?.statusCode || 500), {
          ok: false,
          error: { code: error?.code || "CONFIG_READ_FAILED", message: String(error?.message || error) }
        });
      }
      return;
    }
    if (request.method !== "PUT") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD, PUT" });
      response.end("Method Not Allowed");
      return;
    }
    if (!sameOriginWrite(request)) {
      sendJson(response, 403, {
        ok: false,
        error: { code: "WRITE_ORIGIN_FORBIDDEN", message: "配置写入只允许来自当前 DSH 页面。" }
      });
      return;
    }
    try {
      const input = await readJsonRequest(request);
      const configuration = await configStore.updateCredentialReference({
        baseUrl: input?.baseUrl,
        tokenReference: CREDENTIAL_REF_TOKEN,
        ...(Object.prototype.hasOwnProperty.call(input || {}, "boardSources")
          ? { boardSources: input.boardSources }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(input || {}, "promptTemplates")
          ? { promptTemplates: input.promptTemplates }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(input || {}, "imageProcessing")
          ? { imageProcessing: input.imageProcessing }
          : {})
      });
      sendJson(response, 200, { ok: true, configuration });
    } catch (error) {
      sendJson(response, Number(error?.statusCode || 500), {
        ok: false,
        error: { code: error?.code || "CONFIG_WRITE_FAILED", message: String(error?.message || error) }
      });
    }
  };
}

export function createDshConfigOptionsHandler({
  configStore,
  jira,
  workspaceCatalog,
  getSkills,
  getApiProxy,
  getAgents,
  listThreads,
  getLlm
} = {}) {
  if (!configStore || typeof configStore.load !== "function") throw new TypeError("configStore is required.");
  if (!jira || typeof jira.fetchProjects !== "function" || typeof jira.fetchFilters !== "function") {
    throw new TypeError("jira client is required.");
  }

  return async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
      response.end("Method Not Allowed");
      return;
    }
    try {
      const requestUrl = new URL(String(request.url || "/jira-workbench/config-options"), "http://localhost");
      const resource = String(requestUrl.searchParams.get("resource") || "").trim();
      let payload;
      if (resource === "projects" || resource === "filters") {
        const config = await configStore.load();
        if (!config?.configured || !config?.baseUrl || !config?.token) {
          const error = new Error("请先配置 Jira 地址和 Token。");
          error.statusCode = 428;
          error.code = "JIRA_NOT_CONFIGURED";
          throw error;
        }
        payload = resource === "projects"
          ? await jira.fetchProjects(config)
          : await jira.fetchFilters(config, {
              projectKey: String(requestUrl.searchParams.get("projectKey") || "").trim(),
              projectId: String(requestUrl.searchParams.get("projectId") || "").trim(),
              projectName: String(requestUrl.searchParams.get("projectName") || "").trim()
            });
      } else if (resource === "vision-models") {
        const llm = typeof getLlm === "function" ? await getLlm() : null;
        if (!llm || typeof llm.listProviders !== "function" || typeof llm.listModels !== "function") {
          payload = { available: false, models: [], message: "当前 DSH 未加载模型服务。" };
        } else {
          const listedProviders = llm.listProviders();
          const providers = Array.isArray(listedProviders) ? listedProviders : [];
          const discovered = await Promise.allSettled(providers.map(async (provider) => ({
            provider,
            models: await llm.listModels(String(provider?.id || ""))
          })));
          const models = [];
          for (const result of discovered) {
            if (result.status !== "fulfilled") continue;
            const providerId = String(result.value.provider?.id || "").trim();
            const providerName = String(result.value.provider?.name || providerId).trim();
            for (const model of Array.isArray(result.value.models) ? result.value.models : []) {
              if (!Array.isArray(model?.inputModalities) || !model.inputModalities.includes("image")) continue;
              const id = String(model?.id || "").trim();
              if (!providerId || !id) continue;
              models.push({
                provider: providerId,
                providerName,
                id,
                name: String(model?.name || id).trim()
              });
            }
          }
          payload = {
            available: true,
            models: models.sort((left, right) => (
              `${left.providerName}/${left.name}`.localeCompare(`${right.providerName}/${right.name}`, "zh-CN")
            ))
          };
        }
      } else if (resource === "skills") {
        const catalog = workspaceCatalog && typeof workspaceCatalog.list === "function"
          ? await workspaceCatalog.list()
          : { workspaces: [] };
        const workspaces = Array.isArray(catalog?.workspaces) ? catalog.workspaces : [];
        const entries = new Map();
        let available = false;
        const mergeSkills = (skillList, label, { registryShape = false } = {}) => {
          for (const skill of Array.isArray(skillList) ? skillList : []) {
            if (!skill?.name || (registryShape && skill?.invocation?.userInvocable === false)) continue;
            const name = String(skill.name).trim();
            if (!name) continue;
            const current = entries.get(name) || {
              name,
              description: String(skill.description || skill.whenToUse || "").trim(),
              source: String(skill.source || skill.provider || "dsh").trim(),
              path: String(skill.path || "").trim(),
              scopes: []
            };
            if (label && !current.scopes.includes(label)) current.scopes.push(label);
            entries.set(name, current);
          }
        };

        // Host 全局 registry 可直接按 cwd 枚举；部分 DSH preset 会把 Skill
        // registry 隔离在 agent realm 中，此时 ctx.get("skills") 看不到，必须
        // 通过官方 apiProxy.skills.list(sessionId) 读取该会话真实可用的目录。
        const skills = typeof getSkills === "function" ? await getSkills() : null;
        if (skills && typeof skills.list === "function") {
          available = true;
          const lookups = [
            { cwd: "", label: "全局" },
            ...workspaces.map((workspace) => ({
              cwd: String(workspace.cwd || workspace.path || "").trim(),
              label: String(workspace.projectLabel || workspace.title || workspace.cwd || workspace.path || "项目").trim()
            })).filter((entry) => entry.cwd)
          ];
          const discovered = await Promise.allSettled(lookups.map(async (lookup) => ({
            lookup,
            skills: await skills.list(lookup.cwd ? { cwd: lookup.cwd } : {})
          })));
          for (const result of discovered) {
            if (result.status !== "fulfilled") continue;
            mergeSkills(result.value.skills, result.value.lookup.label, { registryShape: true });
          }
        }

        const apiProxy = typeof getApiProxy === "function" ? await getApiProxy() : null;
        const agents = typeof getAgents === "function" ? await getAgents() : null;
        if (apiProxy?.skills && typeof apiProxy.skills.list === "function") {
          available = true;
          const sessions = new Map();
          if (agents && typeof agents.list === "function") {
            for (const agent of agents.list()) {
              const id = String(agent?.id || "").trim();
              if (id) sessions.set(id, {
                id,
                cwd: String(agent?.session?.header?.cwd || "").trim(),
                live: true
              });
            }
          }
          if (typeof listThreads === "function") {
            try {
              const threadState = await listThreads({ limit: 200 });
              const ordered = [...(Array.isArray(threadState?.threads) ? threadState.threads : [])]
                .sort((left, right) => Number(right?.status === "live") - Number(left?.status === "live"));
              for (const thread of ordered) {
                const id = String(thread?.id || thread?.threadId || "").trim();
                if (!id || sessions.has(id)) continue;
                sessions.set(id, {
                  id,
                  cwd: String(thread?.cwd || "").trim(),
                  live: thread?.status === "live"
                });
              }
            } catch {
              // 会话目录是补充来源；agent registry 或全局 Skill 仍可能可用。
            }
          }
          const sessionCandidates = Array.from(sessions.values())
            .sort((left, right) => Number(right.live) - Number(left.live))
            .slice(0, 64);
          const discovered = await Promise.allSettled(sessionCandidates.map(async (session) => ({
            session,
            response: await apiProxy.skills.list({
              rpcId: `jira-workbench-skills-${randomUUID()}`,
              payload: { sessionId: session.id }
            })
          })));
          for (const result of discovered) {
            if (result.status !== "fulfilled" || result.value.response?.result?.ok !== true) continue;
            const cwd = result.value.session.cwd;
            const workspace = workspaces.find((candidate) => {
              const candidateCwd = String(candidate.cwd || candidate.path || "").trim();
              return cwd && candidateCwd.toLowerCase() === cwd.toLowerCase();
            });
            const label = String(workspace?.projectLabel || workspace?.title || cwd || "当前会话").trim();
            mergeSkills(result.value.response.result.value?.skills, label);
          }
        }

        payload = {
          available,
          skills: Array.from(entries.values()).sort((left, right) => left.name.localeCompare(right.name, "en")),
          ...(!available ? { message: "当前 DSH 未加载 Skill 服务。" } : {})
        };
      } else {
        const error = new Error("未知的配置选项类型。");
        error.statusCode = 400;
        error.code = "INVALID_CONFIG_OPTIONS_RESOURCE";
        throw error;
      }
      if (request.method === "HEAD") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end();
      } else {
        sendJson(response, 200, { ok: true, ...payload });
      }
    } catch (error) {
      sendJson(response, Number(error?.statusCode || 500), {
        ok: false,
        error: {
          code: String(error?.code || "CONFIG_OPTIONS_FAILED"),
          message: String(error?.message || error)
        }
      });
    }
  };
}

function normalizedDshSessionId(value) {
  return String(value || "").trim().slice(0, 1_000);
}

function normalizedDshIssueKey(value) {
  const issueKey = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) {
    const error = new Error("Jira Issue Key 无效。");
    error.statusCode = 400;
    error.code = "INVALID_ISSUE_KEY";
    throw error;
  }
  return issueKey;
}

/**
 * 提供当前 DSH 会话的 Jira 关联摘要，并以 CAS 语义解除关联。
 * @param {{ workbench: object, conversations: object, issueBindings: object, workspaceBindings: object }} services
 * @returns {(request: object, response: object) => Promise<void>}
 */
export function createDshSessionContextHandler({
  workbench,
  conversations,
  issueBindings,
  workspaceBindings
} = {}) {
  if (!workbench || typeof workbench.getIssue !== "function") throw new TypeError("workbench is required.");
  if (!conversations || typeof conversations.clearBinding !== "function") throw new TypeError("conversations is required.");
  if (!issueBindings || typeof issueBindings.snapshot !== "function") throw new TypeError("issueBindings is required.");
  if (!workspaceBindings || typeof workspaceBindings.get !== "function") throw new TypeError("workspaceBindings is required.");

  return async (request, response) => {
    try {
      if (request.method === "GET") {
        const requestUrl = new URL(String(request.url || "/jira-workbench/session-context"), "http://localhost");
        const sessionId = normalizedDshSessionId(requestUrl.searchParams.get("sessionId"));
        if (!sessionId) {
          const error = new Error("DSH sessionId 不能为空。");
          error.statusCode = 400;
          error.code = "DSH_SESSION_ID_REQUIRED";
          throw error;
        }
        const bindingState = await issueBindings.snapshot();
        const matches = Object.entries(bindingState.bindings || {})
          .filter(([, binding]) => normalizedDshSessionId(binding?.threadId).toLowerCase() === sessionId.toLowerCase())
          .sort(([left], [right]) => left.localeCompare(right));
        if (!matches.length) {
          sendJson(response, 200, {
            ok: true,
            revision: Number(bindingState.revision || 0),
            context: null
          });
          return;
        }

        const [issueKey, binding] = matches[0];
        const [issueResult, workspaceResult] = await Promise.allSettled([
          workbench.getIssue(issueKey),
          workspaceBindings.get(issueKey)
        ]);
        const issueSnapshot = issueResult.status === "fulfilled"
          ? buildIssueDetailSnapshot(issueResult.value)
          : null;
        const issueError = issueResult.status === "rejected"
          ? {
              code: String(issueResult.reason?.code || "JIRA_ISSUE_READ_FAILED"),
              message: String(issueResult.reason?.message || issueResult.reason || "Jira 详情读取失败。")
            }
          : null;
        const workspaceError = workspaceResult.status === "rejected"
          ? {
              code: String(workspaceResult.reason?.code || "ISSUE_WORKSPACE_READ_FAILED"),
              message: String(workspaceResult.reason?.message || workspaceResult.reason || "项目目录读取失败。")
            }
          : null;
        sendJson(response, 200, {
          ok: true,
          revision: Number(bindingState.revision || 0),
          context: {
            sessionId,
            issueKey,
            binding,
            issue: issueSnapshot?.issue || {
              key: issueKey,
              title: String(binding?.issueTitle || binding?.title || "已关联 Jira 任务")
            },
            issueError,
            workspace: workspaceResult.status === "fulfilled" ? workspaceResult.value?.binding || null : null,
            workspaceRevision: workspaceResult.status === "fulfilled"
              ? Number(workspaceResult.value?.revision || 0)
              : 0,
            workspaceError,
            conflictingIssueKeys: matches.slice(1).map(([candidateKey]) => candidateKey)
          }
        });
        return;
      }

      if (request.method !== "DELETE") {
        response.writeHead(405, {
          "content-type": "text/plain; charset=utf-8",
          allow: "GET, DELETE"
        });
        response.end("Method Not Allowed");
        return;
      }
      if (!sameOriginWrite(request)) {
        sendJson(response, 403, {
          ok: false,
          error: { code: "WRITE_ORIGIN_FORBIDDEN", message: "会话关联写入只允许来自当前 DSH 页面。" }
        });
        return;
      }
      const input = await readJsonRequest(request);
      const sessionId = normalizedDshSessionId(input?.sessionId);
      const issueKey = normalizedDshIssueKey(input?.issueKey);
      const expectedRevision = Number(input?.expectedRevision);
      if (!sessionId) {
        const error = new Error("DSH sessionId 不能为空。");
        error.statusCode = 400;
        error.code = "DSH_SESSION_ID_REQUIRED";
        throw error;
      }
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        const error = new Error("会话关联版本无效，请刷新后重试。");
        error.statusCode = 400;
        error.code = "ISSUE_BINDINGS_REVISION_REQUIRED";
        throw error;
      }
      const current = await issueBindings.snapshot();
      if (Number(current.revision || 0) !== expectedRevision) {
        const error = new Error("会话关联已更新，请刷新后重试。");
        error.statusCode = 409;
        error.code = "ISSUE_BINDINGS_REVISION_CONFLICT";
        throw error;
      }
      const currentSessionId = normalizedDshSessionId(current.bindings?.[issueKey]?.threadId);
      if (!currentSessionId || currentSessionId.toLowerCase() !== sessionId.toLowerCase()) {
        const error = new Error("该 Jira 已不再关联当前 DSH 会话，请刷新后重试。");
        error.statusCode = 409;
        error.code = "ISSUE_BINDING_SESSION_CHANGED";
        throw error;
      }
      const result = await conversations.clearBinding({ issueKey, expectedRevision });
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, Number(error?.statusCode || 500), {
        ok: false,
        error: {
          code: String(error?.code || "DSH_SESSION_CONTEXT_FAILED"),
          message: String(error?.message || error || "会话关联操作失败。")
        }
      });
    }
  };
}

/**
 * 把一个 core 工具定义转换成 DSH 的 ToolDefinition。
 * core 工具面用 zod inputSchema，handler 返回 { structuredContent, content }；
 * DSH 需要 JSON Schema parameters + execute 返回 canonical value + render。
 */
const DSH_APPROVAL_ACTIONS = new Map([
  [CODEX_BIND_ISSUE_TOOL, "jira-bind-session"],
  [CODEX_CLEAR_BINDING_TOOL, "jira-unbind-session"],
  [CODEX_CREATE_ISSUE_ANALYSIS_TOOL, "jira-create-analysis-session"],
  [JIRA_BIND_WORKSPACE_TOOL, "jira-bind-workspace"],
  [JIRA_UNBIND_WORKSPACE_TOOL, "jira-unbind-workspace"],
  [SVN_CREATE_REVIEW_TOOL, "svn-create-review"],
  [SVN_CANCEL_REVIEW_TOOL, "svn-cancel-review"],
  [SVN_CONFIRM_REVIEW_TOOL, "svn-confirm-review"],
  [SVN_RECONCILE_COMMIT_TOOL, "svn-reconcile-commit"],
  [SVN_CONFIRM_COMMITTED_TOOL, "svn-confirm-committed"],
  [SVN_ABANDON_REVIEW_TOOL, "svn-abandon-review"]
]);

export async function approveDshMutation(definition, args, { approvalProvider, svn }) {
  const action = DSH_APPROVAL_ACTIONS.get(definition.name);
  if (!action) return;
  let payload = args;
  if (definition.name === SVN_CONFIRM_REVIEW_TOOL && typeof svn?.getReview === "function") {
    const review = await svn.getReview(args.reviewId, args.issueKey);
    payload = {
      issueKey: args.issueKey,
      reviewId: args.reviewId,
      selectedPaths: review?.selectedPaths || [],
      commitMessage: review?.commitMessage || "",
      riskAcknowledged: Boolean(args.riskAcknowledged),
      overlapAcknowledged: Boolean(args.overlapAcknowledged)
    };
  }
  await approvalProvider.approve(action, payload, { toolName: definition.name });
}

function toToolDefinition(definition, { approvalProvider, svn } = {}) {
  // core 工具面的 inputSchema 是 plain object（zod field map），不是 zod schema
  // 实例；z.toJSONSchema 需要 z.object 包装。
  // zod v4 的 toJSONSchema 输出根对象带 non-enumerable 的 `~standard` 品牌属性，
  // DSH 的 snapshotJsonValue 会因此拒绝（非 plain JSON）。JSON round-trip 深拷贝
  // 去掉该标记，得到 DSH 认可的干净 plain object。
  const parameters = JSON.parse(JSON.stringify(z.toJSONSchema(z.object(definition.inputSchema))));
  return {
    name: definition.name,
    description: definition.description,
    parameters,
    annotations: definition.annotations,
    output: {
      schema: OPEN_JSON_OUTPUT_SCHEMA,
      render(_args, value) {
        // core handler 的 content[0].text 是给模型的中文摘要；structuredContent
        // 是结构化结果。render 把结构化结果序列化成文本供模型阅读。
        const text = value && typeof value === "object" && Array.isArray(value.content)
          ? value.content.map((block) => block?.text || "").filter(Boolean).join("\n")
          : "";
        return text ? [{ type: "text", text }] : [];
      }
    },
    async execute(args, exec) {
      // 把 DSH 的 exec.agent 存入 ALS，供 dshApprovalProvider.issue 读取。
      const result = await runWithAgent(exec?.agent, async () => {
        if (approvalProvider) {
          await approveDshMutation(definition, args, { approvalProvider, svn });
        }
        return definition.handler(args);
      });
      // canonical value = core handler 的返回（structuredContent + content 都保留，
      // render 只取 content 文本；structuredContent 通过 canonical value 传递）。
      return result ?? {};
    }
  };
}

export async function apply(ctx, config = {}) {
  // Token 存储固定使用 DSH credential-ref；服务尚未就绪或缺失时读写均
  // fail closed，绝不把 DSH Token 回退写入 Codex 的 DPAPI 数据。credentials
  // 是可选服务，且其 provider 可能在本插件
  // apply 之后才进入 ACTIVE 状态——用 getter 把「取服务」推迟到真正读写
  // 凭据的时刻（读配置 / 提交卡片），避免 apply 时 ctx.get 因时序竞态拿到
  // undefined 而误回退 DPAPI。
  const secretStore = createDshCredentialSecretStore(() => ctx.get("credentials"));

  // 组装 core 服务（无 Codex 宿主能力，SVN 审查降级人工）。DSH 走独立
  // config 文件：baseUrl/看板配置存 DSH home 下，token 经 credential-ref 存
  // DSH credentials（见 dshConfigFile 与 createDshCredentialSecretStore）。
  const workspaceCatalog = createDshWorkspaceCatalog(ctx);
  const core = createCoreService({
    dataRoot: dshDataRoot(),
    configFile: dshConfigFile(),
    version: config.version || "0.33.6",
    workspaceCatalog,
    ...(secretStore ? { secretStore } : {})
  });
  const conversations = createDshConversationService({
    ctx,
    issueBindings: core.issueBindings
  });
  const desktop = createDshAnalysisService({
    ctx,
    workbench: core.jiraWorkbench,
    configStore: core.configStore,
    taskBoardLoader: core.taskBoardLoader,
    issueBindings: core.issueBindings,
    workspaceBindings: core.workspaceBindings
  });
  const handleMcp = createJiraTaskBoardMcpHttpHandler({
    workbench: core.jiraWorkbench,
    conversations,
    desktop,
    svn: core.svnWorkbench,
    workspaces: core.workspaceBindings,
    version: core.version,
    serverName: "jira-workbench-dsh"
  });

  // 无审批服务时严格 fail closed：只读工具可用，所有会改变 Jira、SVN 审核
  // 状态或工作副本的工具都不注册。approval 作为可选服务后置就绪时，再通过
  // ctx.inject 动态补齐写工具，不在 apply 时错误降级成本地自动许可。
  const baseDefinitions = buildToolDefinitions({
    service: core.jiraWorkbench,
    conversations,
    desktop,
    svn: core.svnWorkbench,
    workspaces: core.workspaceBindings
  });

  const tools = ctx.get("tools");
  if (!tools || typeof tools.register !== "function") {
    throw new Error("jira-workbench: ctx.tools 不可用，无法注册工具。");
  }

  const disposers = [];
  for (const definition of baseDefinitions.filter((item) => item.annotations?.readOnlyHint === true)) {
    disposers.push(tools.register(toToolDefinition(definition)));
  }

  // 所有副作用（工具注册）都在 fiber 生命周期内，stop 时统一移除。
  ctx.effect(() => {
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "jira-workbench.tools");

  ctx.inject(["approval"], (approvalCtx) => {
    const approval = approvalCtx.get("approval");
    const approvalProvider = createDshApprovalProvider(approval);
    const mutationDefinitions = buildToolDefinitions({
      service: core.jiraWorkbench,
      conversations,
      desktop,
      svn: core.svnWorkbench,
      workspaces: core.workspaceBindings,
      approvalProvider
    }).filter((item) => item.annotations?.readOnlyHint !== true);
    const mutationDisposers = mutationDefinitions.map((definition) => tools.register(toToolDefinition(definition, {
      approvalProvider,
      svn: core.svnWorkbench
    })));
    return () => {
      for (const dispose of mutationDisposers) dispose();
    };
  });

  // 操作面板：挂 /jira-task-board（HTML）与 /mcp（MCP 端点）两个 webServer 路由。
  // 看板在 ?transport=http 模式下 fetch 根路径 /mcp，走 core.handleMcp（StreamableHTTP）。
  // webServer 是可选服务（headless 等 profile 没有），用 ctx.inject 而非 inject 数组。
  ctx.inject(["webServer"], (httpCtx) => {
    const serveBoardHtml = (request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
        response.end("Method Not Allowed");
        return;
      }
      void readFile(taskBoardHtmlPath, "utf8")
        .then((html) => {
          // DSH 侧不提供看板内的「设置」入口：设置走 DSH 统一设置面板的插件卡片，
          // 故把 SETTINGS_URL 替换为空，让看板隐藏「设置」按钮（避免点开 Codex 的
          // 47823 地址）。版本号正常替换。
          const body = html
            .replaceAll("__JIRA_WORKBENCH_VERSION__", core.version)
            .replaceAll("__JIRA_WORKBENCH_SETTINGS_URL__", "")
            .replaceAll("__JIRA_WORKBENCH_HOST_KIND__", "dsh");
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(request.method === "HEAD" ? undefined : body);
        })
        .catch((error) => {
          response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          response.end(`看板加载失败：${String(error?.message || error)}`);
        });
    };
    const disposeBoard = httpCtx.webServer.register({
      kind: "exact",
      path: "/jira-task-board",
      handler: serveBoardHtml
    });
    const disposeMcp = httpCtx.webServer.register({
      kind: "exact",
      path: "/mcp",
      handler: handleMcp
    });
    const disposeConfig = httpCtx.webServer.register({
      kind: "exact",
      path: "/jira-workbench/config",
      handler: createDshConnectionConfigHandler(core.configStore)
    });
    const disposeConfigOptions = httpCtx.webServer.register({
      kind: "exact",
      path: "/jira-workbench/config-options",
      handler: createDshConfigOptionsHandler({
        configStore: core.configStore,
        jira: core.jira,
        workspaceCatalog,
        getSkills: () => ctx.get("skills"),
        getApiProxy: () => ctx.get("apiProxy"),
        getAgents: () => ctx.get("agents"),
        listThreads: (options) => conversations.listThreads(options),
        getLlm: () => ctx.get("llm")
      })
    });
    const disposeSessionContext = httpCtx.webServer.register({
      kind: "exact",
      path: "/jira-workbench/session-context",
      handler: createDshSessionContextHandler({
        workbench: core.jiraWorkbench,
        conversations,
        issueBindings: core.issueBindings,
        workspaceBindings: core.workspaceBindings
      })
    });
    return () => {
      disposeBoard();
      disposeMcp();
      disposeConfig();
      disposeConfigOptions();
      disposeSessionContext();
    };
  });

  // 配置面板：注册 DSH settings namespace（baseUrl 等可视配置）。
  // settings 是可选服务，缺失时配置面板不可用但工具照常跑。
  ctx.inject(["settings"], (settingsCtx) => {
    const settings = settingsCtx.settings;
    const schema = smz.object({
      baseUrl: smz.string().default("")
    });
    const scope = settings.register(SETTINGS_NAMESPACE, schema);

    // Namespace registration itself is not represented by a settings document
    // write in DSH rc.7. Its Plugins directory may therefore finish the first
    // describe() just before this optional injection runs and never discover
    // the Jira card. Publish one directory invalidation after registration;
    // listeners already mounted re-read, while listeners mounted later see the
    // namespace in their initial read.
    settingsCtx.emit("settings/document-updated", SETTINGS_NAMESPACE, 0);

    // 回填：settings 里没有 baseUrl 时，从 config.json 同步进来（首次挂载时
    // 让用户看到已配置的值）。
    void core.configStore.load().then((loaded) => {
      const current = scope.get();
      if (!current.baseUrl && loaded.baseUrl) {
        void scope.update({ baseUrl: loaded.baseUrl });
      }
    }).catch(() => {
      // config.json 缺失或未配置时静默：settings 保持空，用户首次填写。
    });

    // 用户在 settings 卡片改 baseUrl 后，把 DSH credentials 的固定 Token 引用
    // 一并写回 config.json。错误保留在控制台，客户端专用卡片会通过上面的
    // /jira-workbench/config 路由获得同步失败回执。
    const unwatch = scope.watch((next, prev) => {
      if (next.baseUrl !== prev.baseUrl) {
        void core.configStore.updateCredentialReference({
          baseUrl: next.baseUrl,
          tokenReference: CREDENTIAL_REF_TOKEN
        }).catch((error) => {
          console.error("jira-workbench: Jira 连接配置同步失败。", error);
        });
      }
    });

    return () => {
      unwatch();
      // settings.register 已通过 fiber effect 注册 disposer，这里无需手动移除。
    };
  });
}
