# billet-studio

> Web-Editor für digitale Billets – Angular 22 + Spring Boot 4 + MariaDB + three.js

billet-studio macht aus dem Muttertags-Billet (`muttertag_threejs`) einen Generator: Im Editor baust du Billets im selben Look – Hero, 3D-Modell, Divider, Absätze, Fun-Card, Note, Signatur und fallende Blütenblätter – mit eigenen Farben, Schriften, Abständen und Modellen.

- **Gast:** Billets werden im Browser gespeichert (localStorage).
- **Eingeloggt:** Billets liegen in der Datenbank, mit Autosave, Liste und Übernahme der Gast-Billets.
- **Teilen:** Eingeloggte User veröffentlichen ein Billet unter einem öffentlichen Link `/b/{shareToken}`. Der Link zeigt einen Snapshot; weiteres Bearbeiten ändert ihn erst beim nächsten Veröffentlichen.
- Oberfläche auf Deutsch und Englisch in einem festen Design („Studio“, hell/dunkel nach System oder Wahl), Admin-Benutzerverwaltung.
- 16 Themes als Designvorlagen fürs Billet (Farben, Schriften, Partikel): Sie gestalten nur das Billet in der Vorschau und auf der geteilten Seite, nie die Oberfläche.

Stack und Auth-Modul entsprechen CommerceX (Schwesterprojekt `../commerce-x`, dient nur als Vorlage und wird nicht verändert).

---

## Tech-Stack

| Schicht | Technik |
|---|---|
| **Backend** | Spring Boot 4.0.7, Java 25, Spring Security, JWT (HS512) + gespeicherte Sessions, Spring Data JPA, Thymeleaf (Mails) |
| **Frontend** | Angular 22 (zoneless, Signal Forms), TypeScript, ngx-translate, Angular CDK, three.js, bootstrap-icons (nur Icon-Font) |
| **Datenbank** | MariaDB 10.4 (XAMPP), kompatibel mit MySQL 8.0.16+ |
| **Tests** | Vitest (Frontend), JUnit 5 + Testcontainers (Backend), Playwright (e2e, Parität) |
| **Assets** | `tools/asset-pipeline`: glTF-Transform (meshopt + WebP), sharp, Playwright |

---

## Ordnerstruktur

```
billet-studio/
├── billet-studio-frontend/       Angular-App
│   ├── src/app/
│   │   ├── core/                 Services, Interceptors, Guards, Stores, DTOs (core/models)
│   │   ├── features/             Seiten (home, templates, auth, account, admin, editor, billets, public-billet …)
│   │   ├── shared/               wiederverwendbare Komponenten, Direktiven
│   │   ├── layout/               App-Shell, schlichtes Layout
│   │   └── billet/               Renderer (Editor-Vorschau und öffentliche Seite = dieselbe Ansicht)
│   ├── public/models/            GLBs + Vorschaubilder (Ausgabe der Asset-Pipeline)
│   └── e2e/                      Playwright-Tests (gemockt, Parität, axe, echtes Backend)
├── billet-studio-rest-service/   Spring Boot, Paket app.billetstudio (auth, shared, catalog, billet)
├── sql/                          schema.sql, Seeds, migrations/ – spielst du selbst ein
├── docs/                         API-Vertrag, Billet-Dokument, Muttertag-Referenzdokument
├── tools/asset-pipeline/         Skripte für GLBs, Vorschaubilder, Schriften, seed_models.sql
├── docker-compose.e2e.yml        Wegwerf-MariaDB für die e2e-Tests mit echtem Backend
├── CLAUDE.md                     Entwicklungsstandards
├── README.md
└── .env.example                  Vorlage für .env.local / .env.production
```

---

## Voraussetzungen

- **Java 25** (JDK)
- **Node.js 26** (mit npm)
- **XAMPP** mit MariaDB (lokale Datenbank)
- **Docker** – nicht für den Betrieb, aber für die Backend-Tests (Testcontainers startet eine Wegwerf-MariaDB) und die e2e-Tests mit echtem Backend
- Optional: **Blender** und die Asset-Pipeline (eigenes `npm install` in `tools/asset-pipeline/`), nur für neue oder geänderte 3D-Modelle

