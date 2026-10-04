# billet-studio

> Web editor for digital billets – Angular 22 + Spring Boot 4 + MariaDB + three.js

billet-studio turns the Mother's Day billet (`muttertag_threejs`) into a generator: in the editor you build billets with the same look – hero, 3D model, divider, paragraphs, fun card, note, signature and falling petals – with your own colours, fonts, spacing and models.

- **Guest:** billets are stored in the browser (localStorage).
- **Signed in:** billets live in the database, with autosave, a list and the import of guest billets.
- **Sharing:** signed-in users publish a billet under a public link `/b/{shareToken}`. The link shows a snapshot; further editing changes it only with the next publish.
- UI in German and English in one fixed design ("Studio", light/dark by system or choice), admin user management.
- 16 themes as design presets for the billet (colours, fonts, particles): they style only the billet in the preview and on the shared page, never the UI.
- **Billet assistant (optional, agentic UI):** on the home page and in the template gallery you describe your billet in one sentence and refine it in a chat; a local language model (Ollama) only picks template, theme, 3D motif, particles, divider, appearance and language from fixed lists – you write the words yourself.

Stack and auth module follow CommerceX (sister project `../commerce-x`, used as a reference only and never changed).

---

## Tech stack

| Layer | Technology |
|---|---|
| **Backend** | Spring Boot 4.0.7, Java 25, Spring Security, JWT (HS512) + stored sessions, Spring Data JPA, Thymeleaf (mails) |
| **Frontend** | Angular 22 (zoneless, Signal Forms), TypeScript, ngx-translate, Angular CDK, three.js, bootstrap-icons (icon font only) |
| **Database** | MariaDB 10.4 (XAMPP), compatible with MySQL 8.0.16+ |
| **Assistant** | Ollama with `qwen2.5:14b` (local, optional), called directly by the backend |
| **Tests** | Vitest (frontend), JUnit 5 + Testcontainers (backend), Playwright (e2e, parity) |
| **Assets** | `tools/asset-pipeline`: glTF-Transform (meshopt + WebP), sharp, Playwright |

---

## Folder structure

```
billet-studio/
├── billet-studio-frontend/       Angular app
│   ├── src/app/
│   │   ├── core/                 services, interceptors, guards, stores, DTOs (core/models)
│   │   ├── features/             pages (home, templates, auth, account, admin, editor, billets, public-billet …)
│   │   ├── shared/               reusable components, directives (incl. billet-assistant)
│   │   ├── layout/               app shell, bare layout
│   │   └── billet/               renderer (editor preview and public page = the same view)
│   ├── public/models/            GLBs + previews (asset pipeline output)
│   ├── public/hero/              the home page's 3D hero: story, textures, gifts, posters (pipeline output)
│   └── e2e/                      Playwright tests (mocked, parity, axe, real backend)
├── billet-studio-rest-service/   Spring Boot, package app.billetstudio (auth, shared, catalog, billet, assist)
├── sql/                          schema.sql, seeds, migrations/ – you run them yourself
├── docs/                         API contract, billet document, hero story contract, assistant questionnaire, Mother's Day reference document
├── tools/asset-pipeline/         scripts for GLBs, previews, fonts, seed_models.sql, hero assets
├── tools/blender/hero/           Blender Python scripts of the hero story (headless), raw export
├── docker-compose.e2e.yml        throwaway MariaDB for the e2e tests against the real backend
├── CLAUDE.md                     development standards
├── README.md
└── .env.example                  template for .env.local / .env.production
```

---

## Prerequisites

- **Java 25** (JDK)
- **Node.js 26** (with npm)
- **XAMPP** with MariaDB (local database)
- **Docker** – not for running the app, but for the backend tests (Testcontainers starts a throwaway MariaDB) and the e2e tests against the real backend
- Optional: **Ollama** with `qwen2.5:14b` for the billet assistant (see "Billet assistant")
- Optional: **Blender** and the asset pipeline (its own `npm install` in `tools/asset-pipeline/`), only for new or changed 3D models

---

## Local start

### 1. Database

You manage the database yourself; the backend creates no tables (`ddl-auto: none`). Details in [sql/README.md](sql/README.md).

**New database** (in this order):

