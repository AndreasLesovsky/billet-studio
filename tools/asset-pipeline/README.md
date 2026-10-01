# Asset pipeline

Produces every binary asset billet-studio ships, and the seed file that goes with them:

| Output | Produced by |
|---|---|
| `billet-studio-frontend/public/models/<slug>.v<n>.glb` | `models/optimize-models.mjs` |
| `billet-studio-frontend/public/models/previews/<slug>.v<n>.webp` | `models/render-previews.mjs` |
| `sql/seed_models.sql` | `models/generate-seed-models.mjs` |
| `billet-studio-frontend/public/fonts/**`, font catalog | `fonts/merge-fonts.mjs` |
| `billet-studio-frontend/public/hero/textures/<name>.<hash>.webp`, `hero/hero-captures.json` | `hero/capture-hero.mjs` |
| `billet-studio-frontend/public/hero/gifts/<slug>.<hash>.glb`, `hero/hero-gifts.json` | `hero/build-hero-gifts.mjs` |
| `billet-studio-frontend/public/hero/story.<hash>.glb`, `hero/hero-story.json` | `hero/optimize-hero-story.mjs` |
| `billet-studio-frontend/public/hero/posters/<name>.<hash>.webp`, `hero/hero-posters.json` | `hero/capture-hero-posters.mjs` |
| `hero-assets.generated.ts`, `hero-home.generated.ts` (in `src/app/features/home/hero-story/`) | `hero/generate-hero-assets.mjs` |

These files are **never copied or edited by hand**. To change something, change the manifest
(or the script) and run the pipeline again.

## Setup

```bash
cd tools/asset-pipeline
npm install
npx playwright install chromium   # only for the preview images, once
```

Node 22 or newer. `node_modules/` is excluded via `.gitignore`; `package-lock.json` is committed.

## Commands

| Command | Effect |
|---|---|
| `npm run models` | everything for models: optimize → preview images → `seed_models.sql` |
| `npm run models:optimize` | optimize GLBs (skips models whose output is up to date) |
| `npm run models:previews` | render WebP preview images (headless Chromium, SwiftShader) |
| `npm run models:seed` | rewrite `sql/seed_models.sql` |
| `npm run models:compare` | quality check: render the source and the optimized model identically and compare them (see below) |
| `npm run hero:capture` | capture the 3D hero's textures from the real renderer, then `hero:assets` (see below) |
| `npm run hero:gifts` | build light gift models for the home page's 3D hero, then `hero:assets` (see below) |
| `npm run hero:compare` | render the light hero gifts next to the catalog version (`hero/.captures/gifts-compare.png`) |
| `npm run hero:story` | optimize, verify and publish the Blender export of the hero story, then `hero:assets` (see below) |
| `npm run hero:story-verify` | verify only: the published story against the contract and the raw export |
| `npm run hero:story-check` | play the published story in three.js the way the runtime does (`hero/.captures/story-check.png`) |
| `npm run hero:posters` | capture the hero's start and end posters from the runtime's canvas, then `hero:assets` (see below) |
| `npm run hero:assets` | only rewrite the runtime's asset tables from the hero manifests |
| `npm run fonts` | rebuild the fonts (`fonts/merge-fonts.mjs`) |
| `npm run fonts:check` | only check whether the font outputs are complete (no network, no writes) |

Options for the model scripts, e.g. `npm run models:optimize -- --force --only=gift-box`:

- `--force` also rebuilds outputs that are up to date.
- `--only=slug-a,slug-b` limits the run to individual models.

`models:optimize` prints a table at the end (source MB → output MB, vertices, textures, largest
texture, draw calls, animations) and exits with code 1 when a model breaks its size limit, an
animation is lost or an extension of the source (e.g. `KHR_materials_unlit`,
`KHR_materials_emissive_strength`) is missing.

## Sources stay untouched

The pipeline only **reads** from the source folders and writes exclusively into this repository:

