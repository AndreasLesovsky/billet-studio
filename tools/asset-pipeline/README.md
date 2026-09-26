# Asset-Pipeline

Erzeugt alles, was billet-studio an Binär-Assets ausliefert, und die dazugehörige Seed-Datei:

| Ausgabe | Erzeugt von |
|---|---|
| `billet-studio-frontend/public/models/<slug>.v<n>.glb` | `models/optimize-models.mjs` |
| `billet-studio-frontend/public/models/previews/<slug>.v<n>.webp` | `models/render-previews.mjs` |
| `sql/seed_models.sql` | `models/generate-seed-models.mjs` |
| `billet-studio-frontend/public/fonts/**`, Font-Katalog | `fonts/merge-fonts.mjs` |
| `billet-studio-frontend/public/hero/textures/<name>.<hash>.webp`, `hero/hero-captures.json` | `hero/capture-hero.mjs` |
| `billet-studio-frontend/public/hero/gifts/<slug>.<hash>.glb`, `hero/hero-gifts.json` | `hero/build-hero-gifts.mjs` |
| `billet-studio-frontend/public/hero/story.<hash>.glb`, `hero/hero-story.json` | `hero/optimize-hero-story.mjs` |
| `billet-studio-frontend/public/hero/posters/<name>.<hash>.webp`, `hero/hero-posters.json` | `hero/capture-hero-posters.mjs` |
| `hero-assets.generated.ts`, `hero-home.generated.ts` (in `src/app/features/home/hero-story/`) | `hero/generate-hero-assets.mjs` |

Diese Dateien werden **nie von Hand** kopiert oder bearbeitet. Wer etwas ändern will, ändert das Manifest
(oder das Skript) und lässt die Pipeline erneut laufen.

## Einrichtung

```bash
cd tools/asset-pipeline
npm install
npx playwright install chromium   # nur für die Vorschaubilder, einmalig
```

