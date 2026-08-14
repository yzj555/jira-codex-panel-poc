import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutomationManager } from "../lib/automation-manager.mjs";
import { createBugMonitorService } from "../lib/bug-monitor-service.mjs";
import { createIssueBindingStore } from "../lib/issue-binding-store.mjs";

function bug(key, title = key) {
  return {
    key,
    title,
    summary: `描述 ${title}`,
    url: `http://jira.example/browse/${key}`,
    type: "bug",
    typeName: "Bug",
    status: "todo",
    statusName: "待处理",
    attachments: [{ id: `${key}-image`, filename: "evidence.png", mimeType: "image/png" }]
  };
}

async function harness(directory, {
  issues = [bug("CT-101", "自动分析")],
  runtimeStart,
  monitorGeneration = 1,
  intervalMs = 60_000,
  retryBaseMs = 1,
  maxAnalysisRuntimeMs,
  loadIssueContext = async (issue) => issue,
  now
} = {}) {
  const config = {
    configured: true,
    token: "token",
    bugMonitorEnabled: true,
    monitorGeneration,
    codexProjectId: "project-1",
    codexProjectLabel: "测试项目",
    promptTemplates: {
      bug: {
        content: "请给出简洁诊断。",
        skill: { name: "ct-devops-tracer", path: "C:\\old-user\\ct-devops-tracer\\SKILL.md" }
      }
    },
    wecomWebhook: ""
  };
  const starts = [];
  const runtime = {
    listSkills: async () => ({
      data: [{
        skills: [{
          name: "ct-devops-tracer",
          path: "C:\\current-user\\ct-devops-tracer\\SKILL.md",
          enabled: true
        }]
      }]
    }),
    startReadOnlyAnalysis: async (options) => {
      starts.push(options);
      if (runtimeStart) return runtimeStart(options, starts.length);
      return { threadId: `thread-${starts.length}`, turnId: `turn-${starts.length}` };
    },
    readTurnResult: async () => ({ status: "running" })
  };
  const configStore = { load: async () => config };
  const automation = createAutomationManager({
    stateFile: join(directory, "automation.json"),
    configStore,
    turnReader: runtime,
    pollIntervalMs: 60_000
  });
  const bindings = createIssueBindingStore({ file: join(directory, "bindings.json") });
  const monitor = createBugMonitorService({
    stateFile: join(directory, "bug-monitor.json"),
    configStore,
    loadIssues: async () => ({ issues }),
    loadIssueContext,
    issueBindings: bindings,
    runtime,
    automationManager: automation,
    prepareAttachments: async () => [{ path: "C:\\cache\\evidence.png", mimeType: "image/png" }],
    resolveWorkspace: async () => "F:\\repo",
    fallbackSkill: { name: "jira-first-turn-analysis", path: "C:\\app\\jira-first-turn-analysis\\SKILL.md" },
    intervalMs,
    retryBaseMs,
    maxRetryMs: retryBaseMs,
    ...(maxAnalysisRuntimeMs === undefined ? {} : { maxAnalysisRuntimeMs }),
    ...(now === undefined ? {} : { now })
  });
  return { monitor, automation, bindings, starts, config };
}

