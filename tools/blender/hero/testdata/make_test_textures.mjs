// Generates the orientation test prints for the hero card (tools/blender/hero/testdata/*.png).
// Big labels, up arrows, a light grid and coloured corner markers (TL red, TR green, BL blue,
// BR amber) make any mirroring or rotation in the UV layout obvious in a render.
//
// Run from anywhere (sharp is resolved from tools/asset-pipeline/node_modules):
//   node tools/blender/hero/testdata/make_test_textures.mjs
// The committed PNGs are the source of truth: labels use installed system fonts, so the bytes
// (not the layout) can differ on a machine without Arial.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../../asset-pipeline/package.json'));
const sharp = require('sharp');

const PAGE_W = 1050; // A6 at 10 px/mm
const PAGE_H = 1480;
const FONT = 'Arial, Helvetica, sans-serif';

/** One page (A6 portrait) at horizontal offset ox, as SVG fragments. */
function page(ox, label, accent) {
  const parts = [];
  // light 5 mm grid, stronger every 25 mm
  for (let x = 0; x <= PAGE_W; x += 50) {
    const strong = x % 250 === 0;
    parts.push(`<line x1="${ox + x}" y1="0" x2="${ox + x}" y2="${PAGE_H}" stroke="${strong ? '#c9c2b4' : '#e4dfd5'}" stroke-width="${strong ? 3 : 1.5}"/>`);
  }
  for (let y = 0; y <= PAGE_H; y += 50) {
    const strong = y % 250 === 0;
    parts.push(`<line x1="${ox}" y1="${y}" x2="${ox + PAGE_W}" y2="${y}" stroke="${strong ? '#c9c2b4' : '#e4dfd5'}" stroke-width="${strong ? 3 : 1.5}"/>`);
  }
  // corner markers
  const m = 150;
  const corners = [
    [0, 0, '#e02424', 'TL'],
    [PAGE_W - m, 0, '#15a34a', 'TR'],
    [0, PAGE_H - m, '#2563eb', 'BL'],
    [PAGE_W - m, PAGE_H - m, '#f59e0b', 'BR'],
  ];
  for (const [x, y, c, t] of corners) {
    parts.push(`<rect x="${ox + x}" y="${y}" width="${m}" height="${m}" fill="${c}"/>`);
    parts.push(`<text x="${ox + x + m / 2}" y="${y + m / 2 + 22}" font-family="${FONT}" font-weight="700" font-size="64" fill="#fff" text-anchor="middle">${t}</text>`);
  }
  // up arrow
  const cx = ox + PAGE_W / 2;
  parts.push(`<path d="M ${cx} 230 L ${cx + 150} 430 L ${cx + 55} 430 L ${cx + 55} 640 L ${cx - 55} 640 L ${cx - 55} 430 L ${cx - 150} 430 Z" fill="${accent}"/>`);
  parts.push(`<text x="${cx}" y="720" font-family="${FONT}" font-weight="700" font-size="70" fill="${accent}" text-anchor="middle">UP</text>`);
  // label (two lines so it stays huge)
  const [l1, l2] = label;
  parts.push(`<text x="${cx}" y="960" font-family="${FONT}" font-weight="700" font-size="210" fill="#1f2430" text-anchor="middle">${l1}</text>`);
  if (l2) parts.push(`<text x="${cx}" y="1190" font-family="${FONT}" font-weight="700" font-size="210" fill="${accent}" text-anchor="middle">${l2}</text>`);
  // asymmetric reading aid
  parts.push(`<text x="${ox + 180}" y="${PAGE_H - 60}" font-family="${FONT}" font-weight="700" font-size="54" fill="#1f2430">abc 123 →</text>`);
  return parts.join('\n');
}

async function write(file, width, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${PAGE_H}" viewBox="0 0 ${width} ${PAGE_H}">
<rect width="${width}" height="${PAGE_H}" fill="#f7f3ec"/>
${body}
</svg>`;
  const out = join(here, file);
  await sharp(Buffer.from(svg)).flatten({ background: '#f7f3ec' }).png({ compressionLevel: 9 }).toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`${file}: ${meta.width}x${meta.height}`);
}

await write('print_front_test.png', PAGE_W, page(0, ['FRONT', ''], '#7c3aed'));
await write(
  'print_inside_test.png',
  PAGE_W * 2,
  [
    page(0, ['INSIDE', 'L'], '#0e7490'),
    page(PAGE_W, ['INSIDE', 'R'], '#be185d'),
    `<line x1="${PAGE_W}" y1="0" x2="${PAGE_W}" y2="${PAGE_H}" stroke="#1f2430" stroke-width="4" stroke-dasharray="30 20"/>`,
  ].join('\n'),
);