Node 22 oder neuer. `node_modules/` ist per `.gitignore` ausgeschlossen, `package-lock.json` wird eingecheckt.

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm run models` | alles für Modelle: optimieren → Vorschaubilder → `seed_models.sql` |
| `npm run models:optimize` | GLBs optimieren (überspringt Modelle, deren Ausgabe aktuell ist) |
| `npm run models:previews` | WebP-Vorschaubilder rendern (headless Chromium, SwiftShader) |
| `npm run models:seed` | `sql/seed_models.sql` neu schreiben |
| `npm run models:compare` | Qualitätsprüfung: Quelle und optimiertes Modell gleich rendern und vergleichen (siehe unten) |
| `npm run hero:capture` | Texturen des 3D-Heros aus dem echten Renderer aufnehmen, danach `hero:assets` (siehe unten) |
| `npm run hero:gifts` | leichte Geschenk-Modelle für den 3D-Hero der Startseite bauen, danach `hero:assets` (siehe unten) |
| `npm run hero:compare` | leichte Hero-Geschenke neben der Katalog-Version rendern (`hero/.captures/gifts-compare.png`) |
| `npm run hero:story` | den Blender-Export der Hero-Story optimieren, prüfen und veröffentlichen, danach `hero:assets` (siehe unten) |
| `npm run hero:story-verify` | nur prüfen: veröffentlichte Story gegen Vertrag und Roh-Export |
| `npm run hero:story-check` | die veröffentlichte Story in three.js wie die Laufzeit abspielen (`hero/.captures/story-check.png`) |
| `npm run hero:posters` | Start- und End-Poster des Heros aus dem Canvas der Laufzeit aufnehmen, danach `hero:assets` (siehe unten) |
| `npm run hero:assets` | nur die Asset-Tabellen der Laufzeit aus den Hero-Manifesten neu schreiben |
| `npm run fonts` | Fonts neu bauen (`fonts/merge-fonts.mjs`) |
| `npm run fonts:check` | nur prüfen, ob die Font-Ausgaben vollständig sind (kein Netz, keine Schreibzugriffe) |

Optionen für die Modell-Skripte, z. B. `npm run models:optimize -- --force --only=gift-box`:

- `--force` baut auch aktuelle Ausgaben neu.
- `--only=slug-a,slug-b` beschränkt den Lauf auf einzelne Modelle.

`models:optimize` gibt am Ende eine Tabelle aus (Quelle MB → Ausgabe MB, Vertices, Texturen, größte
Textur, Draw Calls, Animationen) und endet mit Exit-Code 1, wenn ein Modell sein Größenlimit reißt, eine
Animation verloren geht oder eine Erweiterung der Quelle (z. B. `KHR_materials_unlit`,
`KHR_materials_emissive_strength`) fehlt.

## Quellen bleiben unangetastet

Die Pipeline **liest** nur aus den Quellordnern und schreibt ausschließlich in dieses Repository:

- `digital-card-template/models` – die GLB-Originale (Pfad `sourceDir` im Manifest, überschreibbar mit
  der Umgebungsvariable `BILLET_MODELS_SOURCE_DIR`)
- `muttertag_threejs/` – Referenz des Blumenstraußes (identisch mit `flower_bouquet.glb` oben)
- `Basisrezept/fonts`, `commerce-x/.../public/fonts` – Font-Quellen

Nichts in diesen Ordnern wird verschoben, umbenannt, gelöscht oder überschrieben.

## Was die Optimierung macht

Pro Manifest-Eintrag (glTF-Transform, programmatisch): `dedup` → `instance` (ab 5 gleichen Meshes,
z. B. Weihnachtsbaum) → `flatten` → `join` → `weld` → optional `simplify` → `resample` (verlustfrei, nur
Animationen) → `prune` → Texturen auf `maxTextureSize` verkleinern und als **WebP** (Qualität
`textureQuality`, Standard 88) speichern → **meshopt**-Kompression (`EXT_meshopt_compression` +
`KHR_mesh_quantization`). Animationen und Material-Erweiterungen bleiben erhalten und werden nach dem
Schreiben geprüft. Die Credits (`asset.extras`) bleiben in der Datei.

Verlustbehaftetes WebP speichert Farbe mit halber Auflösung (4:2:0). Bei Normal-Maps, die in Rot/Grün
eine Richtung speichern, glättet das feine Reliefs (zerknitterte Folie, gehämmertes Glas). Mit
`"losslessNormals": true` werden Normal-Maps verlustfrei gespeichert (Datei deutlich größer). Heute
gesetzt für `champagne-bottle` (0,35 → 1,88 MB) und `christmas-baubles` (0,76 → 4,70 MB).

Grenzen: max. 2048 px pro Textur, **≤ 6 MB pro Modell, Blumenstrauß ≤ 8 MB** (`sizeLimitMB`).
Reißt ein Modell das Limit, im Manifest `maxTextureSize` verkleinern (2048 → 1024) und neu laufen lassen.
Vereinfachung der Geometrie (`simplify`) ist standardmäßig aus und wird für animierte Modelle oder
Modelle mit wenigen Vertices ignoriert.

Die Ausgabe gilt als aktuell, wenn sie neuer als die Quelle ist und mit denselben Einstellungen gebaut
wurde (Hash in `asset.extras.billetStudioPipeline`). Vorschaubilder gelten als aktuell, wenn sie neuer
als GLB, Manifest, `preview.html` und Render-Skript sind.

## Neues Blender-Modell hinzufügen

1. **In Blender vorbereiten**
   - Transformationen anwenden (Objekt → Anwenden → Alle Transformationen), Ursprung sinnvoll setzen.
   - Texturen höchstens 2048 × 2048 px; Materialien als Principled BSDF (andere Shader überlebt der
     glTF-Export nicht).
   - Animationen als Actions/NLA anlegen, wenn das Modell animiert sein soll.
2. **Exportieren**: Datei → Exportieren → glTF 2.0, Format **glTF Binary (.glb)**, „+Y Up“ an,
   „Apply Modifiers“ an, **keine** Draco-Kompression (die Pipeline komprimiert mit meshopt).
   Credit: das Feld „Copyright“ im Export-Dialog ausfüllen (landet in `asset.copyright`, z. B.
   „Osterei by Andreas (CC-BY-4.0)“). Sketchfab-Downloads bringen ihre Credits schon in
   `asset.extras` mit (`title`, `author`, `license`, `source`); daraus wird
   `<title> by <author> (<license>) <source>` (max. 255 Zeichen). Ohne beides bleibt `credit` NULL.
3. **Datei ablegen** im Quellordner (`sourceDir` im Manifest, heute `digital-card-template/models`).
4. **Manifest-Eintrag** in `models/models.manifest.json` ergänzen:

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

   - `slug`: klein, mit Bindestrichen, max. 60 Zeichen. **Nie umbenennen**, Billets speichern ihn.
   - `version`: bei jeder inhaltlichen Änderung am Modell erhöhen (`v1` → `v2`, Cache-Busting). Die alte
     Datei bleibt liegen, bis sie bewusst gelöscht wird (die Pipeline listet sie als „nicht im Manifest“).
   - `maxTextureSize`: 2048 für große Hauptmodelle, 1024 für kleine Requisiten oder winzige Texturen.
   - `scene`: Standard-Szene im Editor (Werte wie im Billet-Dokument). `fitSize` 0 < x ≤ 5.
   - Optional: `sizeLimitMB`, `previewRotationY` (Drehung nur fürs Vorschaubild, Standard −0,35 rad),
     `simplify` (`{ "ratio": 0.5, "error": 0.001 }`), `excludeMaterials` (Primitive mit diesen
     Materialnamen werden entfernt, z. B. Deko-Schneeflocken, die das Auto-Fit sprengen),
     `losslessNormals` (Normal-Maps verlustfrei, wenn `models:compare` sichtbaren Verlust zeigt),
     `opaqueMaterials` (diese Materialien werden deckend: `alphaMode` OPAQUE, Alpha 1 – für ein
     BLEND-Material, das nicht durchsichtig sein soll; über der transparenten Canvas scheint sonst die
     Seite durch und bei doppelseitigen Materialien die Rückseite, z. B. ein gespiegeltes Etikett.
     Heute `champagne-bottle`, Material `Glass`).
5. **Pipeline laufen lassen**: `npm run models` (optimieren → Vorschaubild → `sql/seed_models.sql`).
   Tabelle prüfen, Vorschaubild in `public/models/previews/` ansehen.
6. **Datenbank**: `sql/seed_models.sql` spielst **du** ein (phpMyAdmin oder
   `mysql -u root -p db_billet_studio < sql/seed_models.sql`). Die Datei ist idempotent und kann
   jederzeit erneut eingespielt werden. Claude führt nie SQL aus.

## Hero-Texturen

`npm run hero:capture` (`hero/capture-hero.mjs`) nimmt Druck (vorn, innen), Display-Seiten aller
Vorlagen, Sperrbildschirm und Nachricht mit dem **echten Renderer** auf: die Dev-Route
`/dev/hero-capture/:kind` zeichnet sie mit `BilletView` in fester CSS-Größe, Playwright fotografiert
sie (DPR 2, Druck 2,5), je Sprache × Farbmodus (Druck nur hell). Die Seite wartet, bis jede Schrift
wirklich geladen ist, es wird also nie eine Ersatzschrift eingebacken.

- Ausgabe: `public/hero/textures/<name>.<8 Zeichen Inhalts-Hash>.webp` (veraltete werden gelöscht),
  `hero/hero-captures.json` (mit dem normierten 3D-Bereich jeder Display-Seite), verlustfreie PNGs,
  Kontaktbogen und 1:1-Textausschnitt in `hero/.captures/` (gitignored). Exit-Code 1 und nichts
  geschrieben, wenn eine Aufnahme scheitert oder der 3D-Bereich hell und dunkel verschieden liegt.

## Hero-Poster

`npm run hero:posters` (`hero/capture-hero-posters.mjs`) liest die Poster aus dem Canvas der
Laufzeit selbst (`/dev/hero?capture&t=0|end`, `preserveDrawingBuffer`, `toDataURL`): ein Poster ist
genau das Bild, mit dem der Canvas einblendet, transparent um die Story herum. 512 CSS-px bei DPR 2 =
1024 px, WebP mit Alpha (Qualität 82, Alpha 90). Eine Chromium-Seite, die Aufnahmen nacheinander
(WebGL in SwiftShader).

- Start-Poster (t = 0, nur die Karte) je Sprache, End-Poster (Ruhezustand, das Display folgt dem
  Farbmodus) je Sprache × Farbmodus.
- Ausgabe: `public/hero/posters/<name>.<8 Zeichen Inhalts-Hash>.webp` (veraltete werden gelöscht),
  `hero/hero-posters.json`, verlustfreie `hero/.captures/poster-<name>.png`. Exit-Code 1 und nichts
  geschrieben, wenn die Bühne nicht bereit wird, kein WebGL hat oder der Canvas nicht 1024 px misst.
- Nach jeder Änderung an Story, Texturen oder Geschenken zuletzt laufen lassen, sonst passt ein
  Poster nicht mehr zu seinem Bild.

## Server der Hero-Aufnahmen

`hero:capture` und `hero:posters` brauchen die laufende App (Dev-Routen gibt es nur in `ng serve`).
Beide nehmen Port **4330** (nicht 4200 des Entwicklers, nicht die e2e-Ports 4320/4321) und starten dort
selbst `ng serve`, wenn nichts antwortet, und beenden nur, was sie gestartet haben
(`hero/lib/app-server.mjs`). `hero:posters` nimmt mit `HERO_APP_URL` einen schon laufenden Server,
z. B. `set HERO_APP_URL=http://localhost:4200` (Windows) vor `npm run hero:posters`. Jede
`/v1`-Anfrage beantwortet die Aufnahme selbst mit 401 (Gast); kein Backend wird angesprochen.

