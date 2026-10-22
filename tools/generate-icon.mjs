#!/usr/bin/env node
// Render the Connectors icon: the original Boxicons "bx-mcp" glyph, byte-checked against upstream.json, centered in
// white on a rounded #374151 tile (the colour the requested Boxicons/iconshelf rendering uses). --check rejects drift.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../dev/package.json', import.meta.url));
const sharp = require('sharp');
const base = new URL('../', import.meta.url);
const upstream = JSON.parse(readFileSync(new URL('upstream.json', base), 'utf8'));
const glyph = upstream.files.find(file => file.path === 'upstream/bx-mcp.svg');
const original = readFileSync(new URL(glyph.path, base));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha256(original) !== glyph.sha256) throw new Error('upstream/bx-mcp.svg differs from the recorded Boxicons SHA256');

const { size, radius, background, foreground, glyphScale } = upstream.derived.parameters;
const svg = original.toString('utf8');
const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1];
if (viewBox !== '0 0 24 24' || !inner) throw new Error('Unexpected Boxicons SVG structure');
const scale = size * glyphScale / 24, offset = (size - 24 * scale) / 2;
const composed = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
  + `<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>`
  + `<g fill="${foreground}" transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g></svg>`;
const output = await sharp(Buffer.from(composed)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
const target = new URL(upstream.derived.path, base);

if (process.argv.includes('--check')) {
  if (!output.equals(readFileSync(target))) throw new Error('Connectors icon drifted from its Boxicons source; run node tools/generate-icon.mjs');
  if (sha256(output) !== upstream.derived.sha256) throw new Error('upstream.json derived.sha256 is stale; run node tools/generate-icon.mjs');
  console.log('icon.png matches its Boxicons source.');
} else {
  writeFileSync(target, output);
  upstream.derived.sha256 = sha256(output);
  writeFileSync(new URL('upstream.json', base), `${JSON.stringify(upstream, null, 2)}\n`);
  console.log(`icon.png ${upstream.derived.sha256}`);
}