1. `CREATE DATABASE db_billet_studio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
2. `sql/schema.sql`
3. `sql/seed_roles.sql`
4. `sql/seed_models.sql`

You then don't need the migrations in `sql/migrations/`: `schema.sql` and the seeds already contain them.

**Existing database:** run only the migrations newer than your database, in date order (the file name starts with the date). Each file says in its header what it is for and whether it must run before a new backend starts. As of today:

| File | Content |
|---|---|
| `2026-09-25_model-defaults-cake-globe-champagne.sql` | Catalog: new defaults for cake and snow globe, rebuilt champagne bottle |
| `2026-09-26_billet_theme_column.sql` | `tbl_billets.theme` for the colour swatches in "Meine Billets" (My billets), filled from the existing billets. Run it **before** starting the new backend – without the column every billet request fails (`Unknown column 'theme'`). |

Both can be run twice (a second run changes nothing).

### 2. Configuration

```bash
cp .env.example .env.local
```

`.env.local` lives in the repository root and is gitignored; the backend reads it at startup. Adjust locally:

- `DATABASE_URL`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` – your MariaDB (XAMPP: `root`, empty password).
- `JWT_SECRET` – at least 64 bytes, e.g. `openssl rand -hex 32`.
- `ROOT_EMAIL`, `ROOT_PASSWORD` – the root admin the backend creates on its first start.
- Everything else fits a local start. `MAIL_ENABLED=false`: no mails are sent, the password reset link is written to the backend log instead. `MODELS_BASE_URL=http://localhost:4200/`: the 3D models come from the Angular app. `ASSIST_ENABLED=false`: no billet assistant (see "Billet assistant").

The frontend reads no `.env` file: its defaults (API at `http://localhost:8080/v1/`) are part of the build; an installation can override them through `public/env.js` (`window.__env`).

### 3. Backend

```bash
cd billet-studio-rest-service
./mvnw spring-boot:run          # Windows: mvnw.cmd spring-boot:run
```

Runs on http://localhost:8080, Swagger UI at http://localhost:8080/swagger-ui.html (while `SWAGGER_ENABLED=true`). At startup the root admin from `ROOT_EMAIL` / `ROOT_PASSWORD` is created.

### 4. Frontend

```bash
cd billet-studio-frontend
npm install
npm start
```

Runs on http://localhost:4200. Without signing in you work as a guest (billets in the browser); with an account (registration or the root admin) they live in the database.

### Tests and build

```bash
# Backend: unit and integration tests (Docker must be running; the ITs start a throwaway MariaDB)
cd billet-studio-rest-service
./mvnw test                     # Windows: mvnw.cmd test
./mvnw -DskipTests package      # the JAR the e2e tests against the real backend start

# Frontend
cd billet-studio-frontend
npm test -- --no-watch          # Vitest; check the exit code, not just "passed"
npm run build                   # production build with bundle budgets
npm run e2e                     # Playwright against a mocked backend, no Docker (incl. parity and axe)
npm run e2e:parity              # only the parity test against the Mother's Day card
npx fallow audit                # dead code, duplication, complexity
```

- The integration tests only really run with Docker: the log then says "Found Docker environment", and no `*IT` is skipped (`Skipped: 0`). They never use your database.
- `mvnw test` and `package` write to `target/`; a running `spring-boot:run` restarts through devtools meanwhile.
- `npm run e2e` starts `ng serve` on port 4320 without watch and HMR (changes during a run apply only to the next one) and the snapshot of the Mother's Day card on 4321. The tests answer every API request themselves; no backend and no database are needed.
- `e2e/a11y.spec.ts` checks every page and dialog with axe (WCAG 2.0/2.1 A and AA); deliberate exceptions are listed there with their reason. The parity test compares the Mother's Day billet pixel by pixel with the live card (390×844 and 1280×800, light and dark, ≤ 1 %); it loads the card's fonts from Google Fonts and therefore needs the network.
- No test ever reaches your Ollama: every test context switches the assistant off, and the e2e specs answer `/v1/assist` themselves. Only the measurement `AssistEval` asks a real Ollama on purpose (see "Billet assistant").

### E2E tests against the real backend

The account flows (registration, autosave with a conflict, share link, import of a guest billet, deletion) run against the real backend and a throwaway database. Docker must be running.

```bash
cd billet-studio-frontend
npm run e2e:backend             # starts the e2e database and the tests
npm run e2e:down                # removes the e2e database again
```

