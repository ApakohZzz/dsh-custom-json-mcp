#!/usr/bin/env node
// Verify package identity, packaged files, documentation links and the Boxicons provenance.
// --check-source also downloads the pinned upstream files and compares them byte for byte.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMarkdown, decodePng, root } from './lib.mjs';

const base = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, base));
const json = path => JSON.parse(read(path));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function validate(checkSource = false) {
  const pkg = json('package.json'), upstream = json('upstream.json');
  assert.equal(pkg.name, 'dsh-custom-json-mcp');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.exports['./client'], './lib/client.js');
  for (const lang of ['zh', 'en']) {
    const meta = json(`locale/${lang}.json`).meta;
    assert.ok(meta.title && meta.description, `locale/${lang}.json needs meta.title and meta.description`);
  }
  assert.equal(upstream.repository, 'https://github.com/box-icons/boxicons-core');
  assert.equal(upstream.license, 'MIT');
  assert.match(upstream.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(upstream.files.map(file => [file.path, file.sourcePath]), [['upstream/bx-mcp.svg', 'svg/brands/bx-mcp.svg'], ['upstream/LICENSE', 'LICENSE']]);
  for (const file of upstream.files) {
    assert.equal(file.url, `https://raw.githubusercontent.com/box-icons/boxicons-core/${upstream.commit}/${file.sourcePath}`);
    assert.equal(sha256(read(file.path)), file.sha256, file.path);
    if (checkSource) {
      const response = await fetch(file.url, { signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, `${file.url}: HTTP ${response.status}`);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), read(file.path), `${file.path}: official source differs`);
    }
  }
  assert.match(read('upstream/LICENSE').toString(), /^MIT License\n\nCopyright \(c\) 2026 Boxicons/);
  assert.equal(upstream.derived.path, 'icon.png');
  assert.equal(upstream.derived.generator, 'tools/generate-icon.mjs');
  assert.equal(sha256(read('icon.png')), upstream.derived.sha256, 'icon.png differs from the recorded derived SHA256');
  const icon = decodePng(read('icon.png'));
  assert.ok(icon.width === icon.height && icon.width >= 64 && read('icon.png').length <= 256 * 1024, 'icon must be a square PNG of at least 64px and at most 256 KiB');
  // The sidebar glyph embeds the original path data verbatim.
  const client = read('lib/client.js').toString();
  for (const [, path] of read('upstream/bx-mcp.svg').toString().matchAll(/ d="([^"]+)"/g)) assert.ok(client.includes(`'${path}'`), 'lib/client.js must embed the original Boxicons paths');
  for (const file of ['README.md', 'README.en.md']) assert.deepEqual(checkMarkdown(file, root).errors, [], file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === '--check-source', 'Usage: node tools/validate.mjs [--check-source]');
    await validate(process.argv.includes('--check-source'));
    console.log('Package, documentation, Boxicons glyph and provenance verified.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
