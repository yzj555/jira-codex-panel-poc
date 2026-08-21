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

test("配置视觉模型后会升级同一附件的旧 OCR 缓存", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-image-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "evidence.png");
  await writeFile(path, Buffer.from("image-bytes"));
  let streamCalls = 0;
  let ocrCalls = 0;
  const service = createDshImageContextService({
    ctx: context({
      llm: {
        async resolveModelInfo(provider) {
          return { inputModalities: provider === "vision" ? ["text", "image"] : ["text"] };
        },
        async * stream() {
          streamCalls += 1;
          yield { type: "block-end", index: 0, block: { type: "text", text: "视觉模型识别到 HTTP 503。" } };
          yield { type: "finish", reason: { kind: "stop" } };
        }
      },
      attachments: { async saveImage(input) { return { id: "stored-upgrade", ...input }; } }
    }),
    cacheRoot: join(directory, "cache"),
    ocr: {
      async recognize() {
        ocrCalls += 1;
        return { available: true, text: "OCR 只识别到 503", engine: "test-ocr" };
      }
    }
  });
  const base = { sessionId: "session-1", attachments: [attachment(path)] };

  const beforeConfiguration = await service.prepare({
    ...base,
    config: { imageProcessing: { localOcrEnabled: true } }
  });
  assert.equal(beforeConfiguration.statuses[0].mode, "ocr");

  const configured = {
    imageProcessing: { visionProvider: "vision", visionModel: "vision-1", localOcrEnabled: true }
  };
  const upgraded = await service.prepare({ ...base, config: configured });
  const reused = await service.prepare({ ...base, config: configured });
  assert.equal(upgraded.statuses[0].mode, "vision");
  assert.equal(upgraded.statuses[0].cached, false);
  assert.match(upgraded.textContext, /视觉模型识别到 HTTP 503/);
  assert.equal(reused.statuses[0].mode, "vision");
  assert.equal(reused.statuses[0].cached, true);
  assert.equal(streamCalls, 1);
  assert.equal(ocrCalls, 1);
});

test("视觉模型失败时回执说明失败原因并降级到 OCR", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-dsh-image-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "evidence.png");
  await writeFile(path, Buffer.from("image-bytes"));
  const service = createDshImageContextService({
    ctx: context({
      llm: {
        async resolveModelInfo(provider) {
          return { inputModalities: provider === "vision" ? ["text", "image"] : ["text"] };
        },
        async * stream() {
          throw new Error("视觉路由缺少凭据");
        }
      },
      attachments: { async saveImage(input) { return { id: "stored-failure", ...input }; } }
    }),
    cacheRoot: join(directory, "cache"),
    ocr: { async recognize() { return { available: true, text: "OCR 文本", engine: "test-ocr" }; } }
  });

  const result = await service.prepare({
    sessionId: "session-1",
    attachments: [attachment(path)],
    config: {
      imageProcessing: { visionProvider: "vision", visionModel: "vision-1", localOcrEnabled: true }
    }
  });
  assert.equal(result.statuses[0].mode, "ocr");
  assert.equal(result.statuses[0].visionFailure.provider, "vision");
  assert.match(result.statuses[0].visionFailure.message, /缺少凭据/);
  assert.match(result.textContext, /已尝试视觉模型 vision\/vision-1/);
  assert.match(result.textContext, /OCR 文本/);
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
