import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COLLABORATION_DEFAULT_JQL,
  createConfigStore,
  DASHBOARD_ACTIVE_JQL,
  DEFAULT_JQL,
  DEFAULT_MESSAGE_TEMPLATE,
  LEGACY_DEFAULT_JQL
} from "../config-store.mjs";

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
    assert.equal(publicConfig.bugMonitorEnabled, false);
    assert.equal(publicConfig.wecomConfigured, true);
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

    assert.equal((await store.getPublic()).jql, DEFAULT_JQL);
    assert.equal((await store.getPublic()).messageTemplate, DEFAULT_MESSAGE_TEMPLATE);
    assert.equal((await store.load()).jql, DEFAULT_JQL);

    await writeFile(configFile, JSON.stringify({
      version: 1,
      deployment: "cloud",
      baseUrl: "https://demo.atlassian.net",
      email: "user@example.com",
      jql: COLLABORATION_DEFAULT_JQL,
      maxResults: 100,
      tokenProtected: await protect("token")
    }), "utf8");
    assert.equal((await store.getPublic()).jql, DEFAULT_JQL);

    await writeFile(configFile, JSON.stringify({
      version: 1,
      deployment: "cloud",
      baseUrl: "https://demo.atlassian.net",
      email: "user@example.com",
      jql: DASHBOARD_ACTIVE_JQL,
      maxResults: 100,
      tokenProtected: await protect("token")
    }), "utf8");
    assert.equal((await store.getPublic()).jql, DEFAULT_JQL);

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
