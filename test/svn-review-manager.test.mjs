import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSvnCommitMessage,
  createSvnReviewManager,
  normalizeSvnRelativePath,
  parseSvnInfoXml,
  parseSvnLogXml,
  parseSvnReviewResult,
  parseSvnStatusXml,
  SvnReviewError
} from "../lib/svn-review-manager.mjs";

const workingCopyRoot = "F:\\football\\server_v3";
const issue = {
  key: "CT-13349",
  type: "requirement",
  title: "【系统】优化3.0-护具-护具优化",
  summary: "完成护具升级材料筛选及金币返还逻辑调整。",
  url: "http://ctjira1.lmdgame.com:8080/browse/CT-13349",
  projectName: "足球小将",
  fixVersions: ["DevelopV4"]
};

const infoXml = `<?xml version="1.0"?>
<info><entry kind="dir" path="." revision="120">
<url>svn://example/server_v3</url>
<repository><root>svn://example</root><uuid>uuid</uuid></repository>
<wc-info><wcroot-abspath>${workingCopyRoot}</wcroot-abspath></wc-info>
</entry></info>`;

const statusXml = `<?xml version="1.0"?>
<status><target path=".">
<entry path="src/player.go"><wc-status item="modified" revision="120" props="none"></wc-status></entry>
</target></status>`;

const fileInfoXml = `<?xml version="1.0"?>
<info><entry kind="file" path="src/player.go" revision="120">
<url>svn://example/server_v3/src/player.go</url>
<repository><root>svn://example</root></repository>
</entry></info>`;

function semanticResult(reviewId, verdict = "pass", snapshotHash = "") {
  return `审核完成。\nSVN_REVIEW_RESULT_V1\n${JSON.stringify({
    reviewId,
    snapshotHash,
    verdict,
    summary: "改动与需求一致。",
    requirements: [{ requirement: "恢复状态", status: "covered", evidence: "src/player.go" }],
    fileChanges: [{ path: "src/player.go", assessment: "补充状态恢复逻辑。" }],
    risks: [],
    impactAnalysis: [{ area: "调用方", severity: "low", evidence: "调用关系未变", assessment: "无额外影响" }],
    callChainAnalysis: [{
      symbol: "restoreState",
      callers: ["handleRequest"],
      callees: ["saveState"],
      assessment: "调用链行为保持一致",
      evidence: "src/player.go"
    }],
    unverifiedAreas: [],
    requirementMatch: { status: "match", explanation: "覆盖 Jira 描述。" },
    compliance: { status: "pass", explanation: "未发现违规。" },
    regressions: [],
    tests: { status: "passed", details: "相关单元测试通过。" },
    recommendations: []
  })}`;
}

