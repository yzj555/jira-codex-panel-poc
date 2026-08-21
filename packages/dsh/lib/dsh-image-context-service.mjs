import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createImageContextCache, createLocalImageOcr } from "@jira-workbench/core/index.mjs";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const VISION_TIMEOUT_MS = 60_000;
const VISION_MAX_TOKENS = 1_200;

function rpcRequest(prefix, payload) {
  return { rpcId: `jira-workbench-${prefix}-${randomUUID()}`, payload };
}

function imageAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : []).filter((attachment) => (
    SUPPORTED_IMAGE_TYPES.has(String(attachment?.mimeType || "").toLowerCase())
      && Boolean(String(attachment?.path || "").trim())
  ));
}

function attachmentName(attachment) {
  return String(attachment?.filename || attachment?.label || "Jira 图片附件").trim() || "Jira 图片附件";
}

function attachmentSource(attachment) {
  const label = String(attachment?.sourceLabel || "Jira 单子").trim();
  const key = String(attachment?.sourceIssueKey || "").trim();
  return [label, key].filter(Boolean).join(" ");
}

function attachmentCacheId(attachment) {
  return String(attachment?.attachmentId || attachment?.id || "").trim()
    || `${attachmentSource(attachment)}:${attachmentName(attachment)}`;
}

function visionFailure(error, route) {
  const message = String(error?.message || error || "视觉模型调用失败。")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return {
    provider: String(route?.provider || ""),
    model: String(route?.model || ""),
    message: message || "视觉模型调用失败。"
  };
}

async function currentModelImageCapability(ctx, sessionId) {
  const apiProxy = ctx?.get?.("apiProxy");
  const llm = ctx?.get?.("llm");
  if (!apiProxy?.sessions?.models || !llm?.resolveModelInfo) return { supported: null };
  try {
    const response = await apiProxy.sessions.models(rpcRequest("models", { sessionId }));
    if (response?.result?.ok !== true) return { supported: null };
    const current = response.result.value?.current || {};
    const provider = String(current.provider || "").trim();
    const model = String(current.model || "").trim();
    if (!provider || !model) return { supported: null };
    const info = await llm.resolveModelInfo(provider, model);
    // DSH Host treats missing inputModalities as unknown/admissible and only
    // rejects an explicit text-only declaration. Mirror that exact contract.
    const modalities = Array.isArray(info?.inputModalities) ? info.inputModalities : null;
    return {
      supported: modalities === null ? true : modalities.includes("image"),
      provider,
      model
    };
  } catch {
    return { supported: null };
  }
}

function streamFailure(reason) {
  if (reason?.kind !== "error" && reason?.kind !== "aborted") return null;
  return new Error(String(reason?.failure?.message || `视觉模型调用${reason.kind === "aborted" ? "已超时" : "失败"}。`));
}