- `e2e:backend` starts a MariaDB 10.11 on port 3307 via [docker-compose.e2e.yml](docker-compose.e2e.yml) (`db_billet_studio_e2e`, built from `sql/schema.sql` + seeds, data in RAM only), then the built backend JAR on port 8081 and `ng serve` on port 4320. Your development environment (4200, 8080, `db_billet_studio`) keeps running undisturbed and is never touched.
- The tests start the JAR from `billet-studio-rest-service/target`, not `spring-boot:run`. If it is older than the backend sources, the run stops with a hint; rebuild it then: `mvnw.cmd -DskipTests package` (otherwise `./mvnw`) in `billet-studio-rest-service`. A running `spring-boot:run` may restart through devtools meanwhile.
- The database stays between runs (each test registers its own account); `e2e:down` discards it. After a schema change run `e2e:down` first: the e2e database is built only at its start, from `schema.sql` and the seeds. The CommerceX e2e stack uses port 3307 too, so not both at the same time.
- Backend logs of the runs: `billet-studio-frontend/e2e/artifacts/backend/logs/`.

---

## Billet assistant (agentic UI)

"Beschreib dein Billet in einem Satz" (Describe your billet in one sentence) on the home page and in the template gallery: a chat that answers each message with a billet to start. You write, for example, "Eine Geburtstagskarte für meinen Bruder, eher schick als bunt, mit Sektflasche statt Torte, im Dunkelmodus und auf Englisch" (a birthday card for my brother, more elegant than colourful, with a champagne bottle instead of a cake, in dark mode and in English). The app answers with an offer – a picture of the look, what it starts with and "Billet anlegen" (Create billet). Every follow-up ("lieber hell" – rather light, "ohne Konfetti" – without confetti) changes the offer. If the model is not available, the template gallery works as always.

### How it works