function createHarness({
  workingRoot = workingCopyRoot,
  cwd = workingRoot,
  workspaceRoots = [cwd],
  touchedFiles = [],
  reviewArtifactsRoot = "",
  reviewStateFile = "",
  findReviewTurn = null,
  externalDiffLauncher = null,
  commitLogMode: initialCommitLogMode = "record",
  commitLogMessageTransform = (value) => value,
  now = () => Date.now()
} = {}) {
  const calls = [];
  let completion = null;
  let diff = "Index: src/player.go\n===================================================================\n--- src/player.go\n+++ src/player.go\n@@ -1 +1 @@\n-old\n+new\n";
  let status = statusXml;
  let fileInfo = fileInfoXml;
  let commitLogMode = initialCommitLogMode;
  const logEntries = [];
  const escapeXml = (value) => String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const logXml = () => `<?xml version="1.0"?><log>${logEntries.map((entry) => `
    <logentry revision="${entry.revision}">
      <author>${escapeXml(entry.author)}</author>
      <date>${escapeXml(entry.date)}</date>
      <paths>${entry.paths.map((path) => `<path action="M">/${escapeXml(path)}</path>`).join("")}</paths>
      <msg>${escapeXml(entry.message)}</msg>
    </logentry>`).join("")}</log>`;
  const commandRunner = async ({ command, args, cwd }) => {
    calls.push({ command, args: [...args], cwd });
    if (command === "svnversion") return { exitCode: 0, stdout: "120M\n", stderr: "" };
    if (args[0] === "info" && args.includes("--show-item")) {
      return { exitCode: 0, stdout: `${workingRoot}\n`, stderr: "" };
    }
    if (args[0] === "info" && args.includes("--depth")) {
      return { exitCode: 0, stdout: fileInfo, stderr: "" };
    }
    if (args[0] === "info") {
      return { exitCode: 0, stdout: infoXml.replace(workingCopyRoot, workingRoot), stderr: "" };
    }
    if (args[0] === "status") return { exitCode: 0, stdout: status, stderr: "" };
    if (args[0] === "diff") return { exitCode: 0, stdout: diff, stderr: "" };
    if (args[0] === "commit") {
      const messageFile = args[args.indexOf("--file") + 1];
      const revision = String(121 + logEntries.length);
      const entry = {
        revision,
        author: "tester",
        date: new Date(now()).toISOString(),
        message: commitLogMessageTransform((await readFile(messageFile, "utf8")).trim()),
        paths: args.slice(args.indexOf("--") + 1)
      };
      if (commitLogMode === "record") logEntries.unshift(entry);
      return { exitCode: 0, stdout: `Committed revision ${revision}.\n`, stderr: "" };
    }
    if (args[0] === "log") return { exitCode: 0, stdout: logXml(), stderr: "" };
    throw new Error(`未模拟命令：${command} ${args.join(" ")}`);
  };
  const sessionReader = {
    readContext: async () => ({ cwd, workspaceRoots }),
    readReviewTurn: async () => completion,
    findReviewTurn: async (options) => typeof findReviewTurn === "function" ? findReviewTurn(options) : null,
    readConversationContext: async () => ({ markdown: "## 用户需求\n\n恢复状态", total: 1, omitted: 0 }),
    readTouchedFiles: async () => touchedFiles
  };
  const createManager = () => createSvnReviewManager({
    sessionReader,
    commandRunner,
    reviewArtifactsRoot,
    reviewStateFile,
    externalDiffLauncher,
    now
  });
  const manager = createManager();
  return {
    manager,
    createManager,
    calls,
    setCompletion(value) { completion = value; },
    setDiff(value) { diff = value; },
    setStatus(value) { status = value; },
    setFileInfo(value) { fileInfo = value; },
    setCommitLogMode(value) { commitLogMode = value; },
    logEntries
  };
}

async function dispatchAndComplete(harness, created, verdict = "pass") {
  await harness.manager.beginDispatch(created.review.id, {
    auditThreadId: created.review.threadId,
    auditTurnId: "turn-review-1"
  });
  assert.equal(harness.manager.getReview(created.review.id).status, "running");
  harness.setCompletion({
    status: "completed",
    turnId: "turn-review-1",
    completedAt: new Date().toISOString(),
    result: semanticResult(created.review.id, verdict, created.review.snapshotHash)
  });
  await harness.manager.poll();
}

test("按 Jira 拷贝链接格式生成 SVN 提交信息，说明以双连字符开头", () => {
  assert.equal(buildSvnCommitMessage(issue, "完成护具升级材料筛选及金币返还逻辑调整"), [
    "修复的版本：DevelopV4",
    "http://ctjira1.lmdgame.com:8080/browse/CT-13349",
    "足球小将",
    "CT-13349 【系统】优化3.0-护具-护具优化",
    "--完成护具升级材料筛选及金币返还逻辑调整"
  ].join("\n"));

  const bugMessage = buildSvnCommitMessage({
    ...issue,
    key: "CT-13404",
    title: "【新手引导】弱网环境下概率出现新手引导过程中闪退",
    url: "http://ctjira1.lmdgame.com:8080/browse/CT-13404",
    fixVersions: []
  });
  assert.equal(bugMessage.startsWith("http://ctjira1.lmdgame.com:8080/browse/CT-13404\n"), true);
  assert.equal(bugMessage.includes("\n--"), false);
  assert.throws(
    () => normalizeSvnRelativePath("."),
    (error) => error.code === "SVN_WORKING_COPY_ROOT_FORBIDDEN"
  );
});

