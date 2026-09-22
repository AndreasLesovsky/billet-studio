import { brotliDecompressSync } from 'node:zlib';

// Known-tag table from the WOFF2 spec, section 5.1 (index = 6-bit flag value).
// prettier-ignore
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

function readBase128(buf, state) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[state.pos++];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error('invalid UIntBase128');
}

function tagString(n) {
  return String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

/** Returns the raw (untransformed) sfnt tables cmap, OS/2 and fvar of a WOFF2 file. */
function readTables(buf) {
  if (buf.readUInt32BE(0) !== 0x774f4632) throw new Error('not a WOFF2 file');
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  const state = { pos: 48 };
  const entries = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[state.pos++];
    const tagIndex = flags & 0x3f;
    const version = flags >> 6;
    let tag;
    if (tagIndex === 63) {
      tag = tagString(buf.readUInt32BE(state.pos));
      state.pos += 4;
    } else {
      tag = KNOWN_TAGS[tagIndex];
    }
    const origLength = readBase128(buf, state);
    // glyf/loca: version 0 means transformed; every other table: non-zero means transformed.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const length = transformed ? readBase128(buf, state) : origLength;
    entries.push({ tag, length, transformed });
  }
  const data = brotliDecompressSync(buf.subarray(state.pos, state.pos + compressedSize));
  const tables = {};
  let offset = 0;
  for (const entry of entries) {
    if (!entry.transformed) tables[entry.tag] = data.subarray(offset, offset + entry.length);
    offset += entry.length;
  }
  return tables;
}

function readCmap(cmap) {
  const codepoints = new Set();
  if (!cmap) return codepoints;
  const count = cmap.readUInt16BE(2);
  const subtables = [];
  for (let i = 0; i < count; i++) {
    const rec = 4 + i * 8;
    const platform = cmap.readUInt16BE(rec);
    const encoding = cmap.readUInt16BE(rec + 2);
    const offset = cmap.readUInt32BE(rec + 4);
    subtables.push({ platform, encoding, offset, format: cmap.readUInt16BE(offset) });
  }
  const unicode = (s) =>
    s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10));
  const best =
    subtables.find((s) => unicode(s) && s.format === 12) ??
    subtables.find((s) => unicode(s) && s.format === 4);
  if (!best) return codepoints;
  const o = best.offset;
  if (best.format === 12) {
    const groups = cmap.readUInt32BE(o + 12);
    for (let g = 0; g < groups; g++) {
      const p = o + 16 + g * 12;
      const start = cmap.readUInt32BE(p);
      const end = cmap.readUInt32BE(p + 4);
      const glyph = cmap.readUInt32BE(p + 8);
      for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) codepoints.add(c);
    }
    return codepoints;
  }
  const segCount = cmap.readUInt16BE(o + 6) / 2;
  const endAt = o + 14;
  const startAt = endAt + segCount * 2 + 2;
  const deltaAt = startAt + segCount * 2;
  const rangeAt = deltaAt + segCount * 2;
  for (let s = 0; s < segCount; s++) {
    const end = cmap.readUInt16BE(endAt + s * 2);
    const start = cmap.readUInt16BE(startAt + s * 2);
    const delta = cmap.readInt16BE(deltaAt + s * 2);
    const rangeOffset = cmap.readUInt16BE(rangeAt + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (c + delta) & 0xffff;
      } else {
        const addr = rangeAt + s * 2 + rangeOffset + (c - start) * 2;
        glyph = cmap.readUInt16BE(addr);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) codepoints.add(c);
    }
  }
  return codepoints;
}

function readFvar(fvar) {
  const axes = {};
  if (!fvar) return axes;
  const axesOffset = fvar.readUInt16BE(4);
  const axisCount = fvar.readUInt16BE(8);
  const axisSize = fvar.readUInt16BE(10);
  for (let i = 0; i < axisCount; i++) {
    const p = axesOffset + i * axisSize;
    axes[tagString(fvar.readUInt32BE(p))] = {
      min: fvar.readInt32BE(p + 4) / 65536,
      default: fvar.readInt32BE(p + 8) / 65536,
      max: fvar.readInt32BE(p + 12) / 65536,
    };
  }
  return axes;
}

/**
 * Reads what the pipeline needs from a WOFF2 file: mapped code points, OS/2 weight class and
 * italic bit, and variation axes.
 */
export function inspectWoff2(buf) {
  const tables = readTables(buf);
  const os2 = tables['OS/2'];
  return {
    codepoints: readCmap(tables['cmap']),
    weightClass: os2 ? os2.readUInt16BE(4) : null,
    italic: os2 && os2.length >= 64 ? (os2.readUInt16BE(62) & 1) === 1 : null,
    axes: readFvar(tables['fvar']),
  };
}
