import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentCanOpenLocally,
  attachmentPreviewKind,
  filterAndSortSheetIssues,
  filterIssuesForView,
  splitIssuesByType,
  summarizeIssueViews
} from "../public/issue-views.js";

const issues = [
  {
    key: "CT-1",
    title: "需求待处理",
    summary: "仪表盘任务",
    projectName: "CT",
    status: "todo",
    statusName: "方案设计中",
    type: "requirement",
    assignee: "张三",
    collaborators: [],
    priority: "Medium",
    attachments: [],
    updated: "2026-08-01T10:00:00+08:00"
  },
  {
    key: "CT-2",
    title: "Bug 处理中",
    summary: "登录失败",
    projectName: "CT",
    status: "in_progress",
    statusName: "程序处理",
    type: "bug",
    assignee: "李四",
    collaborators: [{ displayName: "王五" }],
    priority: "High",
    attachments: [{ id: "1" }],
    updated: "2026-08-03T10:00:00+08:00"
  },
  {
    key: "CT-3",
    title: "历史需求",
    summary: "已经完成",
    projectName: "CT",
    status: "done",
    statusName: "完成",
    type: "requirement",
    assignee: "张三",
    collaborators: [],
    priority: "Low",
    attachments: [],
    updated: "2026-08-02T10:00:00+08:00"
  }
];

test("三个任务视图按活动状态与历史状态划分", () => {
  assert.deepEqual(filterIssuesForView(issues, "inbox").map((issue) => issue.key), ["CT-1", "CT-2"]);
  assert.deepEqual(filterIssuesForView(issues, "sheets").map((issue) => issue.key), ["CT-1", "CT-2", "CT-3"]);
  assert.deepEqual(filterIssuesForView(issues, "history").map((issue) => issue.key), ["CT-3"]);
  assert.deepEqual(summarizeIssueViews(issues), { inbox: 2, sheets: 3, history: 1 });
});

test("搜索覆盖协同处理人并保持需求与 Bug 两栏分组", () => {
  const matches = filterIssuesForView(issues, "sheets", "王五");
  assert.deepEqual(matches.map((issue) => issue.key), ["CT-2"]);
  assert.deepEqual(splitIssuesByType(issues), {
    requirements: [issues[0], issues[2]],
    bugs: [issues[1]]
  });
});

test("附件预览类型优先按 MIME，缺失时按扩展名识别", () => {
  assert.equal(attachmentPreviewKind({ mimeType: "image/png", filename: "capture.bin" }), "image");
  assert.equal(attachmentPreviewKind({ mimeType: "application/pdf", filename: "spec" }), "pdf");
  assert.equal(attachmentPreviewKind({ mimeType: "application/octet-stream", filename: "server.log" }), "text");
  assert.equal(attachmentPreviewKind({ mimeType: "", filename: "recording.mp4" }), "video");
  assert.equal(attachmentPreviewKind({ mimeType: "application/zip", filename: "source.zip" }), "");
  assert.equal(attachmentCanOpenLocally({ filename: "需求说明.docx" }), true);
  assert.equal(attachmentCanOpenLocally({ filename: "数据配置.xlsx" }), true);
  assert.equal(attachmentCanOpenLocally({ filename: "运行脚本.cmd" }), false);
  assert.equal(attachmentCanOpenLocally({ filename: "客户端.exe" }), false);
});

test("Sheets 支持组合列筛选", () => {
  assert.deepEqual(filterAndSortSheetIssues(issues, {
    filters: { type: "bug", attachments: "with", collaborators: "王五" }
  }).map((issue) => issue.key), ["CT-2"]);
  assert.deepEqual(filterAndSortSheetIssues(issues, {
    filters: { status: "完成", assignee: "张", updated: "08/02" }
  }).map((issue) => issue.key), ["CT-3"]);
  assert.deepEqual(filterAndSortSheetIssues(issues, {
    filters: { priority: "high" }
  }).map((issue) => issue.key), ["CT-2"]);
});

test("Sheets 表头排序支持升序、降序和原顺序", () => {
  const withNaturalKey = [...issues, { ...issues[0], key: "CT-10", title: "后续需求" }];
  assert.deepEqual(filterAndSortSheetIssues(withNaturalKey).map((issue) => issue.key), ["CT-1", "CT-2", "CT-3", "CT-10"]);
  assert.deepEqual(filterAndSortSheetIssues(withNaturalKey, {
    sort: { column: "issue", direction: "asc" }
  }).map((issue) => issue.key), ["CT-1", "CT-2", "CT-3", "CT-10"]);
  assert.deepEqual(filterAndSortSheetIssues(issues, {
    sort: { column: "updated", direction: "desc" }
  }).map((issue) => issue.key), ["CT-2", "CT-3", "CT-1"]);
});