## Hero-Geschenke

Der 3D-Hero der Startseite zeigt pro Anlass ein Geschenk mit etwa 150–300 CSS-px (DPR 2). Dafür baut
`npm run hero:gifts` leichte Fassungen der fünf Katalog-Modelle, **aus den Quell-GLBs** (nicht aus
`public/models`, sonst würden die Texturen zweimal verlustbehaftet kodiert) mit derselben
Transform-Liste wie der Katalog (`models/lib/optimize.mjs`):

- `hero/hero.manifest.json`: `templateId` → Katalog-`slug`, pro Geschenk `sizeLimitKB` und die
  Abweichungen vom Katalog: `maxTextureSize`, `textureQuality`, `losslessNormals`, `simplify`
  (`ratio`, `error`, optional `flags` für meshoptimizer, z. B. `Permissive`, und `keepMaterials`:
  Materialien, deren Primitive unvereinfacht bleiben, etwa die dünnen Stiele des Straußes),
  `normalTextureSize` (Größe der verlustfreien Normal-Maps) und `stripUnlitNormals` (entfernt `NORMAL`
  bei `KHR_materials_unlit`-Materialien; erst damit lassen sich Scans wie Torte und Strauß vereinfachen).
  Quelle, `excludeMaterials`, `opaqueMaterials`, Credit und Szenen-Standardwerte kommen aus
  `models/models.manifest.json`. Animierte Modelle werden nie vereinfacht (das schlagende Herz bleibt
  eine unveränderte Kopie der Katalog-Einstellungen). Die Schneekugel wird nicht vereinfacht: ihr
  Toon-Umriss ist eine invertierte Hülle mit derselben Topologie wie das Innere; getrennt vereinfacht
  passen beide nicht mehr zusammen (dunkle Flocken, schwarzer Kamin).