---

## Lokaler Start

### 1. Datenbank

Die Datenbank verwaltest du selbst; das Backend legt keine Tabellen an (`ddl-auto: none`). Details in [sql/README.md](sql/README.md).

**Neue Datenbank** (Reihenfolge):

1. `CREATE DATABASE db_billet_studio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
2. `sql/schema.sql`
3. `sql/seed_roles.sql`
4. `sql/seed_models.sql`

Die Migrationen in `sql/migrations/` brauchst du dann nicht: `schema.sql` und die Seeds enthalten sie schon.

**Bestehende Datenbank:** nur die Migrationen einspielen, die neuer sind als deine Datenbank, in Datumsreihenfolge (der Dateiname beginnt mit dem Datum). Jede Datei sagt im Kopf, wofür sie ist und ob sie vor dem Start eines neuen Backends laufen muss. Stand heute:

| Datei | Inhalt |
|---|---|
| `2026-09-25_model-defaults-cake-globe-champagne.sql` | Katalog: neue Standardwerte für Torte und Schneekugel, neu gebaute Champagnerflasche |
| `2026-09-26_billet_theme_column.sql` | `tbl_billets.theme` für die Farbfelder in „Meine Billets“, befüllt aus den vorhandenen Billets. **Vor** dem Start des neuen Backends einspielen – ohne die Spalte schlägt jede Billet-Anfrage fehl (`Unknown column 'theme'`). |

Beide sind wiederholbar (ein zweiter Lauf ändert nichts).

### 2. Konfiguration

```bash
cp .env.example .env.local
```

`.env.local` liegt im Repo-Root und ist gitignored; das Backend liest sie beim Start. Lokal anpassen:

- `DATABASE_URL`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` – deine MariaDB (XAMPP: `root`, Passwort leer).
- `JWT_SECRET` – mindestens 64 Byte, z. B. `openssl rand -hex 32`.
- `ROOT_EMAIL`, `ROOT_PASSWORD` – der Root-Admin, den das Backend beim ersten Start anlegt.
- Alles andere passt für den lokalen Start. `MAIL_ENABLED=false`: Mails werden nicht verschickt, der Passwort-Reset-Link steht dann im Backend-Log. `MODELS_BASE_URL=http://localhost:4200/`: die 3D-Modelle kommen aus der Angular-App.

Das Frontend liest keine `.env`-Datei: Seine Standardwerte (API auf `http://localhost:8080/v1/`) stecken im Build, eine Installation kann sie über `public/env.js` (`window.__env`) überschreiben.

### 3. Backend

```bash
cd billet-studio-rest-service
./mvnw spring-boot:run          # Windows: mvnw.cmd spring-boot:run
```

Läuft auf http://localhost:8080, Swagger-UI unter http://localhost:8080/swagger-ui.html (solange `SWAGGER_ENABLED=true`). Beim Start wird der Root-Admin aus `ROOT_EMAIL` / `ROOT_PASSWORD` angelegt.

### 4. Frontend

```bash
cd billet-studio-frontend
npm install
npm start
```

Läuft auf http://localhost:4200. Ohne Anmeldung arbeitest du als Gast (Billets im Browser); mit Konto (Registrierung oder Root-Admin) liegen sie in der Datenbank.

### Tests und Build

```bash
# Backend: Unit- und Integrationstests (Docker muss laufen; die ITs starten eine Wegwerf-MariaDB)
cd billet-studio-rest-service
./mvnw test                     # Windows: mvnw.cmd test
./mvnw -DskipTests package      # das JAR, das die e2e-Tests mit echtem Backend starten

# Frontend
cd billet-studio-frontend
npm test -- --no-watch          # Vitest; Exit-Code prüfen, nicht nur "passed"
npm run build                   # Produktions-Build mit Bundle-Budgets
npm run e2e                     # Playwright mit gemocktem Backend, ohne Docker (inkl. Parität und axe)
npm run e2e:parity              # nur der Paritätstest gegen die Muttertags-Karte
npx fallow audit                # toter Code, Duplikate, Komplexität
```

