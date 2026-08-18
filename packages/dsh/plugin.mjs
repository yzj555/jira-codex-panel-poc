// jira-workbench-dsh 进程内 host 插件。
//
// 把宿主无关的 core 工具面（@jira-workbench/core 的 buildToolDefinitions）
// 直接注册到 DSH 的 ctx.tools，替代第一版的独立 HTTP 进程 + mcp-client。
// 模型侧工具名就是 core 的原始工具名（jira_list_my_tasks 等），不再有
// mcp__jira-workbench__ 前缀。
//
// 本插件只注入 DSH 的两个服务：tools（注册工具）与 credentials（可选，
// 第二阶段 dshCredentialSecretStore 用）。core 通过 ESM import 直接加载，
// 不 import 任何 DSH 的 TypeScript 包。

import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import { createCoreService } from "@jira-workbench/core/index.mjs";
import { buildToolDefinitions } from "@jira-workbench/core/tools.mjs";
import { createDshCredentialSecretStore } from "./lib/dsh-credential-secret-store.mjs";
import { createDshApprovalProvider, runWithAgent } from "./lib/dsh-approval-provider.mjs";

// DSH 侧的独立配置目录：DSH home 下，与 Codex 的 LOCALAPPDATA/jira-workbench
// 分离（DESIGN.md 决策 1：同一份 config.json 只能一种 secretStore，DSH 走
// credential-ref，必须独立文件）。plugin.mjs 是纯 JS，不 import DSH 的 TS 包，
// 因此 DSH home 用 DSH_HOME 环境变量或 ~/.dsh 解析。
export function dshConfigFile(env = process.env, osHome = homedir()) {
  const home = env.DSH_HOME && String(env.DSH_HOME).trim()
    ? env.DSH_HOME
    : join(osHome, ".dsh");
  return env.JIRA_WORKBENCH_CONFIG_FILE
    || join(home, "jira-workbench", "config.json");
}

export const name = "jira-workbench";

export const inject = ["tools"];

// 宽松 JSON 输出 schema：core 工具的 structuredContent 是「每个工具不同 view
// 字段」的对象，无固定结构，用空 schema 声明「任意 JSON」。
const OPEN_JSON_OUTPUT_SCHEMA = {};

/**
 * 把一个 core 工具定义转换成 DSH 的 ToolDefinition。
 * core 工具面用 zod inputSchema，handler 返回 { structuredContent, content }；
 * DSH 需要 JSON Schema parameters + execute 返回 canonical value + render。
 */
function toToolDefinition(definition) {
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
      const result = await runWithAgent(exec?.agent, () => definition.handler(args));
      // canonical value = core handler 的返回（structuredContent + content 都保留，
      // render 只取 content 文本；structuredContent 通过 canonical value 传递）。
      return result ?? {};
    }
  };
}

export async function apply(ctx, config = {}) {
  // Token 存储：有 DSH credentials 服务就用 credential-ref 模式，否则回退
  // core 的 DPAPI 缺省。credentials 是可选服务（用 ctx.get 而非 inject，缺失
  // 时不阻塞插件激活）。
  const credentials = ctx.get("credentials");
  const secretStore = credentials
    ? createDshCredentialSecretStore(credentials)
    : undefined;

  // 审批：有 DSH approval 服务就用宿主审批栈，否则回退 core 的本地一次性
  // grant（独立服务缺省）。approval 也是可选服务。
  const approval = ctx.get("approval");
  const approvalProvider = approval
    ? createDshApprovalProvider(approval)
    : undefined;

  // 组装 core 服务（无 Codex 宿主能力，SVN 审查降级人工）。DSH 走独立
  // config 文件：baseUrl/看板配置存 DSH home 下，token 经 credential-ref 存
  // DSH credentials（见 dshConfigFile 与 createDshCredentialSecretStore）。
  const core = createCoreService({
    configFile: dshConfigFile(),
    version: config.version || "0.32.3",
    ...(secretStore ? { secretStore } : {}),
    ...(approvalProvider ? { approvalProvider } : {})
  });

  // 只注册 core 独立服务暴露的那部分工具：8 个 Jira + 11 个 SVN。
  // conversations/automation/updates/desktop 是 Codex 壳的宿主能力，DSH 侧不注入，
  // buildToolDefinitions 的条件注册会自然跳过它们。
  const definitions = buildToolDefinitions({
    service: core.jiraWorkbench,
    svn: core.svnWorkbench,
    ...(approvalProvider ? { approvalProvider } : {})
  });

  const tools = ctx.get("tools");
  if (!tools || typeof tools.register !== "function") {
    throw new Error("jira-workbench: ctx.tools 不可用，无法注册工具。");
  }

  const disposers = [];
  for (const definition of definitions) {
    disposers.push(tools.register(toToolDefinition(definition)));
  }

  // 所有副作用（工具注册）都在 fiber 生命周期内，stop 时统一移除。
  ctx.effect(() => {
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "jira-workbench.tools");
}
