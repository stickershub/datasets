import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walkFiles(full) : [full];
    });
}

export function relativePath(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function datasetFiles() {
  const files = [];
  const dataRoot = path.join(ROOT, 'data');
  if (fs.existsSync(dataRoot)) files.push(...walkFiles(dataRoot));

  const indexPath = path.join(ROOT, 'collections.json');
  if (fs.existsSync(indexPath)) files.push(indexPath);

  const reportsRoot = path.join(ROOT, 'reports');
  if (fs.existsSync(reportsRoot)) files.push(...walkFiles(reportsRoot));

  return files;
}

export function writeChecksums() {
  const files = datasetFiles()
    .map((file) => path.resolve(file))
    .sort((a, b) => relativePath(a).localeCompare(relativePath(b)));
  const lines = files.map((file) => `${sha256(file)}  ${relativePath(file)}`);
  fs.writeFileSync(path.join(ROOT, 'checksums.sha256'), `${lines.join('\n')}\n`);
  return { files: files.length, path: path.join(ROOT, 'checksums.sha256') };
}