- `digital-card-template/models` – the GLB originals (path `sourceDir` in the manifest, can be
  overridden with the environment variable `BILLET_MODELS_SOURCE_DIR`)
- `muttertag_threejs/` – reference for the flower bouquet (identical to `flower_bouquet.glb` above)
- `Basisrezept/fonts`, `commerce-x/.../public/fonts` – font sources

Nothing in these folders is moved, renamed, deleted or overwritten.

## What the optimization does

Per manifest entry (glTF-Transform, programmatic): `dedup` → `instance` (from 5 identical meshes,
e.g. the Christmas tree) → `flatten` → `join` → `weld` → optionally `simplify` → `resample` (lossless,
animations only) → `prune` → shrink textures to `maxTextureSize` and save them as **WebP** (quality
`textureQuality`, default 88) → **meshopt** compression (`EXT_meshopt_compression` +
`KHR_mesh_quantization`). Animations and material extensions are preserved and checked after
writing. The credits (`asset.extras`) stay in the file.

Lossy WebP stores color at half resolution (4:2:0). For normal maps, which store a direction in
red/green, this smooths out fine relief (crumpled foil, hammered glass). With
`"losslessNormals": true`, normal maps are stored losslessly (noticeably larger file). Currently
set for `champagne-bottle` (0.35 → 1.88 MB) and `christmas-baubles` (0.76 → 4.70 MB).

Limits: max. 2048 px per texture, **≤ 6 MB per model, flower bouquet ≤ 8 MB** (`sizeLimitMB`).
If a model breaks its limit, lower `maxTextureSize` in the manifest (2048 → 1024) and run it again.
Geometry simplification (`simplify`) is off by default and is ignored for animated models or
models with few vertices.

An output counts as up to date when it is newer than its source and was built with the same settings
(hash in `asset.extras.billetStudioPipeline`). Preview images count as up to date when they are newer
than the GLB, the manifest, `preview.html` and the render script.

## Adding a new Blender model

1. **Prepare in Blender**
   - Apply transforms (Object → Apply → All Transforms) and set a sensible origin.
   - Textures at most 2048 × 2048 px; materials as Principled BSDF (other shaders do not survive
     the glTF export).
   - Create animations as Actions/NLA if the model is meant to be animated.
2. **Export**: File → Export → glTF 2.0, format **glTF Binary (.glb)**, "+Y Up" on,
   "Apply Modifiers" on, **no** Draco compression (the pipeline compresses with meshopt).
   Credit: fill in the "Copyright" field in the export dialog (it ends up in `asset.copyright`, e.g.
   "Osterei by Andreas (CC-BY-4.0)"). Sketchfab downloads already bring their credits in
   `asset.extras` (`title`, `author`, `license`, `source`); these become
   `<title> by <author> (<license>) <source>` (max. 255 characters). Without either, `credit` stays NULL.
3. **Place the file** in the source folder (`sourceDir` in the manifest, currently `digital-card-template/models`).
4. **Add a manifest entry** to `models/models.manifest.json`:

   ```json
   {
     "slug": "easter-egg",
     "version": 1,
     "source": "easter_egg.glb",
     "name_de": "Osterei",
     "name_en": "Easter egg",
     "occasion": "easter",
     "active": true,
     "position": 140,
     "maxTextureSize": 1024,
     "scene": { "fitSize": 1.6, "yOffset": -0.08, "exposure": 0.6, "cameraDistance": 2.8, "cameraHeight": 0.1, "autoRotateSpeed": 0.45 }
   }
   ```

   - `slug`: lowercase, with hyphens, max. 60 characters. **Never rename it**: billets store it.
   - `version`: increase it with every change to the model's content (`v1` → `v2`, cache busting). The
     old file stays until it is deliberately deleted (the pipeline lists it as "not in the manifest").
   - `maxTextureSize`: 2048 for large main models, 1024 for small props or tiny textures.
   - `scene`: the default scene in the editor (values as in the billet document). `fitSize` 0 < x ≤ 5.
   - Optional: `sizeLimitMB`, `previewRotationY` (rotation for the preview image only, default −0.35 rad),
     `simplify` (`{ "ratio": 0.5, "error": 0.001 }`), `excludeMaterials` (primitives with these
     material names are removed, e.g. decorative snowflakes that break the auto-fit),
     `losslessNormals` (lossless normal maps when `models:compare` shows a visible loss),
     `opaqueMaterials` (these materials become opaque: `alphaMode` OPAQUE, alpha 1 – for a
     BLEND material that is not meant to be see-through; otherwise the page shows through the
     transparent canvas, and with double-sided materials the back face does, e.g. a mirrored label.
     Currently `champagne-bottle`, material `Glass`).
