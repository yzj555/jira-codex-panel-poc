import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_TEXT_CHARS = 32_000;

const WINDOWS_OCR_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
  Select-Object -First 1
function Await-WinRt($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  try { $task.Wait() } catch {
    if ($null -ne $task.Exception -and $null -ne $task.Exception.InnerException) {
      throw $task.Exception.InnerException
    }
    throw
  }
  return $task.Result
}
$path = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrWhiteSpace($path)) { throw 'Image path is empty.' }
$path = [IO.Path]::GetFullPath($path)
$file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'Windows OCR language pack is unavailable.' }
$result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
[Console]::Out.Write($result.Text)
`;

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/([\p{Script=Han}，。！？；：、“”‘’（）])[ \t]+(?=[\p{Script=Han}，。！？；：、“”‘’（）])/gu, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function executeProcess(command, args, { input = "", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", error });
      return;
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const collect = (target, chunk, kind) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (kind === "stdout") stdoutBytes += buffer.byteLength;
      else stderrBytes += buffer.byteLength;
      if ((kind === "stdout" ? stdoutBytes : stderrBytes) <= MAX_OUTPUT_BYTES) target.push(buffer);
    };
    child.stdout?.on("data", (chunk) => collect(stdout, chunk, "stdout"));
    child.stderr?.on("data", (chunk) => collect(stderr, chunk, "stderr"));
    child.on("error", (error) => finish({ code: null, stdout: "", stderr: "", error }));
    child.on("close", (code) => finish({
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      error: null
    }));
    timer = setTimeout(() => {
      child.kill?.();
      finish({ code: null, stdout: "", stderr: "OCR timed out.", error: new Error("OCR timed out.") });
    }, Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    timer.unref?.();
    child.stdin?.end(String(input), "utf8");
  });
}

function failureText(result) {
  return normalizeText(result?.error?.message || result?.stderr || `process exited with code ${result?.code}`);
}

export function createLocalImageOcr({
  platform = process.platform,
  execute = executeProcess,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof execute !== "function") throw new TypeError("execute must be a function.");

  async function recognize(filePath) {
    const path = String(filePath || "").trim();
    if (!path) throw new TypeError("filePath is required.");
    const failures = [];

    if (platform === "win32") {
      const result = await execute("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WINDOWS_OCR_SCRIPT
      ], { input: path, timeoutMs });
      if (result?.code === 0) {
        const text = normalizeText(result.stdout);
        if (text) return { available: true, text, engine: "windows-media-ocr" };
        failures.push("Windows OCR 未识别到文字。");
      } else {
        failures.push(`Windows OCR：${failureText(result) || "不可用"}`);
      }
    }

    for (const languages of ["chi_sim+eng", "eng"]) {
      const result = await execute("tesseract", [path, "stdout", "-l", languages, "--psm", "6"], {
        timeoutMs
      });
      if (result?.code === 0) {
        const text = normalizeText(result.stdout);
        if (text) return { available: true, text, engine: `tesseract:${languages}` };
        failures.push(`Tesseract (${languages}) 未识别到文字。`);
        break;
      }
      failures.push(`Tesseract (${languages})：${failureText(result) || "不可用"}`);
      if (result?.error?.code === "ENOENT") break;
    }

    return {
      available: false,
      text: "",
      engine: "",
      error: failures.filter(Boolean).join("；").slice(0, 2_000) || "本地 OCR 不可用。"
    };
  }

  return { recognize };
}

export async function runLocalImageOcr(input, options) {
  return createLocalImageOcr(options).recognize(input?.filePath);
}