test("解析 SVN info 和 status XML 中的文件、属性、冲突及远端状态", () => {
  assert.deepEqual(parseSvnInfoXml(infoXml), {
    path: ".",
    kind: "dir",
    revision: "120",
    url: "svn://example/server_v3",
    repositoryRoot: "svn://example",
    workingCopyRoot
  });
  const parsed = parseSvnStatusXml(`
    <status><target path="."><entry path="src\\player.go">
      <wc-status item="modified" revision="120" props="modified" switched="true" tree-conflicted="true"></wc-status>
      <repos-status item="modified" props="none"></repos-status>
    </entry></target></status>
  `, { workingCopyRoot });
  assert.deepEqual(parsed[0], {
    path: "src/player.go",
    item: "modified",
    properties: "modified",
    revision: "120",
    copied: false,
    switched: true,
    treeConflicted: true,
    wcLocked: false,
    reposItem: "modified",
    reposProperties: "none"
  });
});

test("解析 SVN XML 日志中的 revision、提交信息与变更路径", () => {
  assert.deepEqual(parseSvnLogXml(`<?xml version="1.0"?><log>
    <logentry revision="321"><author>tester</author><date>2026-08-05T08:00:00.000Z</date>
      <paths><path action="M">/server/src/player.go</path></paths><msg>CT-13349 change</msg>
    </logentry></log>`), [{
    revision: "321",
    author: "tester",
    date: "2026-08-05T08:00:00.000Z",
    message: "CT-13349 change",
    paths: [{ path: "/server/src/player.go", action: "M" }]
  }]);
});

test("只扫描当前 Codex 项目，并用会话文件操作证据推荐候选及预览单文件差异", async () => {
  const root = "F:\\football";
  const project = "F:\\football\\server_v3";
  const harness = createHarness({
    workingRoot: root,
    cwd: project,
    workspaceRoots: [project, root],
    touchedFiles: [{ path: `${project}\\src\\player.go`, type: "update" }]
  });
  harness.setStatus(`<?xml version="1.0"?>
    <status><target path="server_v3">
      <entry path="server_v3/src/player.go"><wc-status item="modified" revision="120" props="none"></wc-status></entry>
    </target></status>`);
  harness.setFileInfo(`<?xml version="1.0"?>
    <info><entry kind="file" path="server_v3/src/player.go" revision="120">
      <url>svn://example/server_v3/src/player.go</url>
    </entry></info>`);

  const context = await harness.manager.inspect({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue
  });
  assert.equal(context.workingCopy.root, root);
  assert.equal(context.workingCopy.scopeRoot, project);
  assert.equal(context.workingCopy.scopePath, "server_v3");
  assert.equal(context.changes[0].recommended, true);
  assert.equal(context.changes[0].recommendationConfidence, "high");
  const statusCall = harness.calls.find((call) => call.args[0] === "status");
  assert.deepEqual(statusCall.args.slice(-2), ["--", "server_v3"]);

  const preview = await harness.manager.previewDiff({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    path: "server_v3/src/player.go"
  });
  assert.equal(preview.available, true);
  assert.match(preview.diff, /\+new/);
  await assert.rejects(
    harness.manager.previewDiff({
      threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
      path: "another-project/file.go"
    }),
    (error) => error.code === "SVN_PATH_OUTSIDE_PROJECT_SCOPE"
  );
});

test("结构化 Codex 审核结果必须绑定审核 ID，未运行测试至少降级为 warning", () => {
  const result = parseSvnReviewResult(`SVN_REVIEW_RESULT_V1\n${JSON.stringify({
    reviewId: "audit-1",
    verdict: "pass",
    requirements: [{ requirement: "需求", status: "covered", evidence: "diff" }],
    impactAnalysis: [{ area: "调用方", severity: "low", evidence: "检索", assessment: "无影响" }],
    requirementMatch: { status: "match" },
    compliance: { status: "pass" },
    tests: { status: "not_run" }
  })}`, "audit-1");
  assert.equal(result.verdict, "warning");
  assert.throws(
    () => parseSvnReviewResult(semanticResult("another-id", "pass", "hash"), "audit-1", "hash"),
    (error) => error instanceof SvnReviewError && error.code === "SVN_REVIEW_ID_MISMATCH"
  );
});

