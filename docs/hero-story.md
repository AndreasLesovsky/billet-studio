# Hero-Story — contract between the Blender build and the web runtime

The home page hero plays a short 3D story: a printed Valentinstag card stands and opens, a beating
heart pops out of the fold, a phone appears, a message with a link arrives, the card glides into
the phone and the screen shows the real billet with the heart standing in its 3D area. In idle the
phone cycles through the occasions. This file is the single contract between
`tools/blender/hero/` (authoring, one GLB) and `billet-studio-frontend/src/app/features/home/hero-story/`
(runtime). Change both sides together.

## Files

| What | Where | Made by |
|---|---|---|
| Raw export (committed, pipeline input) | `tools/blender/hero/export/hero-story.glb` | `build.py --stage export` |
| Optimised story | `billet-studio-frontend/public/hero/story.<hash8>.glb` | `npm run hero:story` (tools/asset-pipeline) |
| Story manifest | `tools/asset-pipeline/hero/hero-story.json` | `npm run hero:story` |
| Textures (print, screens, lock, notification) | `public/hero/textures/*.<hash8>.webp` + `hero/hero-captures.json` | `npm run hero:capture` |
| Light gifts | `public/hero/gifts/<slug>.<hash8>.glb` + `hero/hero-gifts.json` | `npm run hero:gifts` |
| Runtime asset table | `src/app/features/home/hero-story/hero-assets.generated.ts` + `hero-home.generated.ts` | `npm run hero:assets` (reads the three manifests; `hero:capture` and `hero:gifts` run it at their end, `hero:story` must too) |

### Story manifest (`hero-story.json`)

```json
{ "file": "hero/story.<hash8>.glb", "bytes": 123456 }
```

- `file`: path under `billet-studio-frontend/public/`, exactly `hero/story.` + 8 **lowercase** hex
  characters + `.glb`; the file must exist.
- `bytes`: its size, a positive number.
- Further keys are allowed and ignored. Anything else makes `hero:assets` exit 1 without writing,
  and the home page keeps showing the hero without 3D.

## Units and axes

Blender authors in metres, Z-up; the glTF exporter converts to Y-up (Blender +Z → three +Y,
Blender −Y → three +Z). "Front" of every object is Blender −Y (three +Z), "up" is Blender +Z
(three +Y). The camera looks from Blender −Y toward +Y.

## Node names (glTF)

Only `[A-Za-z0-9_]`. Everything below is exported; anything else (preview helpers, render lights,
the Blender render camera, the heart stand-in) lives in a Blender collection that is not exported.

| Node | Kind | Meaning |
|---|---|---|
| `Cam`, `CamTarget` | empty, animated | runtime camera: position = world position of `Cam`, `lookAt` world position of `CamTarget`, up = world +Y |
| `Card` | empty, animated | card root (origin at the bottom of the fold) |
| `Card_Back`, `Card_Front`, `Card_Spine` | meshes | panels and the skinned fold strip (`Card_Rig` armature, bones `Spine_00..16`) |
| `Card_Hinge` | empty, animated | cover hinge; its rotation opens the card |
| `GiftSlot` | empty, animated | where the gift is attached (see Gift) |
| `Phone` | empty, animated | phone root (centre of the body) |
| `Phone_Body` | mesh(es) | frame, back, bezel, buttons, camera module |
| `Phone_Screen` | mesh | display, UV0 0..1 over the full 390×844 window, top of the image at the top of the phone |
| `Phone_ScreenDock` | empty (child of `Phone`) | landing pose of the gift in the screen |
| `Shadow_<Name>` | meshes | ground contact-shadow patches, material `M_Shadow_<Name>` (BLEND, baked alpha) |
| `Fx_<Name>` | empties, animated | control values, see Fx |

All animated transforms, the spine bones and every constraint are **baked** into the clip (the
exporter drops drivers and constraints).

## The clip

Exactly one animation clip, `Story`, covering `0 … duration`. The runtime never plays it freely:
each frame it sets `action.time = clock` and calls `mixer.update(0)`, so seeking (chapters,
replay) is exact. The last frame is the rest pose of the idle phase.

## Scene extras: `heroStory`

The glTF scene carries `extras.heroStory` as a JSON **string** (Blender scene custom property
`heroStory`, written by `export.py` from the timeline markers — the only source of these times):

```json
{
  "version": 1,
  "fps": 30,
  "duration": 10.0,
  "clip": "Story",
  "aspect": 1,
  "fovDeg": 30.0,
  "beats": [
    { "id": "write", "start": 0.0, "end": 3.6 },
    { "id": "gift",  "start": 3.6, "end": 6.2 },
    { "id": "share", "start": 6.2, "end": 10.0 }
  ],
  "gates": { "screens": 6.4 },
  "marks": { "land": 9.2 },
  "gift": { "templateId": "valentinstag" }
}
```

