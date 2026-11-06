# Sticker Datasets

The dataset repository for **StickersHub**. It contains normalized sticker
collections and their manifests, without any website code.

## Collections

| Collection | Stickers | Static | GIF | Dual-format | Assets |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pepe | 202 | 120 | 96 | 14 | 216 |

The Pepe pack has five subcollections: Pepe, Apu, Peepo, Pepega, and Pepege.
Every sticker is 64 × 64 and has a static PNG, an animated GIF, or both. GIFs
also have a generated WebP poster.

## Layout

```text
collections.json                  # dataset index
data/
  pepe/
    collection.json              # collection manifest
    static/*.png                 # 120 static stickers
    gif/*.gif                    # 96 animated stickers
    posters/*.webp               # 96 GIF posters
reports/
  pepe-import.json               # importer decisions and counts
schema/
  collection.schema.json         # JSON Schema for a collection manifest
  index.schema.json              # JSON Schema for collections.json
scripts/
  import-pepe.mjs                # reproducible importer
  checksums.mjs                  # rebuild checksums.sha256
  verify.mjs                     # schema, asset, hash, and count checks
  import-pepe.test.mjs           # importer helper tests
checksums.sha256                 # SHA-256 for every dataset file
```

## Consuming the dataset

`collections.json` is the entry point:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-06T02:56:22.827Z",
  "collections": [
    {
      "id": "pepe",
      "name": "Pepe",
      "path": "data/pepe/collection.json",
      "stats": { "total": 202, "static": 120, "gif": 96, "both": 14, "files": 216 }
    }
  ]
}
```

Read the collection path, then resolve every asset path **relative to that
collection directory**. For example, `static/pepe-laugh.png` in
`data/pepe/collection.json` resolves to:

```text
data/pepe/static/pepe-laugh.png
```

Each sticker entry looks like this:

```json
{
  "id": "pepe-laugh",
  "slug": "pepe-laugh",
  "name": "Pepe Laugh",
  "category": "pepe",
  "aliases": ["Laugh"],
  "variants": {
    "static": {
      "src": "static/pepe-laugh.png",
      "width": 64,
      "height": 64,
      "bytes": 10663,
      "sha256": "f0e818a0f7803c5d74a97a32563e5c4edaeddf3b8a33a3a48eec9d0f39f39317",
      "sourcePath": "emojis/static/1 pepe/pepe laugh.png",
      "sourceUrl": "https://github.com/pepecoinppc/pepe_emojis_for_reddit/blob/f59ebdbc5706fd80c82d6cf5f069405d45f231c8/emojis/static/1%20pepe/pepe%20laugh.png"
    },
    "gif": {
      "src": "gif/pepe-laugh.gif",
      "width": 64,
      "height": 64,
      "bytes": 90122,
      "sha256": "45fd43d904d6df3c1912b7b3f5480f25a467dbe11813a88c4d941c49e856d7db",
      "sourcePath": "emojis/gif/1 pepe/pepe laugh.gif",
      "sourceUrl": "https://github.com/pepecoinppc/pepe_emojis_for_reddit/blob/f59ebdbc5706fd80c82d6cf5f069405d45f231c8/emojis/gif/1%20pepe/pepe%20laugh.gif",
      "frames": 30,
      "poster": "posters/pepe-laugh.webp",
      "posterBytes": 1398,
      "posterSha256": "582ed4c8b91b53b2195b9858ac26342d682670cd9e7f6623fcc58b05f0830df4",
      "posterFrame": 0,
      "posterCoverage": 80.8
    }
  }
}
```

- `src` and `poster` are relative to the collection directory.
- `sha256` is the hash of the asset file.
- `posterSha256` is the hash of the poster file.
- `posterFrame` is the GIF frame used for the poster; `posterCoverage` is the
  percentage of non-transparent pixels in that frame.
- `sourcePath` and `sourceUrl` point to the exact upstream file at the pinned
  commit.

## Counts and decisions

- `emojis/static`: 120 PNG files.
- `emojis/gif`: 97 GIF files; one byte-identical duplicate removed.
- `emojis/source images`: 220 derivative files skipped.
- 14 same-name static/GIF pairs merged into one sticker with both variants.
- 18 names repeat across subcollections (for example Pepe Coffee and Peepo
  Coffee); those are distinct images and remain separate stickers.
- Final catalog: 202 stickers / 216 assets / 96 posters.
- GIF posters use the first frame when it has content; otherwise a later frame
  is selected to avoid blank posters.

## Import and verify

```bash
corepack pnpm install

git clone https://github.com/pepecoinppc/pepe_emojis_for_reddit vendor/pepe_emojis_for_reddit
git -C vendor/pepe_emojis_for_reddit checkout f59ebdbc5706fd80c82d6cf5f069405d45f231c8

corepack pnpm import:pepe
corepack pnpm verify
```

`import:pepe` replaces `data/pepe`, updates `collections.json`, writes the
import report, and rebuilds `checksums.sha256`. `verify` validates the JSON
schemas, unique IDs, counts, file dimensions, SHA-256 hashes, and checksums.

To rebuild the checksums after a manual asset change:

```bash
corepack pnpm checksums
corepack pnpm verify
```

The importer helpers have a small test suite:

```bash
corepack pnpm test
```

## Adding a collection

1. Add `data/<id>/collection.json` and the `static/`, `gif/`, and `posters/`
   assets.
2. Add or update its entry in `collections.json`.
3. Run `corepack pnpm checksums && corepack pnpm verify`.

The `data/<id>` path is part of the index, so the rest of the repo does not
need to change.

## Versioning

- `schemaVersion` is currently `1`.
- `generatedAt` records the import time in ISO 8601 UTC.
- The upstream commit is pinned in both the manifest and the index.
- `checksums.sha256` covers every file under `data/`, `collections.json`, and
  `reports/`.

## Attribution and license

The artwork is from [Pepe Emojis for Reddit](https://github.com/pepecoinppc/pepe_emojis_for_reddit)
by Pepecoin.com. The upstream repository has no license file, so the artwork
remains the property of its respective creators. Pepe the Frog is © Matt Furie.
This is a fan-made dataset and is not affiliated with Reddit, Pepecoin, or Matt
Furie. See [ATTRIBUTION.md](./ATTRIBUTION.md) for details and takedown notes.

The code in `scripts/`, the JSON schemas, and the manifests are provided as-is
for the StickersHub project. No license is granted for the sticker artwork.
