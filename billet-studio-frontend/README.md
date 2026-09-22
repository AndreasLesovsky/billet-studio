# billet-studio-frontend

Angular 22 (zoneless, standalone) frontend of billet-studio. Unit tests run on Vitest via
`@angular/build:unit-test`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Dev server on `http://localhost:4200/` |
| `npm run build` | Production build into `dist/` (bundle budgets enforced) |
| `npm test -- --no-watch` | Single Vitest run (check the exit code) |
| `npm run format:html` | Prettier for all templates (`format:html:check` only checks) |

`prestart`/`prebuild`/`pretest` run `scripts/generate-version.mjs`, which writes the gitignored
`src/app/core/version.ts` from `package.json`.

## Runtime configuration

`public/env.js` sets `window.__env`; any field there overrides the local defaults in
`src/app/core/environments/environment.ts` (`apiUrl`, `frontendUrl`, `siteName`). The committed file
is an empty placeholder and must never contain secrets.
