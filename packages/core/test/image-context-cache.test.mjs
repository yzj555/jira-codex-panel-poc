import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createImageContextCache, hashImageFile } from "../lib/image-context-cache.mjs";

test("图片解析结果按附件 ID 与文件 SHA-256 复用，内容变化后不会命中旧结果", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-image-context-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const image = join(directory, "image.png");
  await writeFile(image, Buffer.from("first-image"));
  const cache = createImageContextCache({ cacheRoot: join(directory, "cache") });

  const firstLookup = await cache.lookup({ attachmentId: "900", filePath: image });
  assert.equal(firstLookup.record, null);
  assert.equal(firstLookup.sha256, await hashImageFile(image));
  const stored = await cache.store({
    attachmentId: "900",
    filePath: image,
    sha256: firstLookup.sha256,
    filename: "证据.png",
    mimeType: "image/png",
    mode: "vision",
    text: "画面显示登录失败提示。",
    processor: { kind: "vision", provider: "openai", model: "gpt-4.1" }
  });
  assert.equal(stored.text, "画面显示登录失败提示。");

  const hit = await cache.lookup({ attachmentId: "900", filePath: image });
  assert.equal(hit.record.mode, "vision");
  assert.equal(hit.record.processor.model, "gpt-4.1");

  await writeFile(image, Buffer.from("second-image"));
  const changed = await cache.lookup({ attachmentId: "900", filePath: image });
  assert.notEqual(changed.sha256, firstLookup.sha256);
  assert.equal(changed.record, null);
});

test("未解析失败不能写入长期图片上下文缓存", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-image-context-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const image = join(directory, "image.png");
  await writeFile(image, Buffer.from("image"));
  const cache = createImageContextCache({ cacheRoot: join(directory, "cache") });
  await assert.rejects(
    cache.store({ attachmentId: "901", filePath: image, mode: "unparsed", text: "失败" }),
    /Only successful vision or OCR results/
  );
});