test("本地 Bug 监控独立创建 App Server 会话并持久化真实 threadId/turnId", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-bug-monitor-"));
  try {
    const first = await harness(directory);
    await first.monitor.poll();

    assert.equal(first.starts.length, 1);
    assert.match(first.starts[0].message, /Jira Bug/);
    assert.match(first.starts[0].message, /触发方式：Jira Bug 自动监控/);
    assert.deepEqual(first.starts[0].skills.map((skill) => skill.name), ["ct-devops-tracer"]);
    assert.equal(first.starts[0].skills[0].path, "C:\\current-user\\ct-devops-tracer\\SKILL.md");
    assert.doesNotMatch(first.starts[0].message, /请给出简洁诊断/);
    assert.equal(first.starts[0].cwd, "F:\\repo");
    assert.deepEqual(first.starts[0].attachments, [{
      path: "C:\\cache\\evidence.png",
      mimeType: "image/png"
    }]);

    const status = await first.monitor.getStatus();
    assert.equal(status.monitorOwner, "local-service");
    assert.equal(status.queueLength, 0);
    assert.equal(status.activeJob.threadId, "local:thread-1");
    assert.equal(status.activeJob.turnId, "turn-1");
    assert.equal(status.activeJob.completionTracking, "app-server");
    assert.equal(status.activeJob.monitorGeneration, 1);

    const bindingState = await first.bindings.snapshot();
    assert.equal(bindingState.bindings["CT-101"].threadId, "local:thread-1");
    assert.equal(bindingState.bindings["CT-101"].analysisTurnId, "turn-1");
    assert.equal(bindingState.bindings["CT-101"].runtimeOwner, "standalone-appserver");
    const workspace = bindingState.bindings["CT-101"].workspace;
    assert.deepEqual(workspace, {
      cwd: "F:\\repo",
      workspaceRoots: ["F:\\repo"],
      projectId: "project-1",
      projectLabel: "测试项目",
      kind: "project",
      source: "bug-monitor-app-server",
      observedAt: workspace.observedAt,
      projectScopes: [{
        id: "project:project-1",
        cwd: "F:\\repo",
        workspaceRoots: ["F:\\repo"],
        projectId: "project-1",
        projectLabel: "测试项目",
        kind: "project",
        source: "bug-monitor-app-server",
        observedAt: workspace.observedAt
      }],
      defaultProjectScopeId: "project:project-1"
    });

    const restarted = await harness(directory);
    await restarted.monitor.poll();
    assert.equal(restarted.starts.length, 0, "重启后不得为同一 Bug 创建重复会话");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("自动 Bug 分析在创建会话前补齐父子单上下文", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-bug-monitor-parent-"));
  try {
    const instance = await harness(directory, {
      issues: [{ ...bug("CT-151"), parent: { key: "CT-100", title: "父级需求" } }],
      loadIssueContext: async (issue) => ({
        ...issue,
        parentIssue: {
          key: "CT-100",
          title: "父级需求",
          summary: "父单中的完整业务规则",
          url: "http://jira.example/browse/CT-100",
          attachments: []
        },
        parentContext: { status: "available", key: "CT-100", message: "" }
      })
    });
    await instance.monitor.poll();
    assert.equal(instance.starts.length, 1);
    assert.match(instance.starts[0].message, /父级关联单（需求上下文）/);
    assert.match(instance.starts[0].message, /父单中的完整业务规则/);
    assert.match(instance.starts[0].message, /当前执行单 CT-151 的范围/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("单个 Bug 启动失败会退避并让后续队列继续执行", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-bug-monitor-recovery-"));
  try {
    const instance = await harness(directory, {
      issues: [bug("CT-201"), bug("CT-202")],
      runtimeStart: async (_options, call) => {
        if (call === 1) throw new Error("temporary App Server failure");
        return { threadId: `thread-${call}`, turnId: `turn-${call}` };
      },
      retryBaseMs: 60_000
    });
    await instance.monitor.poll();
    let status = await instance.monitor.getStatus();
    assert.equal(status.queueLength, 2);
    assert.equal(status.queue.at(-1).issueKey, "CT-201");
    assert.match(status.queue.at(-1).lastError, /temporary App Server failure/);

    await instance.monitor.poll();
    status = await instance.monitor.getStatus();
    assert.equal(instance.starts.length, 2);
    assert.equal(status.activeJob.issueKey, "CT-202");
    assert.equal(status.queueLength, 1);
    assert.equal(status.queue[0].issueKey, "CT-201");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("服务启动后按持久配置立即运行，不依赖面板页面", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-bug-monitor-startup-"));
  try {
    const instance = await harness(directory, { intervalMs: 60_000 });
    instance.monitor.start();
    for (let attempt = 0; attempt < 50 && instance.starts.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await instance.monitor.stop();
    assert.equal(instance.starts.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("失联的长时间分析会自动释放，不会永久阻塞后续 Bug", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-bug-monitor-stale-"));
  let currentTime = Date.parse("2026-08-12T10:00:00.000Z");
  try {
    const instance = await harness(directory, {
      issues: [bug("CT-401"), bug("CT-402")],
      maxAnalysisRuntimeMs: 1_000,
      now: () => currentTime
    });
    await instance.monitor.poll();
    assert.equal((await instance.monitor.getStatus()).activeJob.issueKey, "CT-401");
    currentTime += 1_001;
    await instance.monitor.poll();
    const status = await instance.monitor.getStatus();
    assert.equal(status.activeJob.issueKey, "CT-402");
    assert.equal(status.recentJobs.find((job) => job.issueKey === "CT-401").status, "failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("旧注入层监控状态可一次性合并，但服务调度不依赖该迁移", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-bug-monitor-legacy-"));
  try {
    const instance = await harness(directory, { issues: [] });
    let status = await instance.monitor.importLegacyState({
      generation: 7,
      seen: ["CT-301"],
      queue: ["CT-302"]
    });
    assert.ok(status.legacyImportCompletedAt);
    assert.deepEqual(status.queue.map((item) => item.issueKey), ["CT-302"]);
    status = await instance.monitor.importLegacyState({ queue: ["CT-303"] });
    assert.deepEqual(status.queue.map((item) => item.issueKey), ["CT-302"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
