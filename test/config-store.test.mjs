import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COLLABORATION_DEFAULT_JQL,
  createConfigStore,
  DASHBOARD_ACTIVE_JQL,
  DEFAULT_BUG_MESSAGE_TEMPLATE,
  DEFAULT_MESSAGE_TEMPLATE,
  DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE,
  LEGACY_DEFAULT_JQL
} from "../config-store.mjs";
import {
  HISTORICAL_DEFAULT_MESSAGE_TEMPLATE,
  LEGACY_DEFAULT_MESSAGE_TEMPLATE
} from "../public/prompt-builder.js";

test("配置固定为 Data Center，文件只保存受保护 Token，公开配置不返回 Token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-config-"));
  const configFile = join(directory, "config.json");
  const protect = async (value) => Buffer.from([...value].reverse().join(""), "utf8").toString("base64");
  const unprotect = async (value) => [...Buffer.from(value, "base64").toString("utf8")].reverse().join("");
  const store = createConfigStore({ configFile, protect, unprotect });

  try {
    const candidate = await store.prepare({
      deployment: "cloud",
      baseUrl: "https://demo.atlassian.net/",
      email: "user@example.com",
      codexProjectId: "local-project-1",
      codexProjectLabel: "server-project",
      token: "secret-token-value",
      wecomWebhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=11111111-2222-3333-4444-555555555555",
      jql: "project = DEMO",
      messageTemplate: "处理 {{key}}",
      maxResults: 42
    });
    await store.save(candidate);

    const raw = await readFile(configFile, "utf8");
    assert.equal(raw.includes("secret-token-value"), false);
    assert.equal(raw.includes("qyapi.weixin.qq.com"), false);
    assert.equal(raw.includes("tokenProtected"), true);

    const publicConfig = await store.getPublic();
    assert.equal(publicConfig.configured, true);
    assert.equal(publicConfig.deployment, "data_center");
    assert.equal(publicConfig.email, "");
    assert.equal(publicConfig.codexProjectId, "local-project-1");
    assert.equal(publicConfig.codexProjectLabel, "server-project");
    assert.equal(publicConfig.messageTemplate, "处理 {{key}}");
    assert.equal(publicConfig.promptTemplates.requirement.content, "处理 {{key}}");
    assert.equal(publicConfig.promptTemplates.bug.content, "处理 {{key}}");
    assert.equal(publicConfig.promptTemplates.requirement.customized, true);
    assert.equal(publicConfig.promptTemplates.bug.customized, true);
    assert.equal(publicConfig.promptTemplates.bug.skill, null);
    assert.equal(publicConfig.bugMonitorEnabled, false);
    assert.equal(publicConfig.wecomConfigured, true);
    assert.deepEqual(publicConfig.syncSettings, {
      tasksEnabled: true,
      taskIntervalSeconds: 60,
      syncOnPanelReturn: true,
      sheetsIntervalSeconds: 300
    });
    assert.equal("token" in publicConfig, false);
    assert.equal(publicConfig.baseUrl, "https://demo.atlassian.net");

    const preserved = await store.prepare({
      deployment: "cloud",
      baseUrl: "https://demo.atlassian.net",
      email: "user@example.com",
      codexProjectId: "",
      codexProjectLabel: "ignored-project",
      token: "",
      jql: "project = OTHER",
      messageTemplate: "",
      maxResults: 10
    });
    assert.equal(preserved.deployment, "data_center");
    assert.equal(preserved.email, "");
    assert.equal(preserved.codexProjectId, "");
    assert.equal(preserved.codexProjectLabel, "");
    assert.equal(preserved.messageTemplate, DEFAULT_MESSAGE_TEMPLATE);
    assert.equal(preserved.promptTemplates.requirement.content, DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE);
    assert.equal(preserved.promptTemplates.bug.content, DEFAULT_BUG_MESSAGE_TEMPLATE);
    assert.equal(preserved.token, "secret-token-value");
    assert.match(preserved.wecomWebhook, /^https:\/\/qyapi\.weixin\.qq\.com\//);

    const enabled = await store.setBugMonitorEnabled(true);
    assert.equal(enabled.bugMonitorEnabled, true);
    assert.equal(enabled.monitorGeneration, 1);
    assert.equal((await store.setBugMonitorEnabled(true)).monitorGeneration, 1);
    await store.setBugMonitorEnabled(false);
    assert.equal((await store.setBugMonitorEnabled(true)).monitorGeneration, 2);
  } finally {
    await store.clear();
    await rm(directory, { recursive: true, force: true });
  }
});

