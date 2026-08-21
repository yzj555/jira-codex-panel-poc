import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { canViewJxlSheet, createJxlClient } from "../jxl-client.mjs";

const config = {
  deployment: "data_center",
  baseUrl: "https://jira.example.com",
  token: "data-center-pat"
};

const currentUser = {
  key: "JIRAUSER1",
  name: "tester",
  groups: { items: [{ name: "CT-项目组" }] }
};

function chunkSheet(value) {
  const content = gzipSync(Buffer.from(JSON.stringify(value), "utf8")).toString("base64");
  const split = Math.ceil(content.length / 2);
  return [
    { part: 1, total: 2, compression: "gzip", content: content.slice(0, split), signature: "same-signature" },
    { part: 2, total: 2, compression: "gzip", content: content.slice(split), signature: "same-signature" }
  ];
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("JXL Directory 从项目属性读取真实 Sheet、解压分块并过滤访问权限", async () => {
  const chunked = chunkSheet({
    title: "分块 Sheet",
    scope: { type: "jql", value: "project = CT ORDER BY updated DESC" },
    access: {
      default: "none",
      rules: [{ access: "view", holder: { type: "group", id: "CT-项目组" } }]
    },
    lastUpdatedDate: 1785801600000
  });
  const properties = {
    "app.jxl.sheet.public": {
      title: "公开 Sheet",
      scope: { type: "jql", value: "project = CT AND statusCategory != Done" },
      access: { default: "edit", rules: [] }
    },
    "app.jxl.sheet.private": {
      title: "其他人的私有 Sheet",
      scope: { type: "jql", value: "project = SECRET" },
      access: {
        default: "none",
        rules: [{ access: "edit", holder: { type: "user", id: "JIRAUSER9" } }]
      }
    },
    "app.jxl.sheet.modern": {
      title: "新版权限 Sheet",
      scope: { type: "jql", value: "project = CT AND labels = modern" },
      access: {
        default: { sheetAccess: "edit", issueAccess: "edit", issueCreate: true },
        rules: []
      }
    },
    "app.jxl.sheet.chunked": chunked[0],
    "app.jxl.sheet.chunked.2": chunked[1]
  };
  const calls = [];
  const client = createJxlClient({
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      calls.push({ path: `${url.pathname}${url.search}`, authorization: options.headers.authorization });
      if (`${url.pathname}${url.search}` === "/rest/api/2/myself?expand=groups") return json(currentUser);
      if (url.pathname === "/rest/api/2/project") {
        return json([{ id: "10101", key: "CT", name: "足球小将", archived: false }]);
      }
      if (url.pathname === "/rest/api/2/project/10101") {
        return json({ id: "10101", key: "CT", name: "足球小将", archived: false });
      }
      if (url.pathname === "/rest/api/2/project/10101/properties") {
        return json({
          keys: ["public", "private", "modern", "chunked"].map((id) => ({ key: `app.jxl.sheet.${id}` }))
        });
      }
      const propertyPrefix = "/rest/api/2/project/10101/properties/";
      if (url.pathname.startsWith(propertyPrefix)) {
        const key = decodeURIComponent(url.pathname.slice(propertyPrefix.length));
        return key in properties ? json({ key, value: properties[key] }) : json({}, 404);
      }
      return json({ errorMessages: ["unexpected request"] }, 500);
    }
  });

  const directory = await client.listSheets(config);
  assert.equal(directory.total, 3);
  assert.deepEqual(new Set(directory.sheets.map((sheet) => sheet.title)), new Set(["公开 Sheet", "新版权限 Sheet", "分块 Sheet"]));
  assert.equal(directory.sheets.some((sheet) => sheet.title.includes("私有")), false);
  const decoded = directory.sheets.find((sheet) => sheet.id === "chunked");
  assert.equal(decoded.queryable, true);
  assert.equal(decoded.projectKey, "CT");
  assert.equal(decoded.url, "https://jira.example.com/projects/CT?selectedItem=app.jxl:sheets#s/chunked");
  assert.equal(decoded.directoryUrl, "https://jira.example.com/secure/JXLDirectory.jspa");
  assert.equal(calls.every((call) => call.authorization === "Bearer data-center-pat"), true);
  assert.equal(calls.some((call) => call.path.endsWith("app.jxl.sheet.chunked.2")), true);

  const sheet = await client.getSheet(config, { projectId: "10101", sheetId: "chunked" });
  assert.equal(sheet._scope.value, "project = CT ORDER BY updated DESC");
  assert.equal(await client.getSheet(config, { projectId: "10101", sheetId: "private" }), null);
});

test("JXL 访问规则与 Data Center 用户 key、用户名和用户组匹配", () => {
  assert.equal(canViewJxlSheet({ access: { default: "edit", rules: [] } }, currentUser), true);
  assert.equal(canViewJxlSheet({ access: { default: "view", rules: [] } }, currentUser), true);
  assert.equal(canViewJxlSheet({
    access: { default: { sheetAccess: "edit", issueAccess: "edit", issueCreate: true }, rules: [] }
  }, currentUser), true);
  assert.equal(canViewJxlSheet({
    access: { default: { sheetAccess: "view", issueAccess: "view", issueCreate: false }, rules: [] }
  }, currentUser), true);
  assert.equal(canViewJxlSheet({
    access: { default: { sheetAccess: "none", issueAccess: "view", issueCreate: false }, rules: [] }
  }, currentUser), false);
  assert.equal(canViewJxlSheet({
    access: { default: "none", rules: [{ access: "edit", holder: { type: "user", id: "tester" } }] }
  }, currentUser), true);
  assert.equal(canViewJxlSheet({
    access: { default: "none", rules: [{ access: "view", holder: { type: "group", id: "CT-项目组" } }] }
  }, currentUser), true);
  assert.equal(canViewJxlSheet({
    access: { default: "none", rules: [{ access: "view", holder: { type: "user", id: "someone-else" } }] }
  }, currentUser), false);
});
