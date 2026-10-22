// Shared checks for the standalone repository: packaged file list, Markdown links/anchors and PNG decoding.
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'dev', 'package.json'));

/** Decode a PNG into RGBA pixels with the pinned pngjs. */
export function decodePng(bytes) {
  const { PNG } = require('pngjs');
  const image = PNG.sync.read(bytes);
  return { width: image.width, height: image.height, data: image.data };
}

function walk(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(dir, path));
    else files.push(path);
  }
  return files;
}

/**
 * The files `npm pack` publishes for this package: the `files` whitelist plus npm's always-included root documents.
 * Mirrors npm-packlist for the explicit, glob-free whitelist this package uses.
 */
export function packagedFiles(dir = root) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (!Array.isArray(pkg.files)) throw new Error('package.json files must be an explicit list');
  const result = new Set(['package.json']);
  for (const item of pkg.files) {
    if (typeof item !== 'string' || /[*!?[\]{}]/.test(item)) throw new Error(`package.json files entry must be an explicit path: ${item}`);
    const path = join(dir, item);
    if (!existsSync(path)) throw new Error(`package.json files entry is missing: ${item}`);
    if (lstatSync(path).isDirectory()) walk(dir, item).forEach(file => result.add(file));
    else result.add(item);
  }
  for (const name of readdirSync(dir)) if (/^(README|LICEN[CS]E|NOTICE)(\..*)?$/i.test(name) && statSync(join(dir, name)).isFile()) result.add(name);
  return [...result].sort();
}

function prose(content) {
  return content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
}

/** GitHub-style heading anchors of one Markdown document. */
export function anchors(content) {
  const result = new Set();
  const counts = new Map();
  for (const match of prose(content).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1].replace(/<[^>]*>/g, '').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    result.add(count ? `${slug}-${count}` : slug);
  }
  for (const match of content.matchAll(/<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["']/gi)) result.add(match[1]);
  return result;
}

/** Local links, images and anchors of one Markdown file must resolve inside the repository. */
export function checkMarkdown(file, dir = root) {
  const errors = [];
  const path = resolve(dir, file);
  const content = readFileSync(path, 'utf8');
  const text = prose(content);
  const refs = [...text.matchAll(/!?\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\)/g)].map(match => match[1] ?? match[2]);
  for (const match of text.matchAll(/\b(?:href|src|srcset)=["']([^"']+)["']/gi)) refs.push(match[1]);
  for (const ref of refs) {
    if (/^(?:https?:|mailto:|\/\/)/i.test(ref)) continue;
    const hash = ref.indexOf('#');
    const urlPath = decodeURIComponent((hash < 0 ? ref : ref.slice(0, hash)).split('?')[0]);
    const fragment = hash < 0 ? '' : decodeURIComponent(ref.slice(hash + 1));
    const target = urlPath ? resolve(dirname(path), urlPath) : path;
    const rel = relative(dir, target);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) errors.push(`${file}: link escapes repository: ${ref}`);
    else if (!existsSync(target)) errors.push(`${file}: missing local target: ${ref}`);
    else if (fragment && /\.md$/i.test(target) && !anchors(readFileSync(target, 'utf8')).has(fragment)) errors.push(`${file}: missing anchor: ${ref}`);
  }
  if ((content.match(/^```/gm) ?? []).length % 2) errors.push(`${file}: unclosed code fence`);
  return { errors, links: refs.length };
}