test("审核完成后必须人工确认，SVN commit 只包含显式审核路径且确认令牌只能使用一次", async () => {
  const harness = createHarness();
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"],
    summary: "完成状态恢复逻辑"
  });
  assert.equal(created.review.status, "prepared");
  assert.match(created.prompt, /禁止修改任何文件/);
  assert.match(created.prompt, new RegExp(created.review.id));
  await dispatchAndComplete(harness, created);
  assert.equal(harness.manager.getReview(created.review.id).verdict, "pass");

  await assert.rejects(
    harness.manager.confirm(created.review.id, {
      issue,
      issueKey: issue.key,
      reviewed: false
    }),
    (error) => error.code === "SVN_HUMAN_REVIEW_REQUIRED"
  );
  const confirmation = await harness.manager.confirm(created.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true
  });
  const committed = await harness.manager.commit(created.review.id, {
    issue,
    confirmationToken: confirmation.confirmationToken
  });
  assert.equal(committed.status, "committed");
  assert.equal(committed.commit.revision, "121");
  const commitCall = harness.calls.find((call) => call.args[0] === "commit");
  assert.deepEqual(commitCall.args.slice(-2), ["--", "src/player.go"]);
  assert.equal(commitCall.args.includes("."), false);
  assert.equal(commitCall.args.includes("--file"), true);
  assert.equal(commitCall.args.includes("--non-interactive"), true);

  await assert.rejects(
    harness.manager.commit(created.review.id, {
      issue,
      confirmationToken: confirmation.confirmationToken
    }),
    (error) => error.code === "SVN_CONFIRMATION_INVALID"
  );
});

test("关闭 Codex 审核后仍需完成人工审核与提交前复检", async () => {
  const harness = createHarness();
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"],
    summary: "完成人工审核流程",
    codexReviewEnabled: false
  });
  assert.equal(created.review.codexReviewEnabled, false);
  assert.equal(created.review.reviewMode, "manual");
  assert.equal(created.review.status, "manual_review");
  assert.equal(created.prompt, "");

  await assert.rejects(
    harness.manager.confirm(created.review.id, {
      issue,
      issueKey: issue.key,
      reviewed: false
    }),
    (error) => error.code === "SVN_HUMAN_REVIEW_REQUIRED"
  );
  const confirmation = await harness.manager.confirm(created.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true
  });
  const committed = await harness.manager.commit(created.review.id, {
    issue,
    confirmationToken: confirmation.confirmationToken
  });
  assert.equal(committed.status, "committed");
  assert.equal(committed.commit.reviewMode, "manual");
  assert.equal(committed.manualReviewedAt.length > 0, true);
});

test("运行中的 Codex 审查可取消并人工降级后提交", async () => {
  const harness = createHarness();
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"]
  });
  await harness.manager.beginDispatch(created.review.id, {
    auditThreadId: created.review.threadId,
    auditTurnId: "turn-cancelled"
  });
  const cancelled = await harness.manager.cancel(created.review.id, "人工取消耗时审查");
  assert.equal(cancelled.status, "cancelled");
  assert.match(cancelled.cancellation.message, /人工取消/);

  const confirmation = await harness.manager.confirm(created.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true
  });
  const committed = await harness.manager.commit(created.review.id, {
    issue,
    confirmationToken: confirmation.confirmationToken
  });
  assert.equal(committed.commit.reviewMode, "codex_cancelled_manual");
});

test("投递失败或超时状态也可人工降级，不会卡住提交入口", async () => {
  const harness = createHarness();
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"]
  });
  const failed = await harness.manager.failDispatch(created.review.id, "模拟当前会话桥接失败");
  assert.equal(failed.status, "dispatch_failed");
  const downgraded = await harness.manager.cancel(created.review.id, "人工降级");
  assert.equal(downgraded.status, "cancelled");
  const confirmation = await harness.manager.confirm(created.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true
  });
  assert.equal(typeof confirmation.confirmationToken, "string");
});

