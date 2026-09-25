# Asset-Pipeline

Erzeugt alles, was billet-studio an Binär-Assets ausliefert, und die dazugehörige Seed-Datei:

| Ausgabe | Erzeugt von |
|---|---|
| `billet-studio-frontend/public/models/<slug>.v<n>.glb` | `models/optimize-models.mjs` |
| `billet-studio-frontend/public/models/previews/<slug>.v<n>.webp` | `models/render-previews.mjs` |
| `sql/seed_models.sql` | `models/generate-seed-models.mjs` |
| `billet-studio-frontend/public/fonts/**`, Font-Katalog | `fonts/merge-fonts.mjs` |

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
