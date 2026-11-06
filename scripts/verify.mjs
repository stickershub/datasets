#!/usr/bin/env node
/**
 * Verify the dataset index, collection manifests, asset files, and checksums.
 *
 * Run after every import or manual change:
 *   node scripts/verify.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import AjvImport from 'ajv';
import sharp from 'sharp';
import {
  ROOT,
  datasetFiles,
  readJson,
  relativePath,
  sha256,
  walkFiles,
} from './lib/dataset.mjs';

const Ajv = AjvImport.default ?? AjvImport;
const problems = [];
const warnings = [];
const referenced = new Set();
const KNOWN_COUNTS = {
  pepe: { total: 202, static: 120, gif: 96, both: 14, files: 216 },
};

function fail(message) {
  problems.push(message);
}

function warn(message) {
  warnings.push(message);
}

function formatAjv(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function isSafeRelative(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (path.isAbsolute(value) || value.includes('\\')) return false;
  const segments = value.split('/');
  return !segments.includes('..') && !segments.includes('');
}

function resolveDatasetPath(value, label, base = ROOT) {
  if (!isSafeRelative(value)) {
    fail(`${label} is not a safe relative path: ${JSON.stringify(value)}`);
    return null;
  }
  const full = path.resolve(base, value);
  if (full !== ROOT && !full.startsWith(`${ROOT}${path.sep}`)) {
    fail(`${label} escapes the dataset root: ${value}`);
    return null;
  }
  return full;
}

function checkFile(value, expectedBytes, expectedSha, label, base = ROOT) {
  const full = resolveDatasetPath(value, label, base);
  if (!full) return null;

  if (!fs.existsSync(full)) {
    fail(`${label} does not exist: ${value}`);
    return null;
  }

  const stat = fs.statSync(full);
  if (stat.size !== expectedBytes) {
    fail(`${label} byte count is ${stat.size}, expected ${expectedBytes}: ${value}`);
  }
  const hash = sha256(full);
  if (hash !== expectedSha) {
    fail(`${label} sha256 is ${hash}, expected ${expectedSha}: ${value}`);
  }
  return full;
}

async function checkDimensions(full, expectedWidth, expectedHeight, label) {
  if (!full) return;
  const metadata = await sharp(full).metadata();
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
    fail(
      `${label} dimensions are ${metadata.width} x ${metadata.height}, expected ${expectedWidth} x ${expectedHeight}: ${relativePath(full)}`,
    );
  }
}

function checkKnownCounts(id, stats) {
  const expected = KNOWN_COUNTS[id];
  if (!expected) return;
  for (const [key, value] of Object.entries(expected)) {
    if (stats[key] !== value) {
      fail(`Known collection ${id} has stats.${key}=${stats[key]}, expected ${value}`);
    }
  }
}

function checkDate(value, label) {
  if (Number.isNaN(Date.parse(value))) {
    fail(`${label} is not a valid date: ${JSON.stringify(value)}`);
  }
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateIndex = ajv.compile(readJson(path.join(ROOT, 'schema', 'index.schema.json')));
const validateCollection = ajv.compile(
  readJson(path.join(ROOT, 'schema', 'collection.schema.json')),
);

const indexPath = path.join(ROOT, 'collections.json');
let index = null;
if (!fs.existsSync(indexPath)) {
  fail('Missing collections.json');
} else {
  index = readJson(indexPath);
  if (!validateIndex(index)) {
    fail(`collections.json schema validation failed: ${formatAjv(validateIndex.errors)}`);
  }
  checkDate(index.generatedAt, 'collections.json generatedAt');

  const seenIds = new Set();
  const seenPaths = new Set();
  for (const entry of index.collections ?? []) {
    if (seenIds.has(entry.id)) fail(`Duplicate collection id in collections.json: ${entry.id}`);
    if (seenPaths.has(entry.path)) fail(`Duplicate collection path in collections.json: ${entry.path}`);
    seenIds.add(entry.id);
    seenPaths.add(entry.path);
  }
}

let stickerTotal = 0;
let fileTotal = 0;
let checksumTotal = 0;

if (index) {
  for (const entry of index.collections) {
    const manifestPath = resolveDatasetPath(entry.path, `collection ${entry.id} path`);
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      if (manifestPath) fail(`Missing collection manifest: ${entry.path}`);
      continue;
    }

    const manifest = readJson(manifestPath);
    if (!validateCollection(manifest)) {
      fail(
        `Collection ${entry.id} schema validation failed: ${formatAjv(validateCollection.errors)}`,
      );
    }
    checkDate(manifest.generatedAt, `Collection ${entry.id} generatedAt`);

    if (manifest.id !== entry.id) {
      fail(`Collection ${entry.id} manifest id is ${manifest.id}`);
    }
    if (manifest.slug !== manifest.id) {
      fail(`Collection ${entry.id} slug does not match id: ${manifest.slug}`);
    }
    if (entry.path !== relativePath(manifestPath)) {
      fail(`Collection ${entry.id} path is not canonical: ${entry.path}`);
    }
    if (entry.schemaVersion !== manifest.schemaVersion) {
      fail(`Collection ${entry.id} schemaVersion differs between index and manifest`);
    }
    if (JSON.stringify(entry.stats) !== JSON.stringify(manifest.stats)) {
      fail(`Collection ${entry.id} stats differ between index and manifest`);
    }
    if (entry.source.repo !== manifest.source.repo) {
      fail(`Collection ${entry.id} source.repo differs between index and manifest`);
    }
    if (entry.source.commit !== manifest.source.commit) {
      fail(`Collection ${entry.id} source.commit differs between index and manifest`);
    }

    checkKnownCounts(manifest.id, manifest.stats);

    const categoryIds = new Set();
    let categoryTotal = 0;
    for (const category of manifest.categories) {
      if (categoryIds.has(category.id)) {
        fail(`Collection ${manifest.id} has duplicate category: ${category.id}`);
      }
      categoryIds.add(category.id);
      categoryTotal += category.count;
    }
    if (categoryTotal !== manifest.stats.total) {
      fail(
        `Collection ${manifest.id} category counts total ${categoryTotal}, expected ${manifest.stats.total}`,
      );
    }

    const collectionRoot = path.join(ROOT, 'data', manifest.id);
    const stickerIds = new Set();
    const stickerSlugs = new Set();
    const actual = {
      static: 0,
      gif: 0,
      both: 0,
      total: manifest.stickers.length,
      category: new Map(),
    };

    for (const sticker of manifest.stickers) {
      if (stickerIds.has(sticker.id)) {
        fail(`Collection ${manifest.id} has duplicate sticker id: ${sticker.id}`);
      }
      if (stickerSlugs.has(sticker.slug)) {
        fail(`Collection ${manifest.id} has duplicate sticker slug: ${sticker.slug}`);
      }
      stickerIds.add(sticker.id);
      stickerSlugs.add(sticker.slug);

      if (!categoryIds.has(sticker.category)) {
        fail(`Sticker ${sticker.id} uses unknown category: ${sticker.category}`);
      }
      if (!actual.category.has(sticker.category)) {
        actual.category.set(sticker.category, { count: 0, static: 0, gif: 0 });
      }
      const categoryActual = actual.category.get(sticker.category);
      categoryActual.count += 1;

      const hasStatic = Boolean(sticker.variants.static);
      const hasGif = Boolean(sticker.variants.gif);
      if (!hasStatic && !hasGif) {
        fail(`Sticker ${sticker.id} has no variants`);
      }
      if (hasStatic) {
        actual.static += 1;
        categoryActual.static += 1;
      }
      if (hasGif) {
        actual.gif += 1;
        categoryActual.gif += 1;
      }
      if (hasStatic && hasGif) actual.both += 1;

      for (const type of ['static', 'gif']) {
        const variant = sticker.variants[type];
        if (!variant) continue;
        const expectedPrefix = type === 'static' ? 'static/' : 'gif/';
        if (!variant.src.startsWith(expectedPrefix)) {
          fail(`Sticker ${sticker.id} ${type} src has wrong prefix: ${variant.src}`);
        }
        if (!variant.sourcePath.startsWith(`emojis/${type}/`)) {
          fail(`Sticker ${sticker.id} ${type} sourcePath has wrong prefix: ${variant.sourcePath}`);
        }
        if (!variant.sourceUrl.startsWith(`${manifest.source.repo}/blob/${manifest.source.commit}/`)) {
          fail(`Sticker ${sticker.id} ${type} sourceUrl does not match the pinned commit`);
        }

        const full = checkFile(
          variant.src,
          variant.bytes,
          variant.sha256,
          `Sticker ${sticker.id} ${type} asset`,
          collectionRoot,
        );
        if (full) {
          referenced.add(full);
          await checkDimensions(full, variant.width, variant.height, `Sticker ${sticker.id} ${type}`);
          if (manifest.id === 'pepe' && (variant.width !== 64 || variant.height !== 64)) {
            fail(`Pepe sticker ${sticker.id} ${type} is not 64 x 64`);
          }
        }

        if (type === 'gif') {
          if (!variant.poster.startsWith('posters/')) {
            fail(`Sticker ${sticker.id} poster has wrong prefix: ${variant.poster}`);
          }
          if (!Number.isInteger(variant.frames) || variant.frames < 1) {
            fail(`Sticker ${sticker.id} has invalid frame count: ${variant.frames}`);
          }
          if (
            !Number.isInteger(variant.posterFrame) ||
            variant.posterFrame < 0 ||
            variant.posterFrame >= variant.frames
          ) {
            fail(`Sticker ${sticker.id} has invalid posterFrame: ${variant.posterFrame}`);
          }
          if (variant.posterCoverage < 0 || variant.posterCoverage > 100) {
            fail(`Sticker ${sticker.id} has invalid posterCoverage: ${variant.posterCoverage}`);
          }
          const poster = checkFile(
            variant.poster,
            variant.posterBytes,
            variant.posterSha256,
            `Sticker ${sticker.id} poster`,
            collectionRoot,
          );
          if (poster) {
            referenced.add(poster);
            await checkDimensions(poster, variant.width, variant.height, `Sticker ${sticker.id} poster`);
          }
        }
      }
    }

    for (const category of manifest.categories) {
      const categoryActual = actual.category.get(category.id) ?? { count: 0, static: 0, gif: 0 };
      if (category.count !== categoryActual.count) {
        fail(
          `Category ${category.id} count is ${category.count}, expected ${categoryActual.count}`,
        );
      }
      if (category.static !== categoryActual.static) {
        fail(
          `Category ${category.id} static count is ${category.static}, expected ${categoryActual.static}`,
        );
      }
      if (category.gif !== categoryActual.gif) {
        fail(`Category ${category.id} gif count is ${category.gif}, expected ${categoryActual.gif}`);
      }
    }

    for (const [key, value] of Object.entries(actual)) {
      if (key === 'category') continue;
      if (manifest.stats[key] !== value) {
        fail(`Collection ${manifest.id} stats.${key} is ${manifest.stats[key]}, expected ${value}`);
      }
    }
    if (manifest.stats.files !== actual.static + actual.gif) {
      fail(
        `Collection ${manifest.id} stats.files is ${manifest.stats.files}, expected ${actual.static + actual.gif}`,
      );
    }

    for (const type of ['static', 'gif', 'posters']) {
      const dir = path.join(collectionRoot, type);
      for (const file of walkFiles(dir)) {
        if (!referenced.has(file)) {
          fail(`Unreferenced asset: ${relativePath(file)}`);
        }
      }
    }

    stickerTotal += manifest.stats.total;
    fileTotal += manifest.stats.files;
    console.log(
      `Collection ${manifest.id}: ${manifest.stats.total} stickers, ${manifest.stats.static} static, ${manifest.stats.gif} GIF, ${manifest.stats.both} dual-format.`,
    );
  }

  for (const dir of fs.readdirSync(path.join(ROOT, 'data'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifestPath = path.join(ROOT, 'data', dir.name, 'collection.json');
    if (!fs.existsSync(manifestPath)) continue;
    if (!index.collections.some((entry) => entry.path === relativePath(manifestPath))) {
      fail(`Collection manifest is not listed in collections.json: ${relativePath(manifestPath)}`);
    }
  }
}

const checksumsPath = path.join(ROOT, 'checksums.sha256');
if (!fs.existsSync(checksumsPath)) {
  fail('Missing checksums.sha256');
} else {
  const lines = fs
    .readFileSync(checksumsPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const checksums = new Map();
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/);
    if (!match) {
      fail(`Invalid checksum line: ${line}`);
      continue;
    }
    const [, hash, file] = match;
    if (checksums.has(file)) fail(`Duplicate checksum entry: ${file}`);
    checksums.set(file, hash);
  }

  const expected = new Map(datasetFiles().map((file) => [relativePath(file), file]));
  for (const [relative, file] of expected) {
    if (!checksums.has(relative)) {
      fail(`Missing checksum entry: ${relative}`);
      continue;
    }
    const hash = sha256(file);
    if (hash !== checksums.get(relative)) {
      fail(`Checksum mismatch: ${relative}`);
    }
  }
  for (const relative of checksums.keys()) {
    if (!expected.has(relative)) {
      fail(`Checksum entry points to a missing or unexpected file: ${relative}`);
    }
  }
  checksumTotal = checksums.size;
}

if (warnings.length) {
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
}

if (problems.length > 0) {
  console.error(`Dataset validation failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Dataset OK: ${index?.collections.length ?? 0} collection(s), ${stickerTotal} stickers, ${fileTotal} assets, ${datasetFiles().length} files, ${checksumTotal} checksums.`,
);
