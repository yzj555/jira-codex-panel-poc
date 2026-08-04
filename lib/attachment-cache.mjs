import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitizeAttachmentFilename(value, attachmentId = "attachment") {
  const fallback = `attachment-${attachmentId}`;
  let filename = String(value || fallback)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!filename) filename = fallback;
  if (WINDOWS_RESERVED_NAME.test(filename)) filename = `_${filename}`;
  if (filename.length > 180) {
    const dotIndex = filename.lastIndexOf(".");
    const extension = dotIndex > 0 && filename.length - dotIndex <= 20 ? filename.slice(dotIndex) : "";
    filename = `${filename.slice(0, 180 - extension.length)}${extension}`;
  }
  return filename;
}

async function cachedFileIsUsable(filePath, expectedLength) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
    const length = Number(expectedLength || 0);
    return length > 0 ? fileStat.size === length : fileStat.size > 0;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function materializeAttachment({ cacheRoot, attachmentId, attachment }) {
  const normalizedId = String(attachmentId || "");
  if (!/^\d+$/.test(normalizedId)) throw new Error("Attachment ID must be numeric.");
  if (!attachment?.body) throw new Error("Attachment response has no body.");

  const filename = sanitizeAttachmentFilename(attachment.filename, normalizedId);
  const directory = join(cacheRoot, normalizedId);
  const filePath = join(directory, filename);
  await mkdir(directory, { recursive: true });

  if (await cachedFileIsUsable(filePath, attachment.contentLength)) {
    await attachment.body.cancel?.().catch(() => {});
    const fileStat = await stat(filePath);
    return {
      path: filePath,
      filename,
      mimeType: attachment.contentType || "application/octet-stream",
      size: fileStat.size,
      cached: true
    };
  }

  const temporaryPath = join(directory, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await pipeline(Readable.fromWeb(attachment.body), createWriteStream(temporaryPath, { flags: "wx" }));
    await rm(filePath, { force: true });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  const fileStat = await stat(filePath);
  return {
    path: filePath,
    filename,
    mimeType: attachment.contentType || "application/octet-stream",
    size: fileStat.size,
    cached: false
  };
}