- Ausgabe: `public/hero/gifts/<slug>.<8 Zeichen Inhalts-Hash>.glb` (veraltete Hashes werden gelöscht)
  und `hero/hero-gifts.json` (Datei, Bytes, Dreiecke, Texturen, Animations-Clips, Credit,
  Szenen-Standardwerte). Nichts davon landet in `seed_models.sql`.
- Exit-Code 1 und **nichts geschrieben**, wenn ein Geschenk sein `sizeLimitKB` reißt oder `verify()`
  scheitert (verlorene Animation oder Erweiterung).

`npm run hero:compare` rendert jedes leichte Geschenk neben der Katalog-Version mit `models/preview.html`
bei 320 CSS-px × DPR 2, in vier gleichmäßig verteilten Drehwinkeln (der Hero dreht das Geschenk), und
schreibt `hero/.captures/gifts-compare.png` (pro Geschenk der schlechteste Winkel: Katalog | leicht |
Differenz, mit Dateigrößen) plus `gifts-compare-<slug>.png` mit allen vier Winkeln. Nach jeder Änderung
am Manifest ansehen.

## Hero-Story

Die 3D-Story der Startseite (Vertrag: `docs/hero-story.md`) baut Blender per Skript
(`tools/blender/hero/`, `--stage export`) und legt den Roh-Export eingecheckt unter
`tools/blender/hero/export/hero-story.glb` ab. Die Pipeline läuft danach ohne Blender:

- `npm run hero:story` (`hero/optimize-hero-story.mjs`): eine **struktur-erhaltende** Kette, nicht die
  Katalog-Kette: `dedup` nur für Accessoren, Meshes und Texturen (Materialien findet die Laufzeit über
  ihre Namen), `weld`, `resample` (Toleranz 1e-5), 16 × 16-Platzhalter in den Slots, die die Laufzeit
  ersetzt (`M_Print_Front`, `M_Print_Inside` Grundfarbe, `M_Screen` Emission), `BLEND` auf
  `M_Shadow_*`, WebP pro Slot (Papier-Normal-Map 256 px, Handy-AO 512 px, Schatten 256 px), `prune`
  mit `keepLeaves` / `keepAttributes` / `keepExtras` / `keepSolidTextures` (leere Knoten wie `Cam`,
  `Fx_*`, `GiftSlot` bleiben), meshopt Stufe `medium` (Positionen 14, Normalen 10, UVs 12 Bit;
  Animationsdaten verlustfrei). **Kein** `flatten`, `join`, `instance` oder `simplify`. `quantize`
  hängt das Mesh eines animierten Knotens (die Schatten-Patches der Karte drehen mit ihr) an einen
  Kindknoten, der `<Knoten>_Mesh` heißt.
- Geprüft wird vor dem Schreiben (`hero/verify-hero-story.mjs`): `extras.heroStory` wie `parseStoryMeta`
  der Laufzeit, Pflicht-Knoten, genau ein Clip `Story` mit der Story-Dauer, jede `Shadow_<Name>` mit
  `M_Shadow_<Name>` (BLEND), die Platzhalter, `TEXCOORD_0/1` wo Materialien sie lesen, keine
  `KHR_materials_*`-Erweiterung (three.js würde auf `MeshPhysicalMaterial` wechseln), der Skin von
  `Card_Spine` (`Spine_00`..`Spine_16`), die Dock-Extras, der Khronos-Validator (0 Fehler), **≤ 600 KB**
  und die Posen: an Stützstellen alle 0,25 s die Weltmatrizen der animierten Knoten und die
  Welt-Bounding-Boxen aller Meshes (Karte nach dem Skinning) gegen den Roh-Export, **≤ 0,2 mm**; am Ende
  des Clips ist `GiftSlot` gleich `Phone_ScreenDock`.
- Ausgabe: `public/hero/story.<8 Zeichen Inhalts-Hash>.glb` (alte Hashes werden gelöscht) und
  `hero/hero-story.json` (Datei, Bytes, Dreiecke, geparste Story-Meta, Knoten, Texturen, Prüfwerte).
  Danach schreibt `hero:assets` die Asset-Tabelle der Laufzeit neu. Exit-Code 1 und nichts geschrieben,
  wenn eine Prüfung scheitert.
