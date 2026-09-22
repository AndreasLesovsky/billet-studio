import { openSync, readSync, closeSync } from 'node:fs';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CREDIT_MAX_LENGTH = 255;

/** Reads only the JSON chunk of a GLB, without loading the binary chunk. */
export function readGlbJson(path) {
  const fd = openSync(path, 'r');
  try {
    const header = Buffer.alloc(20);
    readSync(fd, header, 0, 20, 0);
    if (header.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${path}: not a GLB file`);
    if (header.readUInt32LE(16) !== CHUNK_JSON) throw new Error(`${path}: first chunk is not JSON`);
    const json = Buffer.alloc(header.readUInt32LE(12));
    readSync(fd, json, 0, json.length, 20);
    return JSON.parse(json.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

// Sketchfab writes "Name (https://...)"; the URL part is dropped so the credit stays short.
const stripTrailingUrl = (value) =>
  String(value ?? '')
    .replace(/\s*\((?:https?:)?\/\/[^)]*\)\s*$/, '')
    .trim();

/**
 * Attribution from asset.extras (Sketchfab exports: title, author, license, source) or, failing
 * that, asset.copyright. Returns null when the file carries neither.
 */
export function readCredit(gltfJson) {
  const extras = gltfJson.asset?.extras ?? {};
  const title = stripTrailingUrl(extras.title);
  const author = stripTrailingUrl(extras.author);
  const license = stripTrailingUrl(extras.license);
  const source = String(extras.source ?? '').trim();
  let credit = null;
  if (title || author) {
    credit = [title || 'Untitled', author && `by ${author}`, license && `(${license})`, source]
      .filter(Boolean)
      .join(' ');
  } else if (gltfJson.asset?.copyright?.trim()) {
    credit = gltfJson.asset.copyright.trim();
  }
  if (credit === null) return null;
  // VARCHAR(255) counts characters, not bytes.
  const chars = [...credit];
  return chars.length > CREDIT_MAX_LENGTH
    ? chars.slice(0, CREDIT_MAX_LENGTH - 1).join('') + '…'
    : credit;
}
