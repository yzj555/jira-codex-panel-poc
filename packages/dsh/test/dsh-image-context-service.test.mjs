import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDshImageContextService } from "../lib/dsh-image-context-service.mjs";

function attachment(path) {
  return {
    attachmentId: "900",
    path,
    filename: "错误截图.png",
    label: "[当前执行单 CT-300] 错误截图.png",
    mimeType: "image/png",
    sourceIssueKey: "CT-300",
    sourceLabel: "当前执行单"
  };
}

function context({ currentModalities, llm, attachments } = {}) {
  return {
    get(name) {
      if (name === "apiProxy") {
        return {
          sessions: {
            async models(request) {
              return {
                rpcId: request.rpcId,
                result: {
                  ok: true,
                  value: { current: { provider: "main", model: "chat" }, groups: [], failures: [], routable: true }
                }
              };
            }
          }
        };
      }
      if (name === "llm") {
        return llm || {
          async resolveModelInfo() { return { inputModalities: currentModalities }; }
        };
      }
      if (name === "attachments") return attachments;
      return undefined;
    }
  };
}

test("当前模型支持图片时保留原图、文件名与 Jira 来源", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-image-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "evidence.png");
  await writeFile(path, Buffer.from("image-bytes"));
  const service = createDshImageContextService({
    ctx: context({ currentModalities: ["text", "image"] }),
    cacheRoot: join(directory, "cache"),
    ocr: { async recognize() { throw new Error("OCR should not run"); } }
  });

  const result = await service.prepare({
    sessionId: "session-1",
    attachments: [attachment(path)],
    config: {}
  });
  assert.equal(result.mode, "native");
  assert.equal(result.imageParts.length, 1);
  assert.equal(result.imageParts[0].name, "[当前执行单 CT-300] 错误截图.png");
  assert.equal(Buffer.from(result.imageParts[0].data, "base64").toString(), "image-bytes");
  assert.equal(result.statuses[0].source, "当前执行单 CT-300");
});

test("文本模型使用配置的视觉模型生成结构化说明，并按附件 ID 与哈希复用缓存", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-image-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "evidence.png");
  await writeFile(path, Buffer.from("image-bytes"));
  let streamCalls = 0;
  const llm = {
    async resolveModelInfo(provider) {
      return { inputModalities: provider === "vision" ? ["text", "image"] : ["text"] };
    },
    async * stream(options) {
      streamCalls += 1;
      assert.equal(options.provider, "vision");
      assert.equal(options.messages[0].content[1].type, "image");
      yield { type: "block-end", index: 0, block: { type: "text", text: "画面显示 HTTP 503 错误。" } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  };
  const service = createDshImageContextService({
    ctx: context({
      llm,
      attachments: { async saveImage(input) { return { id: "stored-1", ...input }; } }
    }),
    cacheRoot: join(directory, "cache"),
    ocr: { async recognize() { throw new Error("OCR should not run"); } }
  });
  const input = {
    sessionId: "session-1",
    attachments: [attachment(path)],
    config: { imageProcessing: { visionProvider: "vision", visionModel: "vision-1", localOcrEnabled: true } }
  };
  const first = await service.prepare(input);
  const second = await service.prepare(input);
  assert.equal(first.mode, "fallback");
  assert.match(first.textContext, /\[视觉解析\]/);
  assert.match(first.textContext, /HTTP 503/);
  assert.equal(first.statuses[0].cached, false);
  assert.equal(second.statuses[0].cached, true);
  assert.equal(streamCalls, 1);
});

test("无视觉结果时使用 OCR；OCR 也不可用仍返回明确未解析提示", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-image-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "evidence.png");
  await writeFile(path, Buffer.from("image-bytes"));
  const textContext = context({ currentModalities: ["text"] });
  const ocrService = createDshImageContextService({
    ctx: textContext,
    cacheRoot: join(directory, "ocr-cache"),
    ocr: { async recognize() { return { available: true, text: "服务器连接失败", engine: "test-ocr" }; } }
  });
  const ocrResult = await ocrService.prepare({
    sessionId: "session-1",
    attachments: [attachment(path)],
    config: { imageProcessing: { localOcrEnabled: true } }
  });
  assert.match(ocrResult.textContext, /\[OCR 降级\]/);
  assert.match(ocrResult.textContext, /服务器连接失败/);

  const unavailableService = createDshImageContextService({
    ctx: textContext,
    cacheRoot: join(directory, "unavailable-cache"),
    ocr: { async recognize() { return { available: false, text: "", error: "unavailable" }; } }
  });
  const unavailable = await unavailableService.prepare({
    sessionId: "session-2",
    attachments: [attachment(path)],
    config: { imageProcessing: { localOcrEnabled: true } }
  });
  assert.equal(unavailable.statuses[0].mode, "unparsed");
  assert.match(unavailable.textContext, /图片未解析/);
  assert.match(unavailable.textContext, /请让用户补充图片内容/);
});