5. **Run the pipeline**: `npm run models` (optimize → preview image → `sql/seed_models.sql`).
   Check the table and look at the preview image in `public/models/previews/`.
6. **Database**: **you** import `sql/seed_models.sql` (phpMyAdmin or
   `mysql -u root -p db_billet_studio < sql/seed_models.sql`). The file is idempotent and can be
   imported again at any time. Claude never runs SQL.

## Hero textures

`npm run hero:capture` (`hero/capture-hero.mjs`) captures the print (front, inside), the display pages
of all templates, the lock screen and the message with the **real renderer**: the dev route
`/dev/hero-capture/:kind` draws them with `BilletView` at a fixed CSS size, and Playwright photographs
them (DPR 2, print 2.5), per language × color mode (print light only). The page waits until every font
is really loaded, so a fallback font is never baked in.

- Output: `public/hero/textures/<name>.<8-character content hash>.webp` (stale ones are deleted),
  `hero/hero-captures.json` (with the normalized 3D area of each display page), lossless PNGs, a
  contact sheet and a 1:1 text crop in `hero/.captures/` (gitignored). Exit code 1 and nothing
  written when a capture fails or the 3D area lies in a different place in light and dark.

## Hero posters

`npm run hero:posters` (`hero/capture-hero-posters.mjs`) reads the posters from the runtime's own
canvas (`/dev/hero?capture&t=0|end`, `preserveDrawingBuffer`, `toDataURL`): a poster is exactly
the image the canvas fades in with, transparent around the story. 512 CSS px at DPR 2 =
1024 px, WebP with alpha (quality 82, alpha 90). One Chromium page, the captures one after another
(WebGL in SwiftShader).

- Start poster (t = 0, the card only) per language, end poster (resting state, the display follows
  the color mode) per language × color mode.
- Output: `public/hero/posters/<name>.<8-character content hash>.webp` (stale ones are deleted),
  `hero/hero-posters.json`, lossless `hero/.captures/poster-<name>.png`. Exit code 1 and nothing
  written when the stage does not become ready, has no WebGL or the canvas does not measure 1024 px.
- Run it last after every change to the story, textures or gifts, otherwise a poster no longer
  matches its image.

## Hero capture server