- Die Integrationstests laufen nur mit Docker wirklich: Im Log steht dann „Found Docker environment“, und kein `*IT` ist übersprungen (`Skipped: 0`). Deine Datenbank benutzen sie nie.
- `mvnw test` und `package` schreiben nach `target/`; ein laufendes `spring-boot:run` startet dabei per devtools neu.
- `npm run e2e` startet `ng serve` auf Port 4320 ohne Watch und HMR (Änderungen während eines Laufs gelten erst im nächsten) und die Momentaufnahme der Muttertags-Karte auf 4321. Die Tests beantworten jede API-Anfrage selbst; Backend und Datenbank werden nicht gebraucht.
- `e2e/a11y.spec.ts` prüft jede Seite und jeden Dialog mit axe (WCAG 2.0/2.1 A und AA); bewusste Ausnahmen stehen dort mit Begründung. Der Paritätstest vergleicht das Muttertags-Billet pixelgenau mit der Live-Karte (390×844 und 1280×800, hell und dunkel, ≤ 1 %); er lädt deren Schriften von Google Fonts und braucht dafür Netz.

### E2E-Tests mit echtem Backend

Die Konto-Abläufe (Registrierung, Autosave mit Konflikt, Teilen-Link, Übernahme eines Gast-Billets, Löschen) laufen gegen das echte Backend und eine Wegwerf-Datenbank. Docker muss laufen.

```bash
cd billet-studio-frontend
npm run e2e:backend             # startet die e2e-Datenbank und die Tests
npm run e2e:down                # e2e-Datenbank wieder entfernen
```

- `e2e:backend` startet per [docker-compose.e2e.yml](docker-compose.e2e.yml) eine MariaDB 10.11 auf Port 3307 (`db_billet_studio_e2e`, aus `sql/schema.sql` + Seeds, Daten nur im RAM), dann das gebaute Backend-JAR auf Port 8081 und `ng serve` auf Port 4320. Deine Entwicklungsumgebung (4200, 8080, `db_billet_studio`) läuft ungestört weiter und wird nie angesprochen.
- Die Tests starten das JAR aus `billet-studio-rest-service/target`, nicht `spring-boot:run`. Ist es älter als die Backend-Quellen, bricht der Lauf mit einem Hinweis ab; dann neu bauen: `mvnw.cmd -DskipTests package` (sonst `./mvnw`) in `billet-studio-rest-service`. Ein laufendes `spring-boot:run` kann dabei per devtools neu starten.
- Die Datenbank bleibt zwischen den Läufen stehen (jeder Test registriert ein eigenes Konto), `e2e:down` verwirft sie. Nach einer Schemaänderung also erst `e2e:down`: Die e2e-Datenbank entsteht nur beim Start aus `schema.sql` und den Seeds. Port 3307 nutzt auch der CommerceX-e2e-Stack, also nicht beide gleichzeitig.
- Backend-Logs der Läufe: `billet-studio-frontend/e2e/artifacts/backend/logs/`.

---

## Asset-Pipeline

3D-Modelle, ihre Vorschaubilder, `sql/seed_models.sql` und die Schriften entstehen nur mit den Skripten in [tools/asset-pipeline/](tools/asset-pipeline/README.md) – nie von Hand kopiert oder bearbeitet. Die Quellordner (`digital-card-template/`, `muttertag_threejs/`, Schriftquellen) liest die Pipeline nur.

```bash
cd tools/asset-pipeline
npm install
npx playwright install chromium   # einmalig, für die Vorschaubilder
npm run models                    # GLBs optimieren → Vorschaubilder → seed_models.sql
npm run fonts                     # Schriften neu bauen
```

