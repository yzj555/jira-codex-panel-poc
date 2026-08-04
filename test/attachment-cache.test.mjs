import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  materializeAttachment,
  sanitizeAttachmentFilename
} from "../lib/attachment-cache.mjs";

function attachmentBody(content) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content));
      controller.close();
    }
  });
}

test("Jira 附件文件名会被限制在当前用户缓存目录中", () => {
  assert.equal(sanitizeAttachmentFilename("../CON:截图?.png", "900"), ".._CON_截图_.png");
  assert.equal(sanitizeAttachmentFilename("NUL", "901"), "_NUL");
  assert.equal(sanitizeAttachmentFilename("   ", "902"), "attachment-902");
});

test("Jira 附件会真实落盘，并按不可变附件 ID 复用缓存", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jira-codex-attachment-"));
  try {
    const first = await materializeAttachment({
      cacheRoot: directory,
      attachmentId: "900",
      attachment: {
        body: attachmentBody("attachment-content"),
        filename: "说明.txt",
        contentType: "text/plain",
        contentLength: "18"
      }
    });
    assert.equal(first.cached, false);
    assert.equal(first.filename, "说明.txt");
    assert.equal(await readFile(first.path, "utf8"), "attachment-content");

    const second = await materializeAttachment({
      cacheRoot: directory,
      attachmentId: "900",
      attachment: {
        body: attachmentBody("must-not-replace"),
        filename: "说明.txt",
        contentType: "text/plain",
        contentLength: "18"
      }
    });
    assert.equal(second.cached, true);
    assert.equal(second.path, first.path);
    assert.equal(await readFile(second.path, "utf8"), "attachment-content");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
