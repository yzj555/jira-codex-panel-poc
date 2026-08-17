import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findCachedAttachment,
  materializeAttachment,
  openLocalAttachment,
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
  const directory = await mkdtemp(join(tmpdir(), "jira-workbench-attachment-"));
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
    const cached = await findCachedAttachment({ cacheRoot: directory, attachmentId: "900" });
    assert.equal(cached.path, first.path);
    assert.equal(cached.filename, "说明.txt");
    assert.equal(cached.size, 18);
    assert.equal(Number.isFinite(cached.modifiedAt), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("已缓存附件使用系统默认程序打开，路径作为独立参数传递", async () => {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  };
  const result = await openLocalAttachment("C:\\cache folder\\说明.docx", {
    platform: "win32",
    spawnImpl
  });
  assert.equal(result.path, "C:\\cache folder\\说明.docx");
  assert.equal(calls[0].command, "powershell.exe");
  assert.equal(calls[0].args.at(-1), "C:\\cache folder\\说明.docx");
  assert.match(calls[0].args.at(-2), /Start-Process -FilePath \$targetPath/);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});