- Ausgabe: `billet-studio-frontend/public/models/<slug>.v<n>.glb` und `public/models/previews/<slug>.v<n>.webp` (meshopt + WebP-Texturen, max. 2048 px, ≤ 6 MB, Blumenstrauß ≤ 8 MB).
- Ändert sich der Inhalt eines Modells, steigt `v<n>` (die Dateien werden ein Jahr lang `immutable` gecacht). Jede Katalogänderung bringt zusätzlich eine datierte Migration mit nur den geänderten Zeilen mit, damit eine bestehende Datenbank nie die ganze Seed-Datei braucht.
- Slugs bleiben für immer: Billets verweisen auf sie.
- Ein neues Modell aus Blender: Checkliste in [tools/asset-pipeline/README.md](tools/asset-pipeline/README.md), Abschnitt „Neues Blender-Modell hinzufügen“.

---

## Modelle vom Backend ausliefern

Heute liefert die Angular-App die 3D-Modelle mit aus (`billet-studio-frontend/public/models/`: die GLBs und `previews/` mit den WebP-Vorschaubildern). `tbl_models` speichert nur relative Pfade (`models/<slug>.v<n>.glb`, `models/previews/<slug>.v<n>.webp`), und das Backend macht daraus mit `MODELS_BASE_URL` die absoluten URLs, die Editor und `/b/:token` laden. Später liegen die Dateien auf dem Server neben dem Spring-Boot-Backend. Der Umzug heißt: Dateien kopieren, zwei Werte setzen – **keine Datenbankänderung, kein SQL**.

1. **Dateien kopieren.** Den Inhalt von `billet-studio-frontend/public/models/` (alle `*.glb` und den Ordner `previews/`) in ein eigenes Verzeichnis auf dem Server kopieren, z. B.:

   ```bash
   rsync -a billet-studio-frontend/public/models/ USER@HOST:/srv/billet-studio/models/
   ```

   Danach liegt dort z. B. `/srv/billet-studio/models/flower-bouquet.v1.glb` und `/srv/billet-studio/models/previews/flower-bouquet.v1.webp`.
2. **`MODELS_DIRECTORY`** in `.env.production` auf genau dieses Verzeichnis setzen, als absoluten Pfad (ein relativer hängt vom Arbeitsverzeichnis des Backends ab):

   ```properties
   MODELS_DIRECTORY=/srv/billet-studio/models
   ```

3. **`MODELS_BASE_URL`** auf `/files/` des API-Hosts setzen, mit Schrägstrich am Ende:

   ```properties
   MODELS_BASE_URL=https://api.example.com/files/
   ```

   Aus `models/flower-bouquet.v1.glb` wird so `https://api.example.com/files/models/flower-bouquet.v1.glb`.
4. **Backend neu starten und prüfen:**

   ```bash
   # GET, nur die Header ausgeben (curl -I schickt HEAD, das Backend erlaubt hier nur GET)
   curl -s -D - -o /dev/null https://api.example.com/files/models/flower-bouquet.v1.glb
   curl -s https://api.example.com/v1/models      # fileUrl / previewUrl zeigen jetzt auf /files/models/
   ```

   Erwartet: `200`, `Content-Type: model/gltf-binary`, `Cache-Control: max-age=31536000, public, immutable`. Antwortet jede Datei mit `404`, stimmt das Verzeichnis nicht; das Backend-Log meldet dann beim Start `app.models.directory … is not a directory`.
5. **Im Browser** ein Billet mit 3D-Modell öffnen (Editor und `/b/:token`): Die GLBs kommen jetzt vom API-Host. Das Frontend muss dafür nicht neu gebaut werden.

Was das Backend dabei tut (`WebConfig`):