async function analyzeWithVision({ ctx, attachment, route, sessionId }) {
  const llm = ctx?.get?.("llm");
  const attachmentStore = ctx?.get?.("attachments");
  if (!llm?.resolveModelInfo || !llm?.stream || !attachmentStore?.saveImage) {
    throw new Error("DSH 视觉模型或附件服务不可用。");
  }
  const info = await llm.resolveModelInfo(route.provider, route.model);
  if (!Array.isArray(info?.inputModalities) || !info.inputModalities.includes("image")) {
    throw new Error("配置的视觉模型未声明图片输入能力。");
  }
  const data = await readFile(attachment.path);
  const reference = await attachmentStore.saveImage({
    data,
    mediaType: String(attachment.mimeType).toLowerCase(),
    name: attachmentName(attachment)
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("视觉模型解析超时。")), VISION_TIMEOUT_MS);
  timer.unref?.();
  const partials = new Map();
  let finish = null;
  try {
    const messages = [{
      id: randomUUID(),
      role: "user",
      source: { kind: "plugin", plugin: "jira-workbench" },
      content: [
        {
          type: "text",
          text: [
            `附件来源：${attachmentSource(attachment) || "Jira 单子"}`,
            `文件名：${attachmentName(attachment)}`,
            "请解析这张 Jira 图片附件。按“画面概述、可见文字、关键界面/报错/标注、与任务可能相关的事实、不确定信息”输出简洁中文结构化说明。只描述图中证据，不猜测未显示内容。"
          ].join("\n")
        },
        { type: "image", attachment: reference }
      ]
    }];
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      messages,
      maxTokens: VISION_MAX_TOKENS,
      sessionId,
      signal: controller.signal
    })) {
      if (chunk?.type === "text-delta") {
        partials.set(chunk.index, `${partials.get(chunk.index) || ""}${chunk.text || ""}`);
      } else if (chunk?.type === "block-end" && chunk.block?.type === "text") {
        partials.set(chunk.index, String(chunk.block.text || ""));
      } else if (chunk?.type === "finish") {
        finish = chunk.reason;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const failure = streamFailure(finish);
  if (failure) throw failure;
  const text = [...partials.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, value]) => String(value || "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!text) throw new Error("视觉模型没有返回可用的图片说明。");
  return text.slice(0, 32_000);
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function fallbackText(statuses) {
  if (!statuses.length) return "";
  return [
    "## 图片附件处理结果",
    ...statuses.map((status) => {
      const marker = status.mode === "vision"
        ? "视觉解析"
        : status.mode === "ocr" ? "OCR 降级" : "图片未解析";
      const heading = `### [${marker}] ${status.filename}（来源：${status.source || "Jira 单子"}）`;
      const failedVision = status.visionFailure
        ? `已尝试视觉模型 ${status.visionFailure.provider}/${status.visionFailure.model}，但调用失败：${status.visionFailure.message}`
        : "";
      if (status.mode === "unparsed") {
        return [
          heading,
          failedVision,
          "当前会话模型不支持图片，且配置的视觉模型与本地 OCR 均未产出可用结果。请让用户补充图片内容，或切换到支持图片的模型后再分析；不要假设图片内容。"
        ].filter(Boolean).join("\n");
      }
      return [heading, failedVision, status.text].filter(Boolean).join("\n");
    })
  ].join("\n\n");
}

export function createDshImageContextService({
  ctx,
  cacheRoot,
  cache = createImageContextCache({ cacheRoot }),
  ocr = createLocalImageOcr()
} = {}) {
  if (!ctx || typeof ctx.get !== "function") throw new TypeError("ctx is required.");
  if (!cache || typeof cache.lookup !== "function" || typeof cache.store !== "function") {
    throw new TypeError("image context cache is required.");
  }
  if (!ocr || typeof ocr.recognize !== "function") throw new TypeError("local OCR is required.");

  async function prepare({ sessionId, attachments, config, forceFallback = false } = {}) {
    const images = imageAttachments(attachments);
    if (!images.length) return { mode: "none", imageParts: [], textContext: "", statuses: [] };

    const current = forceFallback ? { supported: false } : await currentModelImageCapability(ctx, sessionId);
    if (current.supported !== false) {
      const imageParts = await Promise.all(images.map(async (attachment) => ({
        type: "image",
        mediaType: String(attachment.mimeType).toLowerCase(),
        data: (await readFile(attachment.path)).toString("base64"),
        name: String(attachment.label || attachmentName(attachment))
      })));
      return {
        mode: "native",
        imageParts,
        textContext: "",
        statuses: images.map((attachment) => ({
          attachmentId: attachmentCacheId(attachment),
          filename: attachmentName(attachment),
          source: attachmentSource(attachment),
          mode: "native"
        })),
        currentModel: current
      };
    }

    const settings = config?.imageProcessing || {};
    const route = String(settings.visionProvider || "").trim() && String(settings.visionModel || "").trim()
      ? { provider: String(settings.visionProvider).trim(), model: String(settings.visionModel).trim() }
      : null;
    const localOcrEnabled = settings.localOcrEnabled !== false;
    const statuses = await mapConcurrent(images, 2, async (attachment) => {
      const attachmentId = attachmentCacheId(attachment);
      let cached;
      try {
        cached = await cache.lookup({ attachmentId, filePath: attachment.path });
      } catch {
        // Cache corruption or an unwritable data directory must not turn an
        // otherwise usable visual/OCR result into a blocked Jira session.
        cached = { sha256: "", record: null };
      }
      // A cached visual result remains the strongest available result. OCR is
      // reusable only when no visual route is configured; once the user
      // selects a visual model, the old OCR record becomes a fallback instead
      // of preventing the configured model from ever running.
      const cachedOcr = cached.record?.mode === "ocr" ? cached.record : null;
      if (cached.record && (
        cached.record.mode === "vision"
        || (!route && cached.record.mode === "ocr" && localOcrEnabled)
      )) {
        return {
          attachmentId,
          filename: attachmentName(attachment),
          source: attachmentSource(attachment),
          mode: cached.record.mode,
          text: cached.record.text,
          cached: true,
          processor: cached.record.processor
        };
      }

      let failedVision = null;
      if (route) {
        try {
          const text = await analyzeWithVision({ ctx, attachment, route, sessionId });
          let record = {
            text,
            processor: { kind: "vision", provider: route.provider, model: route.model }
          };
          try {
            record = await cache.store({
              attachmentId,
              filePath: attachment.path,
              ...(cached.sha256 ? { sha256: cached.sha256 } : {}),
              filename: attachmentName(attachment),
              mimeType: attachment.mimeType,
              mode: "vision",
              text,
              processor: record.processor
            });
          } catch {
            // The analysis is still valid for this turn even when persistence
            // is unavailable; the next turn will simply analyze again.
          }
          return {
            attachmentId,
            filename: attachmentName(attachment),
            source: attachmentSource(attachment),
            mode: "vision",
            text: record.text,
            cached: false,
            processor: record.processor
          };
        } catch (error) {
          failedVision = visionFailure(error, route);
          // The configured visual route is optional. OCR is the next declared
          // fallback and its own result is surfaced below.
        }
      }

      if (cachedOcr && localOcrEnabled) {
        return {
          attachmentId,
          filename: attachmentName(attachment),
          source: attachmentSource(attachment),
          mode: "ocr",
          text: cachedOcr.text,
          cached: true,
          processor: cachedOcr.processor,
          ...(failedVision ? { visionFailure: failedVision } : {})
        };
      }

      if (localOcrEnabled) {
        try {
          const result = await ocr.recognize(attachment.path);
          if (result?.available && String(result.text || "").trim()) {
            let record = {
              text: String(result.text).trim(),
              processor: { kind: "ocr", engine: result.engine }
            };
            try {
              record = await cache.store({
                attachmentId,
                filePath: attachment.path,
                ...(cached.sha256 ? { sha256: cached.sha256 } : {}),
                filename: attachmentName(attachment),
                mimeType: attachment.mimeType,
                mode: "ocr",
                text: result.text,
                processor: record.processor
              });
            } catch {
              // See the visual branch above: cache availability is optional.
            }
            return {
              attachmentId,
              filename: attachmentName(attachment),
              source: attachmentSource(attachment),
              mode: "ocr",
              text: record.text,
              cached: false,
              processor: record.processor,
              ...(failedVision ? { visionFailure: failedVision } : {})
            };
          }
        } catch {
          // An OCR runtime failure must not block creation of the Jira session.
        }
      }

      // Failures are deliberately not cached: adding a visual model or OCR
      // language pack later must make the very next session retry the image.
      return {
        attachmentId,
        filename: attachmentName(attachment),
        source: attachmentSource(attachment),
        mode: "unparsed",
        text: "",
        cached: false,
        ...(failedVision ? { visionFailure: failedVision } : {})
      };
    });

    return {
      mode: "fallback",
      imageParts: [],
      textContext: fallbackText(statuses),
      statuses,
      currentModel: current
    };
  }

  return { prepare };
}