- **The model writes no text and no UI.** It only answers a typed questionnaire: seven choice questions with fixed labels (template, theme, particles, divider, colour mode, language, 3D model). Every sentence the user sees comes from the i18n files; every billet is built by the regular start link `/billets/new?template=…&theme=…&model=…`.
- **The backend owns the questionnaire.** The browser sends only the chat (at most 10 entries); the backend builds the prompt, asks Ollama, checks that every answer is one of the offered labels and merges the labels into the next offer (`KEEP` keeps a value, `TEMPLATE_DEFAULT` follows the template, `NOT_SUPPORTED` keeps it and says so). The endpoint therefore is no open LLM proxy for guests.
- **The technique** is the questionnaire of Manfred Steyer's [jev-demo](https://github.com/manfredsteyer/jev-demo) (TypeSafe's Jev "System One" and its local stand-in for Ollama, `server/src/local-jev/`). billet-studio ports that stand-in to Java: Spring talks to Ollama itself, there is no Node service in between.
- **Measured prompt rules** (kept exactly as in the demo): the real question names as JSON keys, the questions before the state (so the unchanging part stays in Ollama's prompt cache), a short `reasoning` field first (max. 300 characters), a JSON schema with one `enum` per question, `temperature 0`, `num_ctx 12288`. Every option is described in English with the German words in parentheses, in one prompt for both UI languages.
- **Privacy:** the user's messages and the model's reasoning are never logged and never returned; only the labels leave the backend.
- Contract, labels, merge rules and how to add a theme or template: [docs/assist.md](docs/assist.md). Endpoints: [docs/api-contract.md](docs/api-contract.md), section "Billet assistant".

### 1. Install Ollama and the model

1. Install Ollama from https://ollama.com (Windows: the installer adds the Ollama app and the `ollama` command).
2. Pull the model once (about 9 GB; it needs a GPU with roughly 16 GB of VRAM to answer in about a second – on a smaller GPU try `qwen2.5:7b` and set `ASSIST_MODEL` accordingly):

   ```bash
   ollama pull qwen2.5:14b
   ollama list                     # shows qwen2.5:14b
   ```

### 2. Start Ollama

The backend talks to the Ollama **server** on http://127.0.0.1:11434. Start it one way only:

- **The Ollama app (Windows, recommended):** start "Ollama" from the start menu. The server runs in the background as long as the app runs (llama icon in the system tray, also when its window is closed). Quit it from the tray icon.
- **Or in a terminal:** `ollama serve` – the server runs until you press Ctrl+C. Only when the app is not running, or the port is already taken.

Check that it answers:

```bash
curl http://127.0.0.1:11434/api/version     # {"version":"…"}
ollama ps                                    # the models currently loaded into memory (empty right after the start)
```

Recommended setting: `OLLAMA_NUM_PARALLEL=1` (Windows: a user environment variable, then quit Ollama from the tray and start it again). The assistant answers one question at a time anyway, and the GPU works through requests one by one.

Leave the app's setting "Expose Ollama to the network" off: Ollama has no authentication, and only the backend on the same machine needs to reach it.

**What is "Claude Code" in the Ollama app?** The app's *Apps* page (also `ollama launch <name>` in a terminal, e.g. `ollama launch claude`) starts other tools – Claude Code, Codex, OpenCode, Cline, Copilot CLI, Qwen Code and more – so that they use an Ollama model instead of their own cloud model. billet-studio uses none of them: its backend calls the Ollama server's API directly. You don't need to choose anything there.

### 3. Switch the assistant on

In `.env.local` (repository root):

```properties
ASSIST_ENABLED=true
```

Restart the backend (`.env.local` is read only at startup). The defaults fit a local Ollama; override them in `.env.local` only if needed:

| Variable | Default | Meaning |
|---|---|---|
| `ASSIST_ENABLED` | `false` | `false`: the assistant does not appear at all |
| `ASSIST_URL` | `http://127.0.0.1:11434` | the Ollama server (keep it reachable from the backend only) |
| `ASSIST_MODEL` | `qwen2.5:14b` | the model to ask (pulled beforehand) |
| `ASSIST_KEEP_ALIVE` | `1h` | how long Ollama keeps the model in GPU memory after the last answer |
| `ASSIST_TIMEOUT` | `20s` | one answer; also the longest a question waits for a free slot (then 429) |
| `ASSIST_LOAD_TIMEOUT` | `120s` | how long a question waits for the model to load (the load itself goes on) |
| `ASSIST_WARM_UP` | `false` | `true`: load the model when the backend starts |
| `ASSIST_RATE_LIMIT` / `ASSIST_RATE_LIMIT_WINDOW` | `20` / `10m` | questions per client IP within the window |

None of these values is a secret. The variables `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` and `OLLAMA_MODEL` of the jev-demo are not used here.

### 4. Use it

Open http://localhost:4200 (the section below the hero) or http://localhost:4200/templates.

- **Before you type**, the box shows the assistant's state (`GET /v1/assist/status`, read-only, cached for 10 s): no box when it is switched off, "gerade nicht erreichbar" (not available right now) when Ollama does not answer or lacks the model, a note that the first answer takes longer when the model is not loaded yet.
- **The model goes into GPU memory only when someone clicks into the input field** (`POST /v1/assist/warm-up`), never on a page visit – so a visit to the home page does not occupy the GPU, e.g. while gaming. It stays loaded for `ASSIST_KEEP_ALIVE` after the last answer; `ollama stop qwen2.5:14b` frees the memory at once.
- Enter sends, Shift+Enter starts a new line. The examples below the field fill it in.
- A message without an answer stays in the chat with its reason and "Erneut versuchen" (Try again).

### Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| No assistant box | `ASSIST_ENABLED` is not `true`, or the backend was not restarted | set it in `.env.local`, restart the backend |
| "Der Assistent ist gerade nicht erreichbar" | Ollama does not run, or the model is missing (backend log: `Ollama does not have qwen2.5:14b`) | start Ollama, `ollama pull qwen2.5:14b`; the box asks again every 30 s and when you focus the field |
| The first answer takes long | the model is being loaded into GPU memory | wait, or set `ASSIST_WARM_UP=true` |
| "Zu viele Anfragen" (Too many requests) | another answer is still running, or the rate limit per IP | send again in a moment |
| Answers do not fit | the questionnaire's descriptions | measure (below) and adjust `assist/billet-questionnaire.json` |

### Measuring the answers

With Ollama running:

```bash
cd billet-studio-rest-service
mvnw.cmd test -Dtest=AssistEval     # ./mvnw elsewhere
```

`AssistEval` runs German and English sentences, follow-ups, unsupported wishes and off-topic messages through the real questionnaire, client and merge, and prints the Ollama version, the model digest, the hit rate per question and the latency. It is not part of `mvnw test` and skips itself when no Ollama answers. `ASSIST_EVAL_URL` and `ASSIST_EVAL_MODEL` override the defaults. The last result and what it changed: [docs/assist.md](docs/assist.md), "Measuring".

---

## Asset pipeline

3D models, their previews, `sql/seed_models.sql` and the fonts are made only by the scripts in [tools/asset-pipeline/](tools/asset-pipeline/README.md) – never copied or edited by hand. The pipeline only reads the source folders (`digital-card-template/`, `muttertag_threejs/`, font sources).

```bash
cd tools/asset-pipeline
npm install
npx playwright install chromium   # once, for the previews
npm run models                    # optimise GLBs → previews → seed_models.sql
npm run fonts                     # rebuild the fonts
```

- Output: `billet-studio-frontend/public/models/<slug>.v<n>.glb` and `public/models/previews/<slug>.v<n>.webp` (meshopt + WebP textures, max. 2048 px, ≤ 6 MB, flower bouquet ≤ 8 MB).
- When a model's content changes, `v<n>` goes up (the files are cached `immutable` for a year). Every catalog change also ships a dated migration with only the changed rows, so an existing database never needs the whole seed file.
- Slugs stay forever: billets refer to them.
- A new model from Blender: checklist in [tools/asset-pipeline/README.md](tools/asset-pipeline/README.md), section on adding a new Blender model.

---

## Hero

The home page plays a short 3D story: a Valentine's Day card opens, a beating heart pops out, a phone receives the link, the card glides into the display and becomes the real billet; then the phone cycles through the occasions. Contract between Blender and the runtime: [docs/hero-story.md](docs/hero-story.md); runtime: `billet-studio-frontend/src/app/features/home/hero-story/`.

Everything under `public/hero/` is made by scripts, with a content hash in the file name. Rebuild in this order (each step needs the previous ones; only what changed, and everything after it):

```bat
set B="C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P tools\blender\hero\build.py --
%B% --stage bake --render         & rem Blender: story, shadow bakes, check renders
%B% --stage export                & rem tools/blender/hero/export/hero-story.glb (committed)
cd tools\asset-pipeline
npm run hero:story                & rem optimise + verify → public/hero/story.<hash>.glb
npm run hero:story-check          & rem optional: in three.js against Blender's positions
npm run hero:capture              & rem print, display, lock and message textures
npm run hero:gifts                & rem light gifts
npm run hero:posters              & rem start and end posters from the runtime's canvas
```

- Every generating step ends with `hero:assets`, which rewrites the runtime's asset tables (`hero-assets.generated.ts`, `hero-home.generated.ts`).
- `hero:capture` and `hero:posters` start `ng serve` on port **4330** when nothing answers there, and stop only what they started themselves. `hero:posters` takes a running dev server with `HERO_APP_URL` (e.g. `set HERO_APP_URL=http://localhost:4200`).
- Details: [tools/blender/hero/README.md](tools/blender/hero/README.md) and [tools/asset-pipeline/README.md](tools/asset-pipeline/README.md).

---

## Serving the models from the backend

Today the Angular app ships the 3D models (`billet-studio-frontend/public/models/`: the GLBs and `previews/` with the WebP previews). `tbl_models` stores only relative paths (`models/<slug>.v<n>.glb`, `models/previews/<slug>.v<n>.webp`), and the backend turns them into the absolute URLs editor and `/b/:token` load, using `MODELS_BASE_URL`. Later the files live on the server next to the Spring Boot backend. Moving them means: copy the files, set two values – **no database change, no SQL**.

1. **Copy the files.** Copy the content of `billet-studio-frontend/public/models/` (all `*.glb` and the `previews/` folder) into a directory of its own on the server, e.g.:

   ```bash
   rsync -a billet-studio-frontend/public/models/ USER@HOST:/srv/billet-studio/models/
   ```

   Afterwards it holds e.g. `/srv/billet-studio/models/flower-bouquet.v1.glb` and `/srv/billet-studio/models/previews/flower-bouquet.v1.webp`.
2. **Set `MODELS_DIRECTORY`** in `.env.production` to exactly that directory, as an absolute path (a relative one depends on the backend's working directory):

   ```properties
   MODELS_DIRECTORY=/srv/billet-studio/models
   ```

3. **Set `MODELS_BASE_URL`** to `/files/` of the API host, with a trailing slash:

   ```properties
   MODELS_BASE_URL=https://api.example.com/files/
   ```

   `models/flower-bouquet.v1.glb` thus becomes `https://api.example.com/files/models/flower-bouquet.v1.glb`.
4. **Restart the backend and check:**

   ```bash
   # GET, print only the headers (curl -I sends HEAD; the backend allows only GET here)
   curl -s -D - -o /dev/null https://api.example.com/files/models/flower-bouquet.v1.glb
   curl -s https://api.example.com/v1/models      # fileUrl / previewUrl now point to /files/models/
   ```

   Expected: `200`, `Content-Type: model/gltf-binary`, `Cache-Control: max-age=31536000, public, immutable`. If every file answers `404`, the directory is wrong; the backend log then reports `app.models.directory … is not a directory` at startup.
5. **In the browser** open a billet with a 3D model (editor and `/b/:token`): the GLBs now come from the API host. The frontend does not need a new build for this.

What the backend does (`WebConfig`):

- It serves `GET /files/models/**` only while `MODELS_DIRECTORY` is set; empty (the default), the path answers `404`.
- Only `.glb` and `.webp` leave the directory, everything else is `404`; paths with `..` (also encoded) are refused with `400`. Still, only the model folder belongs there, never a parent directory.
- The files are public (no login) and cacheable `immutable` for a year: every content change of a model gets a new version in the file name (`.v1` → `.v2`, `version` in the asset pipeline's manifest), so a URL never changes its content.
- CORS applies to the same origins as the API (`CORS_ALLOWED_ORIGINS`): three.js loads the GLBs with `fetch` from the API host, which needs the `Access-Control-Allow-Origin` header. The previews are plain `<img>` and need none.

Back to serving through the Angular app: set `MODELS_BASE_URL` to the frontend URL again, empty `MODELS_DIRECTORY`, restart the backend.

`public/models/` stays in the repository after the move too: it is the asset pipeline's output, the source of every copy to the server, and the e2e tests and developer pages load from it.

**Try it locally** (optional): in `.env.local`

```properties
MODELS_DIRECTORY=../billet-studio-frontend/public/models
MODELS_BASE_URL=http://localhost:8080/files/
```

(relative to `billet-studio-rest-service/`, where `mvnw` runs), restart the backend – the models then come from port 8080.

### New or changed models

Export a model from Blender and run it through the pipeline: checklist and commands in [tools/asset-pipeline/README.md](tools/asset-pipeline/README.md), section on adding a new Blender model (GLB export with applied transforms, textures ≤ 2048 px, no Draco compression, credit in the copyright field, then `npm run models`).

While the backend serves the models, the order afterwards matters:

1. Copy the new files (`<slug>.v<n>.glb` and `previews/<slug>.v<n>.webp`) to `MODELS_DIRECTORY` – first, or the catalog points at a file that does not exist yet.
2. Then run the SQL file (new database: `sql/seed_models.sql`, existing one: the dated migration in `sql/migrations/`).
3. Old versions may stay; delete them only when no catalog row points at them anymore.

---

## Production: nginx

Notes for the nginx configuration in front of frontend and backend. `add_header` in a `location` block replaces **all** `add_header` of the `server` block – repeat the security headers (e.g. `X-Content-Type-Options`, `Referrer-Policy`) in such blocks or pull them in with `include`.

**Frontend host** (the built Angular app):

```nginx
# Models, while they ship with the app. The file names are versioned (.v<n>).
location ^~ /models/ {
    types { model/gltf-binary glb; image/webp webp; }
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    gzip off;
    # brotli off;   # only with the brotli module loaded
}

# The home page's 3D hero: every file name carries a content hash, a URL never changes its content.
location ^~ /hero/ {
    types { model/gltf-binary glb; image/webp webp; }
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    gzip off;
    # brotli off;   # only with the brotli module loaded
}

# Shared billets are private greetings: do not index them. The page also sets <meta name="robots">,
# but only crawlers that run JavaScript see it.
location ^~ /b/ {
    add_header X-Robots-Tag "noindex" always;
    try_files $uri /index.html;
}
```

**API host** (proxy to the backend): `/files/models/` needs no block of its own – the backend sets `Content-Type`, `Cache-Control` and CORS itself, nginx passes them through. The backend also sets `X-Robots-Tag: noindex` for `/v1/public/**`.

**No compression for `.glb` and `.webp`:** both are compressed already (WebP images and textures, meshopt geometry); gzip or brotli at runtime costs CPU and gains next to nothing. Limit `gzip_types` / `brotli_types` to text and add neither `model/gltf-binary`, `image/webp` nor `*`, e.g.:

```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript image/svg+xml;
```

**Billet assistant in production:** leave `ASSIST_ENABLED=false` unless a model server is part of the deployment, reachable from the backend only (Ollama has no authentication).

---

## Roadmap

Each phase is implemented, verified and then committed. What billet-studio promises (the hero's
"Deine Worte, mit einem Geschenk in 3D."), the phases ahead and the open decisions:
[docs/roadmap.md](docs/roadmap.md).

| Phase | Content | Status |
|---|---|---|
| **P0** Scaffold | Git repository, root files, `sql/`, backend skeleton (Maven wrapper, `pom.xml`, `application.yml`), Angular app (zoneless, Vitest, strict tsconfig) | done |
| **P1** Backend auth | Auth module ported from CommerceX and decoupled: registration, login, sessions, password reset, account deactivation (30 days), avatar, root admin, admin user management, mails | done |
| **P2** Catalog + billets | `tbl_models` catalog, billet CRUD with optimistic locking, publish/unpublish, guest import, public endpoint | done |
| **P3** Frontend foundation | Token/theme system with generator, own CSS components, auth port (interceptors, guards, stores), login/registration/account/admin, i18n DE/EN | done |
| **P4** Asset pipeline | Optimise GLBs (meshopt + WebP), render previews, generate `seed_models.sql`, merge fonts and store them locally as woff2 | done |
| **P5** Renderer | Billet document + migration, mini markup, palettes, particles, 3D scene, templates (Mother's Day 1:1, Valentine's Day, birthday, Christmas, wedding), public page `/b/:token`, parity test against the original | done |
| **P6** Editor (guest) | Editor with undo/redo, panels for content, design, spacing, 3D and particles, own pickers (colour, font, model, emoji), storage in the browser | done |
| **P7** Server storage | Autosave with conflict detection, billet list, import of guest billets, share dialog (publish, update, unpublish), e2e against the real backend (Docker Compose) | done |
| **P8** Hardening + docs | fallow audit, bundle budgets (three.js only in the lazy chunk), axe checks of every page and dialog (`e2e/a11y.spec.ts`), stable parallel e2e runs, security review, theme swatches in "Meine Billets" (`tbl_billets.theme`), toasts at the bottom and above dialogs, models optionally served by the backend (`MODELS_DIRECTORY`) with runbook, nginx notes, Blender export checklist, README/CLAUDE.md | done (Lighthouse open) |
| **Hero story** | 3D story in the home hero: Valentine's Day as the showcase, textures from the real renderer, card, phone and choreography in Blender Python (headless) with bakes and export, structure-preserving optimisation, light gifts, runtime with chapters, pause/replay, idle state with occasion changes and rotation, start/end posters from the canvas, reduced motion / data saver / no WebGL, LCP measurement, `e2e/home.spec.ts` | done |
| **Assistant** | A billet from one sentence: start params for `/billets/new` (A1), package `assist` with a Java port of the jev questionnaire and an Ollama client, status/warm-up/question endpoints (A2), chat on the home page and in the gallery with an offer widget (A3), docs (A4), measurement against Ollama (A5) | A1–A5 implemented (22/22 measured turns right) |
| **Phase 1** Assistant v2 | A finished billet from one sentence: text quality measured first (local models vs Claude), blueprints with text slots, text drafts from the sender's own facts, refining in the chat | planned |
| **Phase 2** Model factory | Own 3D library in one house style: parametric Blender families replace the Sketchfab models, metadata for search and the assistant, library UX for hundreds of models | planned |
| **Phase 3** Recipient + editor | Link preview, envelope moment, personalised 3D gifts, own photos, opening date, reply | planned |
| **Phase 4** Product readiness | Target group, freemium model, hosting and cost, legal, hero polish, Lighthouse | open |

---

## Git

Remote: `origin` = https://github.com/AndreasLesovsky/billet-studio, branch `main`. After each verified phase (tests and build green, your acceptance) a commit is made and pushed to `origin main` – never force-pushed, no other branches.
