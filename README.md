# billet-studio

> Web-Editor für digitale Billets – Angular 22 + Spring Boot 4 + MariaDB + three.js

billet-studio macht aus dem Muttertags-Billet (`muttertag_threejs`) einen Generator: Im Editor baust du Billets im selben Look – Hero, 3D-Modell, Divider, Absätze, Fun-Card, Note, Signatur und fallende Blütenblätter – mit eigenen Farben, Schriften, Abständen und Modellen.

- **Gast:** Billets werden im Browser gespeichert (localStorage).
- **Eingeloggt:** Billets liegen in der Datenbank, mit Autosave, Liste und Übernahme der Gast-Billets.
- **Teilen:** Eingeloggte User veröffentlichen ein Billet unter einem öffentlichen Link `/b/{shareToken}`. Der Link zeigt einen Snapshot; weiteres Bearbeiten ändert ihn erst beim nächsten Veröffentlichen.
- Oberfläche auf Deutsch und Englisch, ~16 Editor-Themes (hell/dunkel), Admin-Benutzerverwaltung.

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
│   └── src/app/
│       ├── core/                 Services, Interceptors, Guards, Stores, DTOs (core/models)
│       ├── features/             Seiten (auth, account, admin, editor, billet-list, public-billet …)
│       ├── shared/               wiederverwendbare Komponenten, Direktiven
│       ├── layout/               App-Shell, schlichtes Layout
│       └── billet/               Renderer (Editor-Vorschau und öffentliche Seite = dieselbe Ansicht)
├── billet-studio-rest-service/   Spring Boot, Paket app.billetstudio (auth, shared, catalog, billet)
├── sql/                          schema.sql, Seeds, später migrations/ – spielst du selbst ein
├── tools/asset-pipeline/         Skripte für GLBs, Vorschaubilder, Schriften, seed_models.sql
├── CLAUDE.md                     Entwicklungsstandards
├── README.md
└── .env.example                  Vorlage für .env.local / .env.production
```

---

## Voraussetzungen

- **Java 25** (JDK)
- **Node.js 26** (mit npm)
- **XAMPP** mit MariaDB (lokale Datenbank)
- **Docker** – optional, nur für die Backend-Integrationstests (Testcontainers startet eine Wegwerf-MariaDB) und die e2e-Tests mit echtem Backend

---

## Lokaler Start

### 1. Datenbank

Datenbank anlegen und `schema.sql` + Seeds einspielen – Schritt für Schritt in [sql/README.md](sql/README.md). Die Datenbank verwaltest du selbst; das Backend legt keine Tabellen an.

### 2. Konfiguration

```bash
cp .env.example .env.local
```

Werte in `.env.local` (Repo-Root, gitignored) anpassen. Lokal ist `MAIL_ENABLED=false`: Mails werden nicht verschickt, der Passwort-Reset-Link steht dann im Backend-Log.

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

Läuft auf http://localhost:4200.

### Tests und Build

```bash
# Backend (Unit + Integrationstests, Docker muss für die ITs laufen)
cd billet-studio-rest-service && ./mvnw test

# Frontend
cd billet-studio-frontend
npm test -- --no-watch          # Exit-Code prüfen, nicht nur "passed"
npm run build
npm run e2e                     # Playwright mit gemocktem Backend, ohne Docker
```

### E2E-Tests mit echtem Backend

Die Konto-Abläufe (Registrierung, Autosave mit Konflikt, Teilen-Link, Übernahme eines Gast-Billets, Löschen) laufen gegen das echte Backend und eine Wegwerf-Datenbank. Docker muss laufen.

```bash
cd billet-studio-frontend
npm run e2e:backend             # startet die e2e-Datenbank und die Tests
npm run e2e:down                # e2e-Datenbank wieder entfernen
```

- `e2e:backend` startet per [docker-compose.e2e.yml](docker-compose.e2e.yml) eine MariaDB 10.11 auf Port 3307 (`db_billet_studio_e2e`, aus `sql/schema.sql` + Seeds, Daten nur im RAM), dann das gebaute Backend-JAR auf Port 8081 und `ng serve` auf Port 4320. Deine Entwicklungsumgebung (4200, 8080, `db_billet_studio`) läuft ungestört weiter und wird nie angesprochen.
- Die Tests starten das JAR aus `billet-studio-rest-service/target`, nicht `spring-boot:run`. Ist es älter als die Backend-Quellen, bricht der Lauf mit einem Hinweis ab; dann neu bauen: `mvnw.cmd -DskipTests package` (sonst `./mvnw`) in `billet-studio-rest-service`. Ein laufendes `spring-boot:run` kann dabei per devtools neu starten.
- Die Datenbank bleibt zwischen den Läufen stehen (jeder Test registriert ein eigenes Konto), `e2e:down` verwirft sie. Port 3307 nutzt auch der CommerceX-e2e-Stack, also nicht beide gleichzeitig.
- Backend-Logs der Läufe: `billet-studio-frontend/e2e/artifacts/backend/logs/`.

---

## Roadmap

Jede Phase wird umgesetzt, geprüft und dann lokal committet.

| Phase | Inhalt |
|---|---|
| **P0** Scaffold | Git-Repo, Root-Dateien, `sql/`, Backend-Gerüst (Maven Wrapper, `pom.xml`, `application.yml`), Angular-App (zoneless, Vitest, strikte tsconfig) |
| **P1** Backend-Auth | Auth-Modul aus CommerceX portiert und entkoppelt: Registrierung, Login, Sessions, Passwort-Reset, Konto-Deaktivierung (30 Tage), Avatar, Root-Admin, Admin-Benutzerverwaltung, Mails |
| **P2** Katalog + Billets | `tbl_models`-Katalog, Billet-CRUD mit Optimistic Lock, Veröffentlichen/Zurückziehen, Gast-Import, öffentlicher Endpunkt |
| **P3** Frontend-Fundament | Token-/Theme-System mit Generator, eigene CSS-Komponenten, Auth-Port (Interceptors, Guards, Stores), Login/Registrierung/Konto/Admin, i18n DE/EN |
| **P4** Asset-Pipeline | GLBs optimieren (meshopt + WebP), Vorschaubilder rendern, `seed_models.sql` generieren, Schriften zusammenführen und lokal als woff2 ablegen |
| **P5** Renderer | Billet-Dokument + Migration, Mini-Markup, Paletten, Partikel, 3D-Szene, Vorlagen (Muttertag 1:1, Valentinstag, Geburtstag, Weihnachten, Hochzeit), öffentliche Seite `/b/:token`, Paritätstest gegen das Original |
| **P6** Editor (Gast) | Editor mit Undo/Redo, Panels für Inhalt, Design, Abstände, 3D und Partikel, eigene Picker (Farbe, Schrift, Modell, Emoji), Speicherung im Browser |
| **P7** Server-Speicherung | Autosave mit Konflikterkennung, Billet-Liste, Import der Gast-Billets, Teilen-Dialog (veröffentlichen, aktualisieren, zurückziehen) |
| **P8** Härtung + Doku | e2e-DB per Docker Compose, fallow-Audit, Bundle-Budgets, axe/Lighthouse, Runbooks (Modelle auf den Backend-Server umziehen, Blender-Export) |

---

## Git

Das Repo hat noch kein Remote. Commits entstehen lokal nach jeder geprüften Phase; gepusht wird erst, wenn ein Remote verknüpft ist.