test("已取消的旧草稿可明确放弃，重新打开时不会再次恢复", async () => {
  const harness = createHarness();
  const older = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"],
    codexReviewEnabled: false
  });
  const created = await harness.manager.createReview({
    threadId: older.review.threadId,
    issue,
    selectedPaths: ["src/player.go"]
  });
  await harness.manager.cancel(created.review.id, "旧审查已取消");
  assert.equal(harness.manager.findLatestReview({
    threadId: created.review.threadId,
    issueKey: issue.key
  }).status, "cancelled");

  const abandoned = await harness.manager.abandon(created.review.id, {
    acknowledged: true,
    message: "重新扫描最新工作副本"
  });
  assert.equal(abandoned.status, "abandoned");
  assert.equal(harness.manager.findLatestReview({
    threadId: created.review.threadId,
    issueKey: issue.key
  }), null);
  assert.equal(harness.manager.getReview(older.review.id).status, "manual_review");
  const context = await harness.manager.inspect({
    threadId: created.review.threadId,
    issue
  });
  assert.deepEqual(context.changes.map((change) => change.path), ["src/player.go"]);
});

test("同一文件关联其他 Jira 草稿时必须人工确认混入风险", async () => {
  const harness = createHarness();
  const otherIssue = {
    ...issue,
    key: "CT-14000",
    url: "http://ctjira1.lmdgame.com:8080/browse/CT-14000",
    title: "另一个任务"
  };
  await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca5",
    issue: otherIssue,
    selectedPaths: ["src/player.go"],
    codexReviewEnabled: false
  });
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"],
    codexReviewEnabled: false
  });
  assert.equal(created.review.crossTaskConflicts[0].path, "src/player.go");
  assert.equal(created.review.crossTaskConflicts[0].relatedIssues[0].issueKey, "CT-14000");
  await assert.rejects(
    harness.manager.confirm(created.review.id, {
      issue,
      issueKey: issue.key,
      reviewed: true,
      riskAcknowledged: true
    }),
    (error) => error.code === "SVN_CROSS_TASK_ACK_REQUIRED"
  );
  const confirmation = await harness.manager.confirm(created.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true,
    riskAcknowledged: true,
    overlapAcknowledged: true
  });
  assert.equal(typeof confirmation.confirmationToken, "string");
});

test("同一 Jira 可连续创建多次 SVN 提交并保留 revision 历史", async () => {
  const harness = createHarness();
  const first = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"],
    summary: "第一次提交",
    codexReviewEnabled: false
  });
  const firstConfirmation = await harness.manager.confirm(first.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true
  });
  await harness.manager.commit(first.review.id, {
    issue,
    confirmationToken: firstConfirmation.confirmationToken
  });
  assert.equal(harness.manager.findLatestReview({
    threadId: first.review.threadId,
    issueKey: issue.key
  }), null);

  const second = await harness.manager.createReview({
    threadId: first.review.threadId,
    issue,
    selectedPaths: ["src/player.go"],
    summary: "第二次提交",
    codexReviewEnabled: false
  });
  assert.equal(second.review.historicalRevisions.some((entry) => entry.revision === "121"), true);
  assert.equal(harness.manager.findLatestReview({
    threadId: first.review.threadId,
    issueKey: issue.key
  }).id, second.review.id);
  const secondConfirmation = await harness.manager.confirm(second.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true
  });
  await harness.manager.commit(second.review.id, {
    issue,
    confirmationToken: secondConfirmation.confirmationToken
  });
  const history = harness.manager.listCommitHistory({
    threadId: first.review.threadId,
    issueKey: issue.key
  });
  assert.equal(history.length, 2);
  assert.deepEqual(new Set(history.map((entry) => entry.revision)), new Set(["121", "122"]));
});

test("SVN 命令回执无法唯一核实时保持未知状态，并可稍后按日志恢复", async () => {
  const harness = createHarness({ commitLogMode: "omit" });
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"],
    codexReviewEnabled: false
  });
  const confirmation = await harness.manager.confirm(created.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true
  });
  await assert.rejects(
    harness.manager.commit(created.review.id, {
      issue,
      confirmationToken: confirmation.confirmationToken
    }),
    (error) => error.code === "SVN_COMMIT_RESULT_AMBIGUOUS"
  );
  const unknown = harness.manager.getReview(created.review.id);
  assert.equal(unknown.status, "commit_unknown");
  harness.logEntries.push({
    revision: unknown.commitReceipt.parsedRevision,
    author: "tester",
    date: new Date().toISOString(),
    message: unknown.message,
    paths: unknown.selectedPaths
  });
  const reconciled = await harness.manager.reconcileCommit(created.review.id);
  assert.equal(reconciled.status, "committed");
  assert.equal(reconciled.commit.revision, "121");
});