- Es liefert `GET /files/models/**` nur, solange `MODELS_DIRECTORY` gesetzt ist; leer (Standard) antwortet der Pfad mit `404`.
- Aus dem Verzeichnis gehen nur `.glb` und `.webp` hinaus, alles andere ist `404`; Pfade mit `..` (auch kodiert) lehnt es mit `400` ab. Trotzdem gehört nur der Modell-Ordner dorthin, nie ein übergeordnetes Verzeichnis.
- Die Dateien sind öffentlich (ohne Login) und ein Jahr lang `immutable` cachebar: Jede inhaltliche Änderung an einem Modell bekommt eine neue Version im Dateinamen (`.v1` → `.v2`, `version` im Manifest der Asset-Pipeline), eine URL ändert also nie ihren Inhalt.
- CORS gilt für dieselben Origins wie die API (`CORS_ALLOWED_ORIGINS`): three.js lädt die GLBs per `fetch` vom API-Host, das braucht den `Access-Control-Allow-Origin`-Header. Die Vorschaubilder sind normale `<img>` und brauchen keinen.

Zurück zur Auslieferung über die Angular-App: `MODELS_BASE_URL` wieder auf die Frontend-URL setzen, `MODELS_DIRECTORY` leeren, Backend neu starten.

`public/models/` bleibt im Repo, auch nach dem Umzug: Es ist die Ausgabe der Asset-Pipeline, die Quelle für jede Kopie auf den Server, und die e2e-Tests und Entwickler-Seiten laden daraus.

**Lokal ausprobieren** (optional): in `.env.local`

```properties
MODELS_DIRECTORY=../billet-studio-frontend/public/models
MODELS_BASE_URL=http://localhost:8080/files/
```

(relativ zu `billet-studio-rest-service/`, wo `mvnw` läuft), Backend neu starten – die Modelle kommen dann von Port 8080.

### Neue oder geänderte Modelle

Ein Modell aus Blender exportieren und durch die Pipeline schicken: Checkliste und Befehle in [tools/asset-pipeline/README.md](tools/asset-pipeline/README.md), Abschnitt „Neues Blender-Modell hinzufügen“ (GLB-Export mit angewendeten Transformationen, Texturen ≤ 2048 px, keine Draco-Kompression, Credit im Copyright-Feld, dann `npm run models`).

Solange das Backend die Modelle ausliefert, ist die Reihenfolge danach wichtig:

1. Neue Dateien (`<slug>.v<n>.glb` und `previews/<slug>.v<n>.webp`) nach `MODELS_DIRECTORY` kopieren – zuerst, sonst zeigt der Katalog auf eine Datei, die es noch nicht gibt.
2. Dann die SQL-Datei einspielen (neue Datenbank: `sql/seed_models.sql`, bestehende: die datierte Migration in `sql/migrations/`).
3. Alte Versionen können liegen bleiben; löschen erst, wenn kein Katalogeintrag mehr auf sie zeigt.

---

## Produktion: nginx

Hinweise für die nginx-Konfiguration vor Frontend und Backend. `add_header` in einem `location`-Block ersetzt **alle** `add_header` des `server`-Blocks – die Sicherheits-Header (z. B. `X-Content-Type-Options`, `Referrer-Policy`) in solchen Blöcken wiederholen oder per `include` einbinden.

**Frontend-Host** (die gebaute Angular-App):

```nginx
# Modelle, solange sie mit der App ausgeliefert werden. Die Dateinamen sind versioniert (.v<n>).
location ^~ /models/ {
    types { model/gltf-binary glb; image/webp webp; }
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    gzip off;
    # brotli off;   # nur mit geladenem brotli-Modul
}

# Geteilte Billets sind private Grüße: nicht indexieren. Die Seite setzt zusätzlich <meta name="robots">,
# das sehen aber nur Crawler, die JavaScript ausführen.
location ^~ /b/ {
    add_header X-Robots-Tag "noindex" always;
    try_files $uri /index.html;
}
```

**API-Host** (Proxy auf das Backend): Für `/files/models/` braucht es keinen eigenen Block – `Content-Type`, `Cache-Control` und CORS setzt das Backend selbst, nginx reicht sie durch. `X-Robots-Tag: noindex` für `/v1/public/**` setzt das Backend ebenfalls.