test("数据同步配置使用安全默认值并只接受支持的频率", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-sync-"));
  const configFile = join(directory, "config.json");
  const protect = async (value) => Buffer.from(value, "utf8").toString("base64");
  const unprotect = async (value) => Buffer.from(value, "base64").toString("utf8");
  const store = createConfigStore({ configFile, protect, unprotect });

  try {
    const candidate = await store.prepare({
      baseUrl: "http://jira.example:8080",
      token: "token",
      syncSettings: {
        tasksEnabled: false,
        taskIntervalSeconds: 31,
        syncOnPanelReturn: false,
        sheetsIntervalSeconds: 0
      }
    });
    assert.deepEqual(candidate.syncSettings, {
      tasksEnabled: false,
      taskIntervalSeconds: 60,
      syncOnPanelReturn: false,
      sheetsIntervalSeconds: 0
    });
    await store.save(candidate);
    const raw = JSON.parse(await readFile(configFile, "utf8"));
    assert.deepEqual(raw.syncSettings, candidate.syncSettings);

    const preserved = await store.prepare({ baseUrl: "http://jira.example:8080", token: "" });
    assert.deepEqual(preserved.syncSettings, candidate.syncSettings);
  } finally {
    await store.clear();
    await rm(directory, { recursive: true, force: true });
  }
});

test("旧版默认 JQL 自动迁移到 CT 仪表盘筛选器，自定义 JQL 不受影响", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-migration-"));
  const configFile = join(directory, "config.json");
  const protect = async (value) => Buffer.from(value, "utf8").toString("base64");
  const unprotect = async (value) => Buffer.from(value, "base64").toString("utf8");
  const store = createConfigStore({ configFile, protect, unprotect });

  try {
    await writeFile(configFile, JSON.stringify({
      version: 1,
      deployment: "cloud",
      baseUrl: "https://demo.atlassian.net",
      email: "user@example.com",
      jql: LEGACY_DEFAULT_JQL,
      maxResults: 100,
      tokenProtected: await protect("token")
    }), "utf8");

    assert.equal((await store.getPublic()).jql, "");
    assert.equal((await store.getPublic()).boardSources.projectKey, "CT");
    assert.equal((await store.getPublic()).messageTemplate, DEFAULT_MESSAGE_TEMPLATE);
    assert.equal((await store.load()).jql, "");

    await writeFile(configFile, JSON.stringify({
      version: 1,
      deployment: "cloud",
      baseUrl: "https://demo.atlassian.net",
      email: "user@example.com",
      jql: COLLABORATION_DEFAULT_JQL,
      maxResults: 100,
      tokenProtected: await protect("token")
    }), "utf8");
    assert.equal((await store.getPublic()).jql, "");

    await writeFile(configFile, JSON.stringify({
      version: 1,
      deployment: "cloud",
      baseUrl: "https://demo.atlassian.net",
      email: "user@example.com",
      jql: DASHBOARD_ACTIVE_JQL,
      maxResults: 100,
      tokenProtected: await protect("token")
    }), "utf8");
    assert.equal((await store.getPublic()).jql, "");

    const custom = await store.prepare({
      deployment: "cloud",
      baseUrl: "https://demo.atlassian.net",
      email: "user@example.com",
      jql: "project = DEMO",
      maxResults: 100
    });
    assert.equal(custom.jql, "project = DEMO");
  } finally {
    await store.clear();
    await rm(directory, { recursive: true, force: true });
  }
});