- `npm run hero:story-check` (`hero/check-story.mjs` + `hero/story-check.html`): spielt die
  veröffentlichte Story in headless Chromium so ab wie die Laufzeit (Kamera aus `Cam` / `CamTarget` mit
  dem Story-FOV, pausierter Clip auf die Zeit gesetzt, Drucktexturen, einfacher unbeleuchteter
  Bildschirm: Sperrbildschirm mit dem Nachrichten-Banner (`Fx_Notif`, Größe aus der Aufnahme wie im
  Bildschirm-Shader der Laufzeit) → Billet, Karten- und Schatten-Fx, das leichte Herz unter `GiftSlot`
  per `fitTransform` mit seinem Clip auf der Story-Zeit, RoomEnvironment und die Lichter der
  Laufzeit; Tone-Mapping ACES als Standard der Prüfseite, die Laufzeit nutzt Neutral: mit
  `--tone-mapping=neutral` zeigt die Prüfseite deren Farben), rendert in einer einzigen Seite dieselben Zeitpunkte wie der Blender-Kontaktbogen (alle
  0,5 s) nach `hero/.captures/story-check.png` und die Vollbild-Zeitpunkte (0 / 2,4 / 4,6 / 7,2 / 8,8 /
  10 s) als `story-check-t<t>.png` und vergleicht die Positionen der Knoten und die Fx-Werte mit Blenders
  Referenz (`tools/blender/hero/.renders/story/checks.json`, Toleranz 0,5 mm). Für Licht-Versuche:
  `npm run hero:story-check -- --hero-exposure=0.8 --tone-mapping=neutral` (eigene Dateinamen).

## Hero-Asset-Tabellen

`npm run hero:assets` (`hero/generate-hero-assets.mjs`) schreibt aus `hero-captures.json`,
`hero-gifts.json`, `hero-story.json` und `hero-posters.json` die beiden Tabellen der Laufzeit:
`hero-assets.generated.ts` (alles; nur der Lazy-Chunk des Heros importiert sie) und
`hero-home.generated.ts` (was die Startseite vor dem Chunk braucht: Story-URL, Poster, Credits).
Ohne `hero-story.json` zeigt der Hero kein 3D, ohne `hero-posters.json` einen Platzhalter statt
Poster. Exit-Code 1 und nichts geschrieben, wenn ein Manifest unvollständig ist oder eine Datei
nennt, die nicht in `public/` liegt. Alle erzeugenden Hero-Skripte rufen es am Ende auf.

## Fonts

`npm run fonts` ruft `fonts/merge-fonts.mjs` auf. Das Skript führt die lokalen Font-Ordner zusammen,
lädt die im Font-Manifest genannten Google-Fonts-Familien als woff2 (latin + latin-ext) und schreibt
`public/fonts/`, den Font-Katalog und die Vorschauseite. `npm run fonts:check` prüft nur die vorhandenen
Ausgaben. Details stehen im Kopf von `fonts/merge-fonts.mjs` und in `fonts/fonts.manifest.json`.

## Vorschau-Renderer

`models/preview.html` ist eine eigenständige three.js-Seite mit dem Look der Billet-Szene
(ACES-Filmic, Belichtung pro Modell, RoomEnvironment, dieselben drei Lichter, Kamera fov 42 auf
`(0, cameraHeight, cameraDistance)`, Auto-Fit über die Bounding Box). `render-previews.mjs` startet dafür
einen lokalen Mini-Server (nur `127.0.0.1`), rendert jedes **optimierte** Modell in headless Chromium mit
doppelter Auflösung und speichert es als 512 × 512-WebP mit transparentem Hintergrund.

## Qualitätsvergleich

`npm run models:compare` (optional `-- --only=slug`) rendert für jedes Modell die **Quelle** und das
**optimierte** GLB mit denselben Einstellungen wie das Vorschaubild. Das optimierte Modell nutzt dabei
die Bounding Box der Quelle, damit beide Bilder pixelgenau übereinanderliegen. Ausgabe in `.compare/`
(per `.gitignore` ausgeschlossen, `public/` bleibt unberührt):

- `.compare/<slug>.png`: Quelle | optimiert | Differenz (rot, 6-fach verstärkt)
- `.compare/report.json` und eine Tabelle: mittlere Abweichung, Anteil stark abweichender Pixel
  (ein Kanal > 8/255, bezogen auf die Modellfläche), Änderung der Silhouette und „fit drift“ (wie weit
  das Auto-Fit des optimierten Modells vom Original abweicht).

Modelle über 3 % stark abweichender Pixel oder 1 % Drift werden mit `CHECK` markiert. Das heißt nur
„ansehen“: Detailreiche Texturen (Backstein, Kuchenstreusel) weichen durch WebP und Verkleinerung
immer etwas ab, ohne sichtbar schlechter zu sein.