- `aspect` / `fovDeg`: the authored frame (square) and its vertical field of view. The runtime
  widens the vertical FOV for narrower stages so the authored square is always fully visible
  (`fitVerticalFov`), like `object-fit: contain`. Nothing may leave the authored frame at any
  time (checked in Blender per frame: every mesh's bounds within 4 %–96 % of the frame).
- `beats`: the three chapters (i18n `HOME.CHAPTER_*`), contiguous, in order.
- `gates.screens`: the clock does not pass this time until the lock, notification and billet
  screen textures are loaded (they load in parallel with the rest).
- `marks.land`: the gift reaches `Phone_ScreenDock` (informational; the runtime re-parents the
  gift to the dock at the end of the story, not at `land`).

## Fx control values

An `Fx_<Name>` empty's **local position x** (Blender X, unchanged by the Y-up conversion) is a
value in 0..1, keyed with the same curves as everything else. The runtime reads them every frame:

| Fx | 0 | 1 |
|---|---|---|
| `Fx_Wake` | screen off (black glass) | lock screen fully lit |
| `Fx_Notif` | message hidden above the screen top | message in place (slide + fade) |
| `Fx_Billet` | lock screen + message | billet page (crossfade) |
| `Fx_CardFade` | card invisible | card fully visible |
| `Fx_Shadow_<Name>` | patch `Shadow_<Name>` invisible | patch at full strength |

A shadow patch without a matching `Fx_Shadow_<Name>` is always at full strength. `Fx_Wake`,
`Fx_Notif`, `Fx_Billet` and `Fx_CardFade` are required under exactly these names (no `.001`
suffix): without one the runtime rejects the story and the page shows its no-3D fallback.

The message banner (`Fx_Notif`) is drawn by the screen shader from the notification texture's CSS
size (358×120), centred horizontally, its top 16 CSS px below the top of the 390×844 window.

## Gift

- The gift is a separate GLB (light hero version). The runtime builds
  `GiftSlot → giftSpin → giftFit → gift`: `giftFit` applies `fitTransform(box, fitSize, yOffset)`
  in **billet units** (the catalog scene defaults from `hero-gifts.json`), `giftSpin` carries drag
  rotation and the idle turn, the gift keeps its own mixer (the heart beats).
- A `GiftSlot` world scale of `s` shows the gift `s` times its billet-unit size. Its orientation:
  up = Blender +Z, front = Blender −Y (a gift under an identity slot stands upright and faces the
  viewer).
- `Phone_ScreenDock` has the **phone's orientation** (up along the phone, front out of the screen,
  i.e. Blender −Y in the phone's rest pose); it sits at the centre of the Valentinstag DE scene
  area on the screen, pushed out of the glass so the gift stands in front of it. Its scale is
  `sceneAreaHeightMetres / 2.1497` (2.1497 = visible height of the billet camera, 2·2.8·tan 21°), so
  a gift looks as large relative to the scene area as in the real billet. Custom properties:
  `sceneRectDe`, `sceneRectEn` (normalised to the 390×844 window, y from the top),
  `screenWidthM`, `screenHeightM`, `dockScale`.
  **Required by the runtime:** `sceneRectDe` (as `{x, y, w, h}`, `[x, y, w, h]` or a JSON string of
  either; `w`, `h` > 0), `screenWidthM` and `screenHeightM` (positive numbers); a missing or broken
  one sends the hero to its fallback. `sceneRectEn` and `dockScale` are informational: the runtime
  takes the EN and other templates' rects from `hero-captures.json` and the scale from the node.
- At the end of the story `GiftSlot`'s world transform equals `Phone_ScreenDock`'s. The runtime then
  attaches `giftSpin` to the dock so the gift follows the floating phone. For other occasions and
  for EN the runtime shifts the gift inside the screen plane by the difference between that
  screen's scene rect and `sceneRectDe`.

## Materials the runtime replaces

| Material | Runtime |
|---|---|
| `M_Print_Front`, `M_Print_Inside` | base colour map ← `print-front|print-inside-valentinstag-<lang>-light` (cloned material, `flipY = false`, sRGB) |
| `M_Screen` | replaced by the screen `ShaderMaterial` (`toneMapped: false`): lock → message → billet, A/B crossfade for occasion changes |
| `M_Shadow_*` | opacity × `Fx_Shadow_*` |

The GLB carries 16×16 placeholder images in the replaced slots (UVs and slots stay). At least one
mesh under `Card` must use each of `M_Print_Front`, `M_Print_Inside`, and at least one mesh must use
`M_Screen`; otherwise the runtime rejects the story. The card's materials (below `Card`) render
as transparent for the whole story, so `Fx_CardFade` needs no program switch.

## Idle phase (runtime only)

After `duration`: the phone floats gently, the gift turns slowly; every ~6 s the occasion changes
(valentinstag → geburtstag → hochzeit → weihnachten → muttertag → …): the gift shrinks away, the
screen crossfades to the next template's screenshot, the next gift pops in. Dragging turns the gift
(`touch-action: pan-y`), a tap turns it by 180°, both hold the cycle for 4 s. A visit later in the
same browser session starts directly in the idle phase (`sessionStorage`). Reduced motion or saved
data: the end poster with a play button; no WebGL: the end poster only.