test("SVN 日志将提交说明换行为 CRLF 时仍能准确确认提交", async () => {
  const harness = createHarness({
    commitLogMessageTransform: (value) => value.replace(/\n/g, "\r\n")
  });
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"],
    codexReviewEnabled: false
  });
  const confirmation = await harness.manager.confirm(created.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true
  });
  const committed = await harness.manager.commit(created.review.id, {
    issue,
    confirmationToken: confirmation.confirmationToken
  });
  assert.equal(committed.status, "committed");
  assert.equal(committed.commit.revision, "121");
});

test("自动日志核对失败后允许人工确认已提交并登记 revision", async () => {
  const harness = createHarness({ commitLogMode: "omit" });
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"],
    codexReviewEnabled: false
  });
  const confirmation = await harness.manager.confirm(created.review.id, {
    issue,
    issueKey: issue.key,
    reviewed: true
  });
  await assert.rejects(
    harness.manager.commit(created.review.id, {
      issue,
      confirmationToken: confirmation.confirmationToken
    }),
    (error) => error.code === "SVN_COMMIT_RESULT_AMBIGUOUS"
  );
  await assert.rejects(
    harness.manager.confirmCommitted(created.review.id, {
      acknowledged: false,
      revision: "121"
    }),
    (error) => error.code === "SVN_COMMIT_RESULT_ACK_REQUIRED"
  );
  const committed = await harness.manager.confirmCommitted(created.review.id, {
    acknowledged: true,
    revision: "r121"
  });
  assert.equal(committed.status, "committed");
  assert.equal(committed.commit.revision, "121");
  assert.equal(committed.commitReceipt.manuallyConfirmedRevision, "121");
});

