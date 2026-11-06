#!/usr/bin/env node
/**
 * Import the Pepe sticker pack into the dataset repository.
 *
 * Usage:
 *   node scripts/import-pepe.mjs --source /path/to/pepe_emojis_for_reddit
 *
 * The importer only reads `emojis/static` and `emojis/gif`. The upstream
 * `emojis/source images` folder is intentionally skipped because it contains
 * larger derivatives of the same artwork.
 *
 * Output:
 *   data/pepe/collection.json
 *   data/pepe/static/*.png
 *   data/pepe/gif/*.gif
 *   data/pepe/posters/*.webp
 *   collections.json
 *   reports/pepe-import.json
 *   checksums.sha256
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCHEMA_VERSION = 1;
const DEFAULT_COMMIT = 'f59ebdbc5706fd80c82d6cf5f069405d45f231c8';
const COLLECTION_SLUG = 'pepe';
const SOURCE_REPO = 'https://github.com/pepecoinppc/pepe_emojis_for_reddit';
const SOURCE_NAME = 'Pepe Emojis for Reddit';
const SOURCE_ATTRIBUTION = 'Pepe Emojis for Reddit by Pepecoin.com';

const WORD_OVERRIDES = new Map([
  ['lfg', 'LFG'],
  ['ez', 'EZ'],
  ['pog', 'POG'],
  ['poggers', 'POGGERS'],
  ['kekw', 'KEKW'],
  ['kek', 'KEK'],
  ['sus', 'SUS'],
  ['ree', 'REE'],
  ['reeee', 'REEEE'],
  ['reeeee', 'REEEEE'],
  ['lol', 'LOL'],
  ['omg', 'OMG'],
  ['8', '8'],
  ['bit', 'Bit'],
  ['mcdonalds', "McDonald's"],
  ['minecraft', 'Minecraft'],
  ['wojak', 'Wojak'],
  ['lets', "Let's"],
]);

const NAME_OVERRIDES = new Map([
  ['pepe-feels-ahegao-man', 'Pepe Feels Ahegao Man'],
  ['pepe-lets-fucking-go-lfg', "Pepe Let's Fucking Go LFG"],
  ['pepe-easy-ez', 'Pepe Easy EZ'],
  ['pepe-kek-ez', 'Pepe KEK EZ'],
  ['pepe-kek-with-pain-cry', 'Pepe KEK with Pain Cry'],
  ['pepe-laugh-kek-explode', 'Pepe Laugh KEK Explode'],
  ['pepe-laugh-2', 'Pepe Laugh 2'],
  ['pepe-poggers-chains', 'Pepe POGGERS Chains'],
  ['peepo-8-bit', 'Peepo 8-Bit'],
  ['peepo-kekw', 'Peepo KEKW'],
  ['peepo-poggies', 'Peepo POGGIES'],
  ['apu-pog-champ', 'Apu POG Champ'],
]);

export function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function titleCase(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      const override = WORD_OVERRIDES.get(lower);
      if (override !== undefined) return override;
      if (/^\d+$/.test(word)) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function parseCategoryDir(dirName) {
  const match = String(dirName).match(/^(\d+)\s+(.+)$/);
  if (!match) return null;
  return {
    order: Number(match[1]),
    id: slugify(match[2]),
    name: titleCase(match[2]),
  };
}

export function normalizeBase(fileName) {
  const withoutExtension = path.basename(fileName).replace(/\.[^.]+$/, '');
  return withoutExtension
    .toLowerCase()
    .replace(/^(pepe|apu|peepo|pepega|pepege)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walkFiles(full) : [full];
    });
}

function sourceUrl(commit, sourcePath) {
  const encodedPath = sourcePath.split('/').map(encodeURIComponent).join('/');
  return `${SOURCE_REPO}/blob/${commit}/${encodedPath}`;
}

function relativePath(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function writeCollectionsIndex(entry, generatedAt) {
  const indexPath = path.join(ROOT, 'collections.json');
  let existing = { schemaVersion: SCHEMA_VERSION, collections: [] };
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (Array.isArray(parsed.collections)) existing = parsed;
    } catch {
      // Replace an unreadable index; the manifest is the source of truth.
    }
  }

  const collections = [...(existing.collections ?? [])]
    .filter((collection) => collection.id !== entry.id)
    .concat(entry)
    .sort((a, b) => a.id.localeCompare(b.id));

  const index = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    collections,
  };
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

function writeChecksums(files) {
  const lines = [...new Set(files)]
    .map((file) => path.resolve(file))
    .sort((a, b) => relativePath(a).localeCompare(relativePath(b)))
    .map((file) => `${sha256(file)}  ${relativePath(file)}`);
  fs.writeFileSync(path.join(ROOT, 'checksums.sha256'), `${lines.join('\n')}\n`);
}

function parseArgs(argv) {
  const args = {
    source: null,
    commit: DEFAULT_COMMIT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') args.source = argv[++i];
    else if (arg === '--commit') args.commit = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/import-collection.mjs --source <path> [--commit <sha>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.source) {
    throw new Error('Missing --source. Point it at a clone of pepe_emojis_for_reddit.');
  }
  return args;
}

function readIndexNames(sourceRoot) {
  const indexPath = path.join(sourceRoot, 'emojis', 'index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing upstream index: ${indexPath}`);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const names = new Map();
  for (const type of ['static', 'gif']) {
    for (const entry of index[type] ?? []) {
      names.set(entry.file.replaceAll('\\', '/'), entry.name);
    }
  }
  return { names, index };
}

function displayNameFor(sourcePath, base, indexNames) {
  const indexed = indexNames.get(sourcePath);
  if (indexed) {
    return titleCase(indexed);
  }
  return titleCase(base);
}

function countSourceImages(sourceRoot) {
  const sourceImages = path.join(sourceRoot, 'emojis', 'source images');
  return walkFiles(sourceImages).length;
}

async function alphaCoverage(file, page) {
  const { data, info } = await sharp(file, { page })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let visible = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 16) visible += 1;
  }
  return visible / (info.width * info.height);
}

async function choosePosterFrame(file) {
  const metadata = await sharp(file).metadata();
  const pages = metadata.pages ?? 1;
  const first = await alphaCoverage(file, 0);
  if (pages <= 1 || first >= 0.08) {
    return { page: 0, coverage: first };
  }

  const candidates = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((ratio) =>
    Math.min(pages - 1, Math.floor((pages - 1) * ratio)),
  );
  let best = { page: 0, coverage: first };
  for (const page of new Set(candidates)) {
    const coverage = await alphaCoverage(file, page);
    if (coverage > best.coverage) best = { page, coverage };
  }
  return best;
}

async function importCollection({ source, commit }) {
  const collection = COLLECTION_SLUG;
  const sourceRoot = path.resolve(source);
  if (!fs.existsSync(path.join(sourceRoot, 'emojis'))) {
    throw new Error(`Not a pepe_emojis_for_reddit checkout: ${sourceRoot}`);
  }

  const { names: indexNames } = readIndexNames(sourceRoot);
  const assets = [];
  const categories = new Map();
  const warnings = [];
  const skipped = [];

  for (const type of ['static', 'gif']) {
    const typeRoot = path.join(sourceRoot, 'emojis', type);
    if (!fs.existsSync(typeRoot)) {
      warnings.push(`Missing folder: emojis/${type}`);
      continue;
    }
    for (const categoryDir of fs.readdirSync(typeRoot, { withFileTypes: true })) {
      if (!categoryDir.isDirectory()) continue;
      const category = parseCategoryDir(categoryDir.name);
      if (!category) {
        warnings.push(`Skipped unrecognized category folder: emojis/${type}/${categoryDir.name}`);
        continue;
      }
      if (!categories.has(category.id)) {
        categories.set(category.id, { ...category, static: 0, gif: 0, count: 0 });
      }
      const categoryRoot = path.join(typeRoot, categoryDir.name);
      const files = walkFiles(categoryRoot).filter((file) => /\.(png|gif)$/i.test(file));
      for (const file of files) {
        const relativeToSource = path.relative(sourceRoot, file).split(path.sep).join('/');
        const base = normalizeBase(file);
        const baseSlug = slugify(base);
        if (!baseSlug) {
          warnings.push(`Skipped file with empty slug: ${relativeToSource}`);
          continue;
        }
        assets.push({
          type,
          file,
          sourcePath: relativeToSource,
          sourceUrl: sourceUrl(commit, relativeToSource),
          category: category.id,
          categoryName: category.name,
          base,
          baseSlug,
          displayName: displayNameFor(relativeToSource, base, indexNames),
          hash: sha256(file),
        });
      }
    }
  }

  // Drop byte-identical files. The first file in sorted order (static before
  // gif, then folder/name order) is the canonical one.
  const byHash = new Map();
  const uniqueAssets = [];
  const duplicates = [];
  for (const asset of assets) {
    const existing = byHash.get(asset.hash);
    if (existing) {
      existing.duplicateNames.push(asset.displayName);
      existing.duplicatePaths.push(asset.sourcePath);
      duplicates.push({
        kept: existing.sourcePath,
        dropped: asset.sourcePath,
        sha256: asset.hash,
      });
      skipped.push(asset.sourcePath);
      continue;
    }
    asset.duplicateNames = [];
    asset.duplicatePaths = [];
    byHash.set(asset.hash, asset);
    uniqueAssets.push(asset);
  }

  // Group the same-name static and GIF files in the same category into one
  // sticker with two variants. Cross-category duplicates stay separate.
  const groups = new Map();
  const mergedPairs = [];
  const slugOwners = new Map();
  for (const asset of uniqueAssets) {
    const baseKey = `${asset.category}:${asset.baseSlug}`;
    let key = baseKey;
    let group = groups.get(key);
    if (group && group.variants[asset.type]) {
      let suffix = 2;
      while (groups.has(`${baseKey}-${suffix}`)) suffix += 1;
      key = `${baseKey}-${suffix}`;
      group = undefined;
      warnings.push(`Name collision in ${asset.category}: ${asset.baseSlug} (using ${key})`);
    }
    if (!group) {
      let slug = slugify(`${asset.category}-${asset.baseSlug}`);
      if (slugOwners.has(slug)) {
        let suffix = 2;
        while (slugOwners.has(`${slug}-${suffix}`)) suffix += 1;
        slug = `${slug}-${suffix}`;
      }
      group = {
        key,
        id: slug,
        slug,
        name: asset.displayName,
        category: asset.category,
        aliases: new Set(),
        variants: {},
      };
      slugOwners.set(slug, group);
      groups.set(key, group);
    } else if (group.name !== asset.displayName) {
      group.aliases.add(asset.displayName);
    }

    if (group.variants[asset.type]) {
      group.aliases.add(asset.displayName);
      continue;
    }

    group.variants[asset.type] = asset;
    for (const duplicateName of asset.duplicateNames) {
      if (duplicateName !== group.name) group.aliases.add(duplicateName);
    }
    if (asset.displayName !== group.name) group.aliases.add(asset.displayName);
    const baseName = titleCase(asset.base);
    if (baseName !== group.name) group.aliases.add(baseName);
    const categoryName = titleCase(asset.category);
    const categoryBaseName = `${categoryName} ${baseName}`;
    if (categoryBaseName !== group.name) group.aliases.add(categoryBaseName);
  }

  const stickers = [...groups.values()]
    .map((group) => {
      const id = group.id;
      const name = NAME_OVERRIDES.get(id) ?? group.name;
      const aliases = [...group.aliases]
        .filter((alias) => alias && alias !== name)
        .sort((a, b) => a.localeCompare(b));
      return {
        id,
        slug: group.slug,
        name,
        category: group.category,
        aliases,
        variants: group.variants,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const pairCount = stickers.filter((sticker) => sticker.variants.static && sticker.variants.gif).length;
  for (const sticker of stickers) {
    if (sticker.variants.static && sticker.variants.gif) {
      mergedPairs.push({
        id: sticker.id,
        name: sticker.name,
        static: sticker.variants.static.sourcePath,
        gif: sticker.variants.gif.sourcePath,
      });
    }
  }

  for (const category of categories.values()) {
    category.count = stickers.filter((sticker) => sticker.category === category.id).length;
    category.static = stickers.filter(
      (sticker) => sticker.category === category.id && sticker.variants.static,
    ).length;
    category.gif = stickers.filter(
      (sticker) => sticker.category === category.id && sticker.variants.gif,
    ).length;
  }

  const outRoot = path.join(ROOT, 'data', collection);
  fs.rmSync(outRoot, { recursive: true, force: true });
  for (const dir of ['static', 'gif', 'posters']) {
    fs.mkdirSync(path.join(outRoot, dir), { recursive: true });
  }

  const generatedAt = new Date().toISOString();
  const assetFiles = [];

  for (const sticker of stickers) {
    for (const type of ['static', 'gif']) {
      const variant = sticker.variants[type];
      if (!variant) continue;
      const extension = type === 'static' ? '.png' : '.gif';
      const outputFile = path.join(outRoot, type, `${sticker.slug}${extension}`);
      fs.copyFileSync(variant.file, outputFile);
      assetFiles.push(outputFile);
      const metadata = await sharp(variant.file).metadata();
      const variantData = {
        src: `${type}/${sticker.slug}${extension}`,
        width: metadata.width ?? 64,
        height: metadata.height ?? 64,
        bytes: fs.statSync(outputFile).size,
        sha256: sha256(outputFile),
        sourcePath: variant.sourcePath,
        sourceUrl: variant.sourceUrl,
      };
      if (type === 'gif') {
        variantData.frames = metadata.pages ?? 1;
        const posterFrame = await choosePosterFrame(variant.file);
        const posterFile = path.join(outRoot, 'posters', `${sticker.slug}.webp`);
        await sharp(variant.file, { page: posterFrame.page })
          .webp({ quality: 82, alphaQuality: 90 })
          .toFile(posterFile);
        assetFiles.push(posterFile);
        variantData.poster = `posters/${sticker.slug}.webp`;
        variantData.posterBytes = fs.statSync(posterFile).size;
        variantData.posterSha256 = sha256(posterFile);
        variantData.posterFrame = posterFrame.page;
        variantData.posterCoverage = Number((posterFrame.coverage * 100).toFixed(1));
      }
      sticker.variants[type] = variantData;
    }
  }

  const data = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    id: collection,
    slug: collection,
    name: 'Pepe',
    tagline: 'The frog that says it all.',
    description:
      'Pepes, Apus, Peepos, Pepegas and Pepeges for every reaction — static and animated.',
    source: {
      name: SOURCE_NAME,
      repo: SOURCE_REPO,
      commit,
      attribution: SOURCE_ATTRIBUTION,
      license: 'No license file in the upstream repository.',
    },
    stats: {
      total: stickers.length,
      static: stickers.filter((sticker) => sticker.variants.static).length,
      gif: stickers.filter((sticker) => sticker.variants.gif).length,
      both: pairCount,
      files: stickers.reduce(
        (total, sticker) =>
          total + (sticker.variants.static ? 1 : 0) + (sticker.variants.gif ? 1 : 0),
        0,
      ),
    },
    categories: [...categories.values()].sort((a, b) => a.order - b.order),
    stickers,
  };

  const dataPath = path.join(outRoot, 'collection.json');
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);

  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    source: {
      repo: SOURCE_REPO,
      commit,
    },
    dataset: {
      root: relativePath(outRoot),
      manifest: relativePath(dataPath),
      index: 'collections.json',
    },
    counts: {
      sourceFiles: assets.length,
      uniqueFiles: uniqueAssets.length,
      stickers: stickers.length,
      staticFiles: data.stats.static,
      gifFiles: data.stats.gif,
      bothFormats: pairCount,
      duplicateFilesRemoved: duplicates.length,
      sourceImagesSkipped: countSourceImages(sourceRoot),
    },
    duplicates,
    mergedPairs,
    aliases: stickers
      .filter((sticker) => sticker.aliases.length > 0)
      .map((sticker) => ({ id: sticker.id, name: sticker.name, aliases: sticker.aliases })),
    categories: data.categories,
    warnings,
    skipped,
    stickers: stickers.map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
      category: sticker.category,
      variants: Object.keys(sticker.variants),
    })),
  };
  const reportPath = path.join(ROOT, 'reports', `${collection}-import.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  writeCollectionsIndex(
    {
      id: collection,
      name: data.name,
      path: relativePath(dataPath),
      schemaVersion: SCHEMA_VERSION,
      stats: data.stats,
      source: {
        name: SOURCE_NAME,
        repo: SOURCE_REPO,
        commit,
      },
    },
    generatedAt,
  );

  const indexPath = path.join(ROOT, 'collections.json');
  const checksumsPath = path.join(ROOT, 'checksums.sha256');
  writeChecksums([...assetFiles, dataPath, indexPath, reportPath]);

  return { data, report, dataPath, reportPath, outRoot, indexPath, checksumsPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { data, report, dataPath, reportPath, outRoot, indexPath, checksumsPath } =
    await importCollection(args);
  console.log('');
  console.log(`Imported ${data.stats.total} stickers (${data.stats.static} static, ${data.stats.gif} GIF, ${data.stats.both} with both).`);
  console.log(`Assets: ${relativePath(outRoot)}`);
  console.log(`Manifest: ${relativePath(dataPath)}`);
  console.log(`Index: ${relativePath(indexPath)}`);
  console.log(`Report: ${relativePath(reportPath)}`);
  console.log(`Checksums: ${relativePath(checksumsPath)}`);
  console.log(`Duplicates removed: ${report.counts.duplicateFilesRemoved}`);
  console.log(`Source images skipped: ${report.counts.sourceImagesSkipped}`);
  if (report.warnings.length) {
    console.log(`Warnings: ${report.warnings.length}`);
    for (const warning of report.warnings) console.log(`  - ${warning}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