**Keine Kompression für `.glb` und `.webp`:** Beide sind schon komprimiert (WebP-Bilder und -Texturen, meshopt-Geometrie); gzip oder brotli im laufenden Betrieb kostet CPU und bringt kaum etwas. `gzip_types` / `brotli_types` also auf Text beschränken und weder `model/gltf-binary`, `image/webp` noch `*` aufnehmen, z. B.:

```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript image/svg+xml;
```

---

## Roadmap

Jede Phase wird umgesetzt, geprüft und dann lokal committet.

| Phase | Inhalt | Stand |
|---|---|---|
| **P0** Scaffold | Git-Repo, Root-Dateien, `sql/`, Backend-Gerüst (Maven Wrapper, `pom.xml`, `application.yml`), Angular-App (zoneless, Vitest, strikte tsconfig) | erledigt |
| **P1** Backend-Auth | Auth-Modul aus CommerceX portiert und entkoppelt: Registrierung, Login, Sessions, Passwort-Reset, Konto-Deaktivierung (30 Tage), Avatar, Root-Admin, Admin-Benutzerverwaltung, Mails | erledigt |
| **P2** Katalog + Billets | `tbl_models`-Katalog, Billet-CRUD mit Optimistic Lock, Veröffentlichen/Zurückziehen, Gast-Import, öffentlicher Endpunkt | erledigt |
| **P3** Frontend-Fundament | Token-/Theme-System mit Generator, eigene CSS-Komponenten, Auth-Port (Interceptors, Guards, Stores), Login/Registrierung/Konto/Admin, i18n DE/EN | erledigt |
| **P4** Asset-Pipeline | GLBs optimieren (meshopt + WebP), Vorschaubilder rendern, `seed_models.sql` generieren, Schriften zusammenführen und lokal als woff2 ablegen | erledigt |
| **P5** Renderer | Billet-Dokument + Migration, Mini-Markup, Paletten, Partikel, 3D-Szene, Vorlagen (Muttertag 1:1, Valentinstag, Geburtstag, Weihnachten, Hochzeit), öffentliche Seite `/b/:token`, Paritätstest gegen das Original | erledigt |
| **P6** Editor (Gast) | Editor mit Undo/Redo, Panels für Inhalt, Design, Abstände, 3D und Partikel, eigene Picker (Farbe, Schrift, Modell, Emoji), Speicherung im Browser | erledigt |
| **P7** Server-Speicherung | Autosave mit Konflikterkennung, Billet-Liste, Import der Gast-Billets, Teilen-Dialog (veröffentlichen, aktualisieren, zurückziehen), e2e gegen das echte Backend (Docker Compose) | erledigt |
| **P8** Härtung + Doku | fallow-Audit, Bundle-Budgets (three.js nur im Lazy-Chunk), axe-Prüfung aller Seiten und Dialoge (`e2e/a11y.spec.ts`), stabile parallele e2e-Läufe, Sicherheitsdurchsicht, Theme-Farbfelder in „Meine Billets“ (`tbl_billets.theme`), Toasts unten und über Dialogen, Modelle optional vom Backend ausliefern (`MODELS_DIRECTORY`) mit Runbook, nginx-Hinweise, Blender-Export-Checkliste, README/CLAUDE.md | erledigt (Lighthouse offen) |
| **Hero-Story C** (eigener Folgeplan) | Home-Hero als Sequenz: Das Billet steht → klappt auf → schwebt in ein Handy-Mockup, auf dessen Display das echte Billet läuft (Video-Textur). Modelle (stehend, liegend, Handy) und die Aufklapp-Animation kommen aus Blender, in mehreren Iterationen | zurückgestellt, nach P8 |

---

## Git

Remote: `origin` = https://github.com/AndreasLesovsky/billet-studio, Branch `main`. Nach jeder geprüften Phase (Tests und Build grün, deine Abnahme) entsteht ein Commit, der nach `origin main` gepusht wird – nie per Force-Push, keine weiteren Branches.
