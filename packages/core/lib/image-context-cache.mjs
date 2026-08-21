import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_VERSION = 1;
const MAX_CACHE_RECORD_BYTES = 128 * 1024;
const MAX_CONTEXT_CHARS = 32_000;

function normalizedAttachmentId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 1_000) throw new TypeError("attachmentId is required.");
  return id;
}

function attachmentDirectoryName(id) {
  const readable = id.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const suffix = createHash("sha256").update(id).digest("hex").slice(0, 12);
  return `${readable || "attachment"}-${suffix}`;
}

export function hashImageFile(filePath) {
  const path = String(filePath || "").trim();
  if (!path) return Promise.reject(new TypeError("filePath is required."));
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function normalizedRecord(value, { attachmentId, sha256 }) {
  if (!value || typeof value !== "object") return null;
  if (Number(value.version) !== CACHE_VERSION) return null;
  if (String(value.attachmentId || "") !== attachmentId) return null;
  if (String(value.sha256 || "") !== sha256) return null;
  if (value.mode !== "vision" && value.mode !== "ocr") return null;
  const text = String(value.text || "").trim();
  if (!text || text.length > MAX_CONTEXT_CHARS) return null;
  return {
    version: CACHE_VERSION,
    attachmentId,
    sha256,
    filename: String(value.filename || "").slice(0, 1_000),
    mimeType: String(value.mimeType || "").slice(0, 200),
    mode: value.mode,
    text,
    processor: value.processor && typeof value.processor === "object"
      ? {
          kind: String(value.processor.kind || value.mode).slice(0, 100),
          provider: String(value.processor.provider || "").slice(0, 300),
          model: String(value.processor.model || "").slice(0, 300),
          engine: String(value.processor.engine || "").slice(0, 300)
        }
      : { kind: value.mode, provider: "", model: "", engine: "" },
    updatedAt: String(value.updatedAt || "")
  };
}

function keepsExistingRecord(existing, incoming) {
  if (!existing) return false;
  // Visual analysis is richer than OCR. Never let a later OCR write downgrade
  // a visual cache record, while allowing a successful visual call to replace
  // the OCR fallback stored before the user configured a visual model.
  if (existing.mode === "vision") return true;
  return incoming.mode === "ocr";
}

export function createImageContextCache({ cacheRoot } = {}) {
  const root = String(cacheRoot || "").trim();
  if (!root) throw new TypeError("cacheRoot is required.");

  function recordPath(attachmentId, sha256) {
    return join(root, attachmentDirectoryName(attachmentId), `${sha256}.json`);
  }

  async function lookup({ attachmentId, filePath, sha256: suppliedHash } = {}) {
    const id = normalizedAttachmentId(attachmentId);
    const sha256 = String(suppliedHash || "").trim() || await hashImageFile(filePath);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError("sha256 is invalid.");
    try {
      const raw = await readFile(recordPath(id, sha256));
      if (raw.byteLength > MAX_CACHE_RECORD_BYTES) return { sha256, record: null };
      const parsed = JSON.parse(raw.toString("utf8"));
      return { sha256, record: normalizedRecord(parsed, { attachmentId: id, sha256 }) };
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return { sha256, record: null };
      throw error;
    }
  }

  async function store({
    attachmentId,
    filePath,
    sha256: suppliedHash,
    filename = "",
    mimeType = "",
    mode,
    text,
    processor = {}
  } = {}) {
    const id = normalizedAttachmentId(attachmentId);
    if (mode !== "vision" && mode !== "ocr") throw new TypeError("Only successful vision or OCR results are cacheable.");
    const normalizedText = String(text || "").trim().slice(0, MAX_CONTEXT_CHARS);
    if (!normalizedText) throw new TypeError("Image context text is required.");
    const sha256 = String(suppliedHash || "").trim() || await hashImageFile(filePath);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError("sha256 is invalid.");
    const record = normalizedRecord({
      version: CACHE_VERSION,
      attachmentId: id,
      sha256,
      filename,
      mimeType,
      mode,
      text: normalizedText,
      processor,
      updatedAt: new Date().toISOString()
    }, { attachmentId: id, sha256 });
    if (!record) throw new TypeError("Image context cache record is invalid.");
    const destination = recordPath(id, sha256);
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(join(root, attachmentDirectoryName(id)), { recursive: true });
    try {
      const beforeWrite = await lookup({ attachmentId: id, sha256 });
      if (keepsExistingRecord(beforeWrite.record, record)) return beforeWrite.record;
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      try {
        await rename(temporary, destination);
      } catch (error) {
        if (error?.code !== "EEXIST" && error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
        const existing = await lookup({ attachmentId: id, sha256 });
        if (keepsExistingRecord(existing.record, record)) return existing.record;
        if (existing.record?.mode !== "ocr" || record.mode !== "vision") throw error;
        // Windows rename does not replace an existing destination. Cache files
        // are derived and recoverable, so remove only this exact validated OCR
        // record and publish the richer visual result in its place.
        await rm(destination, { force: true });
        await rename(temporary, destination);
      }
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return record;
  }

  return { lookup, store };
}