test("需求与 Bug 模板、技能独立保存，系统默认正文不固化到配置文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-templates-"));
  const configFile = join(directory, "config.json");
  const protect = async (value) => Buffer.from(value, "utf8").toString("base64");
  const unprotect = async (value) => Buffer.from(value, "base64").toString("utf8");
  const store = createConfigStore({ configFile, protect, unprotect });

  try {
    const candidate = await store.prepare({
      baseUrl: "http://jira.example:8080",
      token: "token",
      jql: "project = CT",
      maxResults: 100,
      promptTemplates: {
        requirement: {
          customized: false,
          content: "不会保存的旧正文",
          skill: null
        },
        bug: {
          customized: true,
          content: "诊断 {{key}}：{{description}}",
          skill: { name: "custom-bug-skill", path: "C:\\skills\\bug\\SKILL.md", scope: "user" }
        }
      }
    });
    const publicConfig = await store.save(candidate);
    assert.equal(publicConfig.promptTemplates.requirement.content, DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE);
    assert.equal(publicConfig.promptTemplates.requirement.skill, null);
    assert.equal(publicConfig.promptTemplates.bug.content, "诊断 {{key}}：{{description}}");
    assert.equal(publicConfig.promptTemplates.bug.skill.name, "custom-bug-skill");

    const record = JSON.parse(await readFile(configFile, "utf8"));
    assert.equal(record.version, 3);
    assert.equal("content" in record.promptTemplates.requirement, false);
    assert.equal(record.promptTemplates.bug.content, "诊断 {{key}}：{{description}}");
    assert.equal("messageTemplate" in record, false);
  } finally {
    await store.clear();
    await rm(directory, { recursive: true, force: true });
  }
});

test("旧版内置消息模板迁移为新的需求与 Bug 系统默认模板", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-template-migration-"));
  const configFile = join(directory, "config.json");
  const protect = async (value) => Buffer.from(value, "utf8").toString("base64");
  const unprotect = async (value) => Buffer.from(value, "base64").toString("utf8");
  const store = createConfigStore({ configFile, protect, unprotect });

  try {
    await writeFile(configFile, JSON.stringify({
      version: 2,
      baseUrl: "http://jira.example:8080",
      jql: "project = CT",
      messageTemplate: LEGACY_DEFAULT_MESSAGE_TEMPLATE,
      maxResults: 100,
      tokenProtected: await protect("token")
    }), "utf8");
    const config = await store.getPublic();
    assert.equal(config.promptTemplates.requirement.customized, false);
    assert.equal(config.promptTemplates.bug.customized, false);
    assert.equal(config.promptTemplates.requirement.content, DEFAULT_REQUIREMENT_MESSAGE_TEMPLATE);
    assert.equal(config.promptTemplates.bug.content, DEFAULT_BUG_MESSAGE_TEMPLATE);

    await writeFile(configFile, JSON.stringify({
      version: 2,
      baseUrl: "http://jira.example:8080",
      jql: "project = CT",
      messageTemplate: HISTORICAL_DEFAULT_MESSAGE_TEMPLATE,
      maxResults: 100,
      tokenProtected: await protect("token")
    }), "utf8");
    const historicalConfig = await store.getPublic();
    assert.equal(historicalConfig.promptTemplates.requirement.customized, false);
    assert.equal(historicalConfig.promptTemplates.bug.customized, false);
  } finally {
    await store.clear();
    await rm(directory, { recursive: true, force: true });
  }
});

test("新配置不携带旧项目、旧 Filter、站点协同字段或外部 Bug Skill 默认值", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-clean-defaults-"));
  const configFile = join(directory, "config.json");
  const store = createConfigStore({
    configFile,
    protect: async (value) => Buffer.from(value, "utf8").toString("base64"),
    unprotect: async (value) => Buffer.from(value, "base64").toString("utf8")
  });
  try {
    const config = await store.prepare({ baseUrl: "http://jira.example:8080", token: "token" });
    assert.equal(config.jql, "");
    assert.equal(config.boardSources.projectKey, "");
    assert.equal(config.boardSources.collaboratorFieldId, "");
    assert.equal(config.boardSources.collaboratorJqlName, "");
    assert.equal(config.boardSources.requirement.mode, "builtin");
    assert.equal(config.boardSources.bug.mode, "builtin");
    assert.equal(config.promptTemplates.bug.skill, null);
  } finally {
    await store.clear();
    await rm(directory, { recursive: true, force: true });
  }
});
