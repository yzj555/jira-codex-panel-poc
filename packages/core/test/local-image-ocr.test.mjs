import assert from "node:assert/strict";
import test from "node:test";
import { createLocalImageOcr } from "../lib/local-image-ocr.mjs";

test("Windows 本地 OCR 成功时不会再启动 Tesseract", async () => {
  const calls = [];
  const ocr = createLocalImageOcr({
    platform: "win32",
    async execute(command, args, options) {
      calls.push({ command, args, options });
      return { code: 0, stdout: "  登录失败\r\n请重试  ", stderr: "", error: null };
    }
  });
  const result = await ocr.recognize("C:\\cache\\证据.png");
  assert.deepEqual(result, {
    available: true,
    text: "登录失败\n请重试",
    engine: "windows-media-ocr"
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "powershell.exe");
  assert.equal(calls[0].options.input, "C:\\cache\\证据.png");
});

test("Windows OCR 不可用时降级 Tesseract，全部不可用时返回可识别状态而不抛错", async () => {
  const calls = [];
  const fallback = createLocalImageOcr({
    platform: "win32",
    async execute(command, args) {
      calls.push([command, args]);
      if (command === "powershell.exe") return { code: 1, stdout: "", stderr: "WinRT unavailable", error: null };
      return { code: 0, stdout: "Error 503", stderr: "", error: null };
    }
  });
  assert.deepEqual(await fallback.recognize("C:\\cache\\证据.png"), {
    available: true,
    text: "Error 503",
    engine: "tesseract:chi_sim+eng"
  });
  assert.equal(calls[1][0], "tesseract");

  const unavailable = createLocalImageOcr({
    platform: "linux",
    async execute() {
      const error = new Error("not found");
      error.code = "ENOENT";
      return { code: null, stdout: "", stderr: "", error };
    }
  });
  const result = await unavailable.recognize("/tmp/evidence.png");
  assert.equal(result.available, false);
  assert.equal(result.text, "");
  assert.match(result.error, /not found/);
});
