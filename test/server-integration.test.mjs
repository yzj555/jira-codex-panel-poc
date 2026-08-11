import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function availablePort() {
  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  return port;
}

async function waitForServer(url, child, stderr) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`测试服务提前退出：${stderr.join("")}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待测试服务超时：${stderr.join("")}`);
}

test("本地 API 使用 DPAPI 保存配置并返回真实 Jira 数据", {
  skip: process.platform !== "win32",
  timeout: 20_000
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-integration-"));
  const configFile = join(directory, "config.json");
  const requests = [];
  let mockPort;
  const mockJira = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    requests.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.authorization,
      body: JSON.parse(bodyText || "{}")
    });
    if (request.url === "/rest/api/2/myself?expand=groups") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({
        key: "JIRAUSER1",
        name: "integration-user",
        groups: { items: [{ name: "jira-users" }] }
      }));
    }
    if (request.url === "/rest/api/2/project") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify([{
        id: "10101",
        key: "REAL",
        name: "真实项目",
        archived: false
      }]));
    }
    if (request.url === "/rest/api/2/field") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify([{
        id: "customfield_10600",
        name: "协同处理人",
        custom: true,
        searchable: true,
        orderable: true
      }]));
    }
    if (request.url === "/rest/api/2/project/10101") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({
        id: "10101",
        key: "REAL",
        name: "真实项目",
        archived: false
      }));
    }
    if (request.url === "/rest/api/2/project/10101/properties") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ keys: [{ key: "app.jxl.sheet.sheet-1" }] }));
    }
    if (request.url === "/rest/api/2/project/10101/properties/app.jxl.sheet.sheet-1") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({
        key: "app.jxl.sheet.sheet-1",
        value: {
          title: "集成测试 Sheet",
          scope: { type: "jql", value: "project = REAL ORDER BY updated DESC" },
          access: { default: "edit", rules: [] }
        }
      }));
    }
    if (request.method === "GET" && request.url === "/rest/api/2/issue/REAL-9/transitions?expand=transitions.fields") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({
        transitions: [{
          id: "21",
          name: "开始处理",
          to: { id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } },
          fields: {}
        }]
      }));
    }
    if (request.method === "GET" && request.url.startsWith("/rest/api/2/issue/REAL-9?fields=")) {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({
        id: "20001",
        key: "REAL-9",
        fields: {
          summary: "端到端真实任务",
          description: "来自单单详情接口的描述",
          issuetype: { name: "Story" },
          priority: { name: "Medium" },
          status: { name: "To Do", statusCategory: { key: "new" } },
          assignee: { displayName: "本地用户" },
          customfield_10600: [{ displayName: "协同用户", name: "helper", active: true }],
          attachment: [{
            id: "900",
            filename: "integration.txt",
            mimeType: "text/plain",
            size: 18,
            author: { displayName: "附件作者" }
          }],
          project: { key: "REAL", name: "真实项目" },
          updated: "2026-08-04T10:00:00.000+0800"
        }
      }));
    }
    if (request.method === "POST" && request.url === "/rest/api/2/issue/REAL-9/transitions") {
      response.writeHead(204);
      return response.end();
    }
    if (request.url === "/rest/api/2/attachment/900") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({
        id: "900",
        filename: "integration.txt",
        mimeType: "text/plain",
        content: `http://127.0.0.1:${mockPort}/secure/attachment/900/integration.txt`
      }));
    }
    if (request.url === "/secure/attachment/900/integration.txt") {
      response.writeHead(200, { "content-type": "text/plain", "content-length": "18" });
      return response.end("attachment-content");
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      total: 1,
      issues: [{
        id: "20001",
        key: "REAL-9",
        fields: {
          summary: "端到端真实任务",
          description: "来自 Data Center 的描述",
          issuetype: { name: "Story" },
          priority: { name: "Medium" },
          status: { name: "To Do", statusCategory: { key: "new" } },
          assignee: { displayName: "本地用户" },
          customfield_10600: [{ displayName: "协同用户", name: "helper", active: true }],
          attachment: [{
            id: "900",
            filename: "integration.txt",
            mimeType: "text/plain",
            size: 18,
            author: { displayName: "附件作者" }
          }],
          labels: ["integration"],
          project: { key: "REAL", name: "真实项目" },
          updated: "2026-08-04T10:00:00.000+0800"
        }
      }]
    }));
  });
  mockPort = await listen(mockJira);
  const panelPort = await availablePort();
  const stderr = [];
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    windowsHide: true,
    env: {
      ...process.env,
      JIRA_POC_PORT: String(panelPort),
      JIRA_CODEX_CONFIG_FILE: configFile
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));
  const baseUrl = `http://127.0.0.1:${panelPort}`;

  try {
    await waitForServer(`${baseUrl}/api/health`, child, stderr);
    const saveResponse = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deployment: "data_center",
        baseUrl: `http://127.0.0.1:${mockPort}`,
        token: "dpapi-integration-token",
        jql: "project = REAL",
        maxResults: 20
      })
    });
    assert.equal(saveResponse.status, 200, await saveResponse.text());

    const savedFile = await readFile(configFile, "utf8");
    assert.equal(savedFile.includes("dpapi-integration-token"), false);

    const publicPayload = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
    assert.equal(publicPayload.config.configured, true);
    assert.equal("token" in publicPayload.config, false);

    const importedBindings = await fetch(`${baseUrl}/api/bindings/import`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bindings: {
          "REAL-9": {
            threadId: "019fc6eb-2d03-7a62-be45-840481d26b19",
            title: "legacy renderer binding"
          }
        }
      })
    }).then((response) => response.json());
    assert.equal(importedBindings.revision, 1);
    assert.equal(importedBindings.bindings["REAL-9"].runtimeOwner, "legacy-desktop");

    const mutatedBindings = await fetch(`${baseUrl}/api/bindings/mutations`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deletes: ["REAL-9"],
        upserts: {
          "REAL-10": {
            threadId: "019fc6eb-2d03-7a62-be45-840481d26b20",
            runtimeOwner: "standalone-appserver",
            hostReference: "future-official-plugin"
          }
        }
      })
    }).then((response) => response.json());
    assert.equal(mutatedBindings.revision, 2);
    assert.equal("REAL-9" in mutatedBindings.bindings, false);
    assert.equal(mutatedBindings.bindings["REAL-10"].runtimeOwner, "standalone-appserver");

    const persistedBindings = await fetch(`${baseUrl}/api/bindings`).then((response) => response.json());
    assert.deepEqual(persistedBindings, mutatedBindings);

    const migrationBody = JSON.stringify({
      bindings: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [
        `REAL-${1_000 + index}`,
        {
          threadId: `thread-migrated-${index}`,
          legacyMetadata: "x".repeat(1_000)
        }
      ]))
    });
    assert.ok(Buffer.byteLength(migrationBody, "utf8") > 64 * 1_024);
    const migrationResponse = await fetch(`${baseUrl}/api/bindings/import`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: migrationBody
    });
    const migrationResponseText = await migrationResponse.text();
    assert.equal(migrationResponse.status, 200, migrationResponseText);
    const migratedBindings = JSON.parse(migrationResponseText);
    assert.equal(Object.keys(migratedBindings.bindings).length, 81);

    const runtimeCapabilities = await fetch(`${baseUrl}/api/codex/runtime/capabilities`)
      .then((response) => response.json());
    assert.equal(runtimeCapabilities.runtimeOwner, "standalone-appserver");
    assert.equal(runtimeCapabilities.capabilities.readThread, true);
    assert.equal(runtimeCapabilities.capabilities.navigateThread, false);

    const initialAutomation = await fetch(`${baseUrl}/api/automation/status`).then((response) => response.json());
    assert.equal(initialAutomation.monitorEnabled, false);
    assert.equal(initialAutomation.wecomConfigured, false);
    const enabledAutomation = await fetch(`${baseUrl}/api/automation/monitor`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true })
    }).then((response) => response.json());
    assert.equal(enabledAutomation.config.bugMonitorEnabled, true);
    assert.equal(enabledAutomation.config.monitorGeneration, 1);
    await fetch(`${baseUrl}/api/automation/monitor`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false })
    });

    const issuePayload = await fetch(`${baseUrl}/api/issues`).then((response) => response.json());
    assert.equal(issuePayload.issues[0].key, "REAL-9");
    assert.equal(issuePayload.issues[0].status, "todo");
    assert.equal(issuePayload.issues[0].type, "requirement");
    assert.equal(issuePayload.issues[0].summary, "来自 Data Center 的描述");
    assert.equal(issuePayload.issues[0].collaborators[0].displayName, "协同用户");
    assert.equal(issuePayload.issues[0].attachments[0].downloadUrl, "/api/attachments/900");

    const directIssuePayload = await fetch(`${baseUrl}/api/issues/REAL-9`).then((response) => response.json());
    assert.equal(directIssuePayload.issue.key, "REAL-9");
    assert.equal(directIssuePayload.issue.summary, "来自单单详情接口的描述");
    assert.equal(directIssuePayload.issue.collaborators[0].displayName, "协同用户");
    assert.equal(directIssuePayload.issue.attachments[0].filename, "integration.txt");

    const transitionsPayload = await fetch(`${baseUrl}/api/issues/REAL-9/transitions`).then((response) => response.json());
    assert.equal(transitionsPayload.transitions.length, 1);
    assert.equal(transitionsPayload.transitions[0].to.name, "In Progress");
    assert.equal(transitionsPayload.transitions[0].requiresInput, false);

    const transitionResponse = await fetch(`${baseUrl}/api/issues/REAL-9/transitions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transitionId: "21" })
    });
    const transitionedPayload = await transitionResponse.json();
    assert.equal(transitionResponse.status, 200, JSON.stringify(transitionedPayload));
    assert.equal(transitionedPayload.key, "REAL-9");
    assert.equal(transitionedPayload.transition.to.name, "In Progress");

    const sheetDirectory = await fetch(`${baseUrl}/api/jxl/sheets`).then((response) => response.json());
    assert.equal(sheetDirectory.total, 1);
    assert.equal(sheetDirectory.sheets[0].title, "集成测试 Sheet");
    assert.equal(sheetDirectory.sheets[0].projectKey, "REAL");

    const sheetIssues = await fetch(`${baseUrl}/api/jxl/sheets/10101/sheet-1/issues`).then((response) => response.json());
    assert.equal(sheetIssues.sheet.title, "集成测试 Sheet");
    assert.equal(sheetIssues.issues[0].key, "REAL-9");

    const attachmentResponse = await fetch(`${baseUrl}/api/attachments/900`);
    assert.equal(attachmentResponse.status, 200);
    assert.equal(attachmentResponse.headers.get("content-type"), "text/plain");
    assert.match(attachmentResponse.headers.get("content-disposition"), /integration\.txt/);
    assert.equal(await attachmentResponse.text(), "attachment-content");

    const materializedPayload = await fetch(`${baseUrl}/api/attachments/900/materialize`)
      .then((response) => response.json());
    assert.equal(materializedPayload.attachment.filename, "integration.txt");
    assert.equal(materializedPayload.attachment.mimeType, "text/plain");
    assert.equal(materializedPayload.attachment.size, 18);
    assert.equal(materializedPayload.attachment.cached, false);
    assert.equal(await readFile(materializedPayload.attachment.path, "utf8"), "attachment-content");

    const cachedPayload = await fetch(`${baseUrl}/api/attachments/900/materialize`)
      .then((response) => response.json());
    assert.equal(cachedPayload.attachment.path, materializedPayload.attachment.path);
    assert.equal(cachedPayload.attachment.cached, true);

    const searchRequests = requests.filter((request) => request.url === "/rest/api/2/search");
    assert.equal(searchRequests.length, 3);
    const transitionRequests = requests.filter((request) => request.url.includes("/rest/api/2/issue/REAL-9/transitions"));
    assert.equal(transitionRequests.length, 3);
    assert.deepEqual(transitionRequests[2].body, { transition: { id: "21" } });
    assert.equal(requests.filter((request) => request.url.startsWith("/rest/api/2/issue/REAL-9?fields=")).length, 1);
    assert.equal(requests.every((request) => request.authorization === "Bearer dpapi-integration-token"), true);
    assert.equal(searchRequests[2].body.jql, "project = REAL ORDER BY updated DESC");
    assert.equal(searchRequests[2].body.maxResults, 20);
  } finally {
    child.kill();
    await close(mockJira);
    await rm(directory, { recursive: true, force: true });
  }
});