`hero:capture` and `hero:posters` need the running app (dev routes exist only in `ng serve`).
Both use port **4330** (not the developer's 4200, not the e2e ports 4320/4321), start `ng serve`
there themselves when nothing answers, and stop only what they started
(`hero/lib/app-server.mjs`). With `HERO_APP_URL`, `hero:posters` uses a server that is already running,
e.g. `set HERO_APP_URL=http://localhost:4200` (Windows) before `npm run hero:posters`. The capture
answers every `/v1` request itself with 401 (guest); no backend is contacted.

## Hero gifts

The home page's 3D hero shows one gift per occasion at about 150–300 CSS px (DPR 2). For this,
`npm run hero:gifts` builds light versions of the five catalog models, **from the source GLBs** (not
from `public/models`, or the textures would be lossily encoded twice), with the same
transform list as the catalog (`models/lib/optimize.mjs`):

- `hero/hero.manifest.json`: `templateId` → catalog `slug`, per gift `sizeLimitKB` and the
  deviations from the catalog: `maxTextureSize`, `textureQuality`, `losslessNormals`, `simplify`
  (`ratio`, `error`, optional `flags` for meshoptimizer, e.g. `Permissive`, and `keepMaterials`:
  materials whose primitives stay unsimplified, such as the bouquet's thin stems),
  `normalTextureSize` (size of the lossless normal maps) and `stripUnlitNormals` (removes `NORMAL`
  from `KHR_materials_unlit` materials; only this makes scans such as the cake and the bouquet simplifiable).
  The source, `excludeMaterials`, `opaqueMaterials`, the credit and the scene defaults come from
  `models/models.manifest.json`. Animated models are never simplified (the beating heart stays
  an unchanged copy of the catalog settings). The snow globe is not simplified: its toon outline
  is an inverted hull with the same topology as the inside; simplified separately, the two no longer
  fit together (dark flakes, black chimney).
- Output: `public/hero/gifts/<slug>.<8-character content hash>.glb` (stale hashes are deleted)
  and `hero/hero-gifts.json` (file, bytes, triangles, textures, animation clips, credit,
  scene defaults). None of it ends up in `seed_models.sql`.
- Exit code 1 and **nothing written** when a gift breaks its `sizeLimitKB` or `verify()`
  fails (a lost animation or extension).

`npm run hero:compare` renders each light gift next to the catalog version with `models/preview.html`
at 320 CSS px × DPR 2, at four evenly spaced rotation angles (the hero rotates the gift), and
writes `hero/.captures/gifts-compare.png` (per gift the worst angle: catalog | light |
difference, with file sizes) plus `gifts-compare-<slug>.png` with all four angles. Look at it after
every change to the manifest.

## Hero story

The home page's 3D story (contract: `docs/hero-story.md`) is built by Blender from scripts
(`tools/blender/hero/`, `--stage export`), which store the committed raw export at
`tools/blender/hero/export/hero-story.glb`. From there on, the pipeline runs without Blender:

- `npm run hero:story` (`hero/optimize-hero-story.mjs`): a **structure-preserving** chain, not the
  catalog chain: `dedup` only for accessors, meshes and textures (the runtime finds materials by
  their names), `weld`, `resample` (tolerance 1e-5), 16 × 16 placeholders in the slots the runtime
  replaces (`M_Print_Front`, `M_Print_Inside` base color, `M_Screen` emission), `BLEND` on
  `M_Shadow_*`, WebP per slot (paper normal map 256 px, phone AO 512 px, shadows 256 px), `prune`
  with `keepLeaves` / `keepAttributes` / `keepExtras` / `keepSolidTextures` (empty nodes such as `Cam`,
  `Fx_*`, `GiftSlot` stay), meshopt level `medium` (positions 14, normals 10, UVs 12 bits;
  animation data lossless). **No** `flatten`, `join`, `instance` or `simplify`. `quantize`
  moves the mesh of an animated node (the card's shadow patches rotate with it) to a child node
  named `<Node>_Mesh`.
- Checked before writing (`hero/verify-hero-story.mjs`): `extras.heroStory` as the runtime's
  `parseStoryMeta` reads it, the required nodes, exactly one clip `Story` with the story duration, every
  `Shadow_<Name>` with `M_Shadow_<Name>` (BLEND), the placeholders, `TEXCOORD_0/1` where materials read
  them, no `KHR_materials_*` extension (three.js would switch to `MeshPhysicalMaterial`), the skin of
  `Card_Spine` (`Spine_00`..`Spine_16`), the dock extras, the Khronos validator (0 errors), **≤ 600 KB**
  and the poses: at sample points every 0.25 s, the world matrices of the animated nodes and the
  world bounding boxes of all meshes (the card after skinning) against the raw export, **≤ 0.2 mm**; at
  the end of the clip, `GiftSlot` equals `Phone_ScreenDock`.
- Output: `public/hero/story.<8-character content hash>.glb` (old hashes are deleted) and
  `hero/hero-story.json` (file, bytes, triangles, parsed story meta, nodes, textures, check values).
  Then `hero:assets` rewrites the runtime's asset table. Exit code 1 and nothing written
  when a check fails.
- `npm run hero:story-check` (`hero/check-story.mjs` + `hero/story-check.html`): plays the
  published story in headless Chromium the way the runtime does (camera from `Cam` / `CamTarget` with
  the story FOV, the paused clip set to the time, print textures, a simple unlit
  screen: lock screen with the message banner (`Fx_Notif`, size from the capture as in the runtime's
  screen shader) → billet, card and shadow Fx, the light heart under `GiftSlot`
  via `fitTransform` with its clip at the story time, RoomEnvironment and the runtime's lights;
  ACES tone mapping as the check page's default, while the runtime uses Neutral: with
  `--tone-mapping=neutral` the check page shows its colors), renders in one single page the same points in time as the Blender contact sheet (every
  0.5 s) to `hero/.captures/story-check.png` and the full-frame points in time (0 / 2.4 / 4.6 / 7.2 / 8.8 /
  10 s) as `story-check-t<t>.png`, and compares the node positions and the Fx values with Blender's
  reference (`tools/blender/hero/.renders/story/checks.json`, tolerance 0.5 mm). For lighting experiments:
  `npm run hero:story-check -- --hero-exposure=0.8 --tone-mapping=neutral` (separate file names).

## Hero asset tables

`npm run hero:assets` (`hero/generate-hero-assets.mjs`) writes the runtime's two tables from
`hero-captures.json`, `hero-gifts.json`, `hero-story.json` and `hero-posters.json`:
`hero-assets.generated.ts` (everything; only the hero's lazy chunk imports it) and
`hero-home.generated.ts` (what the home page needs before the chunk: story URL, posters, credits).
Without `hero-story.json` the hero shows no 3D; without `hero-posters.json`, a placeholder instead of
the posters. Exit code 1 and nothing written when a manifest is incomplete or names a file
that is not in `public/`. Every generating hero script calls it at the end.

## Fonts

`npm run fonts` calls `fonts/merge-fonts.mjs`. The script merges the local font folders, downloads
the Google Fonts families named in the font manifest as woff2 (latin + latin-ext) and writes
`public/fonts/`, the font catalog and the preview page. `npm run fonts:check` only checks the existing
outputs. Details are in the header of `fonts/merge-fonts.mjs` and in `fonts/fonts.manifest.json`.

## Preview renderer

`models/preview.html` is a standalone three.js page with the look of the billet scene
(ACES Filmic, exposure per model, RoomEnvironment, the same three lights, camera fov 42 at
`(0, cameraHeight, cameraDistance)`, auto-fit via the bounding box). For it, `render-previews.mjs` starts
a local mini server (`127.0.0.1` only), renders each **optimized** model in headless Chromium at
double resolution and saves it as a 512 × 512 WebP with a transparent background.

## Quality comparison

`npm run models:compare` (optionally `-- --only=slug`) renders the **source** and the **optimized**
GLB of each model with the same settings as the preview image. The optimized model uses the
source's bounding box, so that both images line up pixel for pixel. Output in `.compare/`
(excluded via `.gitignore`; `public/` stays untouched):

- `.compare/<slug>.png`: source | optimized | difference (red, amplified 6×)
- `.compare/report.json` and a table: mean deviation, share of strongly deviating pixels
  (one channel > 8/255, relative to the model's area), change of the silhouette and "fit drift" (how far
  the optimized model's auto-fit deviates from the original's).

Models above 3 % strongly deviating pixels or 1 % drift are marked `CHECK`. That only means
"take a look": detailed textures (brickwork, cake crumble) always deviate a little through WebP and
downscaling, without looking visibly worse.