test("旧版因 CRLF 差异误判并放弃的成功提交会从完整回执恢复", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-commit-line-ending-recovery-"));
  try {
    const stateFile = join(directory, "svn-reviews.json");
    const harness = createHarness({
      reviewStateFile: stateFile,
      commitLogMode: "omit"
    });
    const created = await harness.manager.createReview({
      threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
      issue,
      selectedPaths: ["src/player.go"],
      codexReviewEnabled: false
    });
    const confirmation = await harness.manager.confirm(created.review.id, {
      issue,
      issueKey: issue.key,
      reviewed: true
    });
    await assert.rejects(
      harness.manager.commit(created.review.id, {
        issue,
        confirmationToken: confirmation.confirmationToken
      }),
      (error) => error.code === "SVN_COMMIT_RESULT_AMBIGUOUS"
    );
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    const persisted = state.reviews.find((review) => review.id === created.review.id);
    persisted.status = "abandoned";
    persisted.abandonedAt = new Date().toISOString();
    persisted.abandonMessage = "旧版界面只能放弃异常草稿。";
    const logMessage = persisted.message.replace(/\n/g, "\r\n");
    persisted.commitReceipt.verification.output = `<?xml version="1.0"?><log><logentry revision="121">
      <author>tester</author><date>${new Date().toISOString()}</date>
      <paths><path action="M">/src/player.go</path></paths><msg>${logMessage}</msg>
    </logentry></log>`;
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const restarted = harness.createManager();
    await restarted.initialize();
    const restored = restarted.getReview(created.review.id);
    assert.equal(restored.status, "committed");
    assert.equal(restored.commit.revision, "121");
    assert.equal(restored.commitReceipt.commitResultRecoveryReason, "normalized_log_message");
    assert.equal(restored.abandonedAt, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("双击差异只对当前项目文件调用 TortoiseSVN 启动器", async () => {
  const opened = [];
  const harness = createHarness({
    externalDiffLauncher: async (input) => opened.push(input)
  });
  const result = await harness.manager.openExternalDiff({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    path: "src/player.go"
  });
  assert.equal(result.ok, true);
  assert.equal(opened[0].path, "src/player.go");
  assert.equal(opened[0].absolutePath.endsWith("src\\player.go"), true);
});

test("当前会话审查状态在服务重启后恢复并继续轮询", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-review-state-"));
  try {
    let currentTime = Date.parse("2026-08-05T05:00:00.000Z");
    const stateFile = join(directory, "svn-reviews.json");
    const harness = createHarness({ reviewStateFile: stateFile, now: () => currentTime });
    const created = await harness.manager.createReview({
      threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
      issue,
      selectedPaths: ["src/player.go"]
    });
    await harness.manager.beginDispatch(created.review.id, {
      auditThreadId: created.review.threadId,
      auditTurnId: "turn-persisted"
    });

    const restarted = harness.createManager();
    await restarted.initialize();
    const restored = restarted.getReview(created.review.id);
    assert.equal(restored.status, "running");
    assert.equal(restored.auditThreadId, created.review.threadId);
    assert.equal(restored.auditTurnId, "turn-persisted");

    currentTime += 3 * 60_000;
    harness.setCompletion({
      status: "completed",
      turnId: "turn-persisted",
      completedAt: "2026-08-05T05:03:00.000Z",
      result: semanticResult(created.review.id, "pass", created.review.snapshotHash)
    });
    await restarted.poll();
    assert.equal(restarted.getReview(created.review.id).status, "completed");
    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(persisted.reviews[0].status, "completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("服务在 svn commit 期间重启时恢复为待核对状态而不是允许直接重提", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-commit-recovery-"));
  try {
    const stateFile = join(directory, "svn-reviews.json");
    const harness = createHarness({ reviewStateFile: stateFile });
    const created = await harness.manager.createReview({
      threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
      issue,
      selectedPaths: ["src/player.go"],
      codexReviewEnabled: false
    });
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    state.reviews[0].status = "committing";
    state.reviews[0].confirmedAt = state.reviews[0].createdAt;
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const restarted = harness.createManager();
    await restarted.initialize();
    const restored = restarted.getReview(created.review.id);
    assert.equal(restored.status, "commit_unknown");
    assert.equal(restored.commitReceipt.verification.status, "unknown");
    assert.match(restored.error, /不要直接重试提交/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("缺少状态文件时可从审核附件和 Codex 日志恢复旧审核", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-review-recovery-"));
  try {
    const artifacts = join(directory, "artifacts");
    const creator = createHarness({ reviewArtifactsRoot: artifacts });
    const created = await creator.manager.createReview({
      threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
      issue,
      selectedPaths: ["src/player.go"]
    });
    const recoveredHarness = createHarness({
      reviewArtifactsRoot: artifacts,
      reviewStateFile: join(directory, "svn-reviews.json"),
      findReviewTurn: async ({ reviewId, snapshotHash }) => ({
        status: "completed",
        threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
        turnId: "turn-recovered",
        requestObservedAt: "2026-08-05T05:00:00.000Z",
        startedAt: "2026-08-05T05:00:00.000Z",
        completedAt: "2026-08-05T05:03:00.000Z",
        result: semanticResult(reviewId, "pass", snapshotHash)
      })
    });
    await recoveredHarness.manager.initialize();
    const restored = recoveredHarness.manager.getReview(created.review.id);
    assert.equal(restored.status, "completed");
    assert.equal(restored.auditThreadId, "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4");
    assert.equal(restored.auditTurnId, "turn-recovered");
    assert.equal(restored.recoveredAt.length > 0, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("当前会话审查使用原任务需求、SVN 原生 diff 与快照清单三个附件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-review-artifacts-"));
  try {
    const harness = createHarness({ reviewArtifactsRoot: directory });
    const created = await harness.manager.createReview({
      threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
      issue,
      selectedPaths: ["src/player.go"]
    });
    assert.deepEqual(created.review.artifacts.map((artifact) => artifact.name), [
      "01-requirements-context.md",
      "02-svn-changes.diff",
      "03-review-manifest.json"
    ]);
    assert.match(await readFile(created.review.artifacts[0].path, "utf8"), /原任务对话上下文[\s\S]*恢复状态/);
    assert.match(await readFile(created.review.artifacts[1].path, "utf8"), /Index: src\/player.go/);
    const manifest = JSON.parse(await readFile(created.review.artifacts[2].path, "utf8"));
    assert.equal(manifest.snapshotHash, created.review.snapshotHash);
    assert.deepEqual(manifest.selectedPaths, ["src/player.go"]);
    assert.match(created.prompt, /SVN_REVIEW_REQUEST_V2/);
    assert.match(created.prompt, /svn info、svn status、svn diff、svn cat/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("没有真实 turnId 时拒绝进入审查运行状态", async () => {
  const harness = createHarness();
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"]
  });
  await assert.rejects(
    harness.manager.beginDispatch(created.review.id, { auditThreadId: created.review.threadId }),
    (error) => error.code === "SVN_AUDIT_TURN_REQUIRED"
  );
  assert.equal(harness.manager.getReview(created.review.id).status, "prepared");
});

test("文件差异变化会使审核快照失效", async () => {
  const harness = createHarness();
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"],
    summary: "完成状态恢复逻辑"
  });
  await dispatchAndComplete(harness, created);
  harness.setDiff("Index: src/player.go\n+changed-again\n");
  await assert.rejects(
    harness.manager.confirm(created.review.id, {
      issue,
      issueKey: issue.key,
      reviewed: true
    }),
    (error) => error.code === "SVN_REVIEW_STALE"
  );
  assert.equal(harness.manager.getReview(created.review.id).status, "stale");
});

test("任务绑定前已经存在的 SVN 改动会被基线标记并阻断自动提交", async () => {
  const harness = createHarness();
  const baseline = await harness.manager.recordBaseline({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issueKey: issue.key,
    boundAt: Date.now()
  });
  assert.deepEqual(baseline.preExistingPaths, ["src/player.go"]);
  const context = await harness.manager.inspect({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue
  });
  assert.equal(context.baseline.available, true);
  assert.equal(context.changes[0].preExisting, true);
  assert.equal(context.changes[0].recommended, false);

  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"]
  });
  assert.equal(created.review.status, "blocked");
  assert.equal(created.prompt, "");
  assert.equal(created.review.mechanical.blockers.some((check) => check.code === "pre_existing_change"), true);
});

test("任务绑定后出现且不在原基线中的文件会进入系统推荐候选", async () => {
  const harness = createHarness();
  harness.setStatus("<?xml version=\"1.0\"?><status><target path=\".\"></target></status>");
  await harness.manager.recordBaseline({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issueKey: issue.key,
    boundAt: Date.now()
  });
  harness.setStatus(statusXml);
  const context = await harness.manager.inspect({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue
  });
  assert.equal(context.changes[0].recommended, true);
  assert.equal(context.changes[0].recommendationConfidence, "medium");
  assert.equal(context.changes[0].recommendationReason, "任务绑定后出现的变更");
});

test("未纳管文件不会被误报为遗漏的可提交文件", async () => {
  const harness = createHarness();
  harness.setStatus(`<?xml version="1.0"?>
    <status><target path=".">
      <entry path="src/player.go"><wc-status item="modified" revision="120" props="none"></wc-status></entry>
      <entry path="tmp/output.log"><wc-status item="unversioned" props="none"></wc-status></entry>
    </target></status>`);
  const created = await harness.manager.createReview({
    threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
    issue,
    selectedPaths: ["src/player.go"]
  });
  assert.equal(
    created.review.mechanical.warnings.some((warning) => warning.code === "unselected_changes"),
    false
  );
});

test("二进制内容变化即使 SVN diff 文本不变也会使审核失效", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-svn-fingerprint-"));
  try {
    await mkdir(join(directory, "src"));
    const file = join(directory, "src", "player.go");
    await writeFile(file, Buffer.from([0, 1, 2, 3]));
    const harness = createHarness({ workingRoot: directory });
    harness.setDiff("Cannot display: file marked as a binary type.\n");
    const created = await harness.manager.createReview({
      threadId: "019fcaa1-7ac6-7031-bcc5-3f85a3143ca4",
      issue,
      selectedPaths: ["src/player.go"]
    });
    await dispatchAndComplete(harness, created, "warning");
    await writeFile(file, Buffer.from([0, 1, 2, 4]));
    await assert.rejects(
      harness.manager.confirm(created.review.id, {
        issue,
        issueKey: issue.key,
        reviewed: true,
        riskAcknowledged: true
      }),
      (error) => error.code === "SVN_REVIEW_STALE"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
