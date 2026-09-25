# billet-studio - Development Standards

This file holds the rules every phase follows. The phase roadmap is in `README.md`; database setup is
in `sql/README.md`.

billet-studio reuses the CommerceX stack (Angular 22 zoneless + Signal Forms, Spring Boot 4.0.7 /
Java 25, MariaDB) and ports its auth module. Most of these rules are inherited from
`C:/xampp/htdocs/Projekte_2026/commerce-x/CLAUDE.md`, minus multi-tenancy, Bootstrap and the shop,
plus the billet-specific sections (themes, renderer, three.js, database, asset pipeline, git).

## Table of Contents

1. [Project map](#1-project-map)
2. [Hard rules at a glance](#2-hard-rules-at-a-glance)
3. [Before implementing anything - check existing patterns first](#3-before-implementing-anything---check-existing-patterns-first)
4. [Angular reference](#4-angular-reference)
5. [TypeScript & Angular standards](#5-typescript--angular-standards)
6. [Naming: services, files and the word "model"](#6-naming-services-files-and-the-word-model)
7. [Form standards (Signal Forms)](#7-form-standards---mandatory-signal-forms)
8. [Icons](#8-icons)
9. [Theme & token system](#9-theme--token-system)
10. [Styling](#10-styling)
11. [Billet renderer rules](#11-billet-renderer-rules)
12. [three.js rules](#12-threejs-rules)
13. [Backend integration & error handling](#13-backend-integration--error-handling)
14. [Backend conventions (Spring Boot)](#14-backend-conventions-spring-boot)
15. [Database rules](#15-database-rules)
16. [Asset pipeline](#16-asset-pipeline)
17. [Internationalization (i18n)](#17-internationalization-i18n)
18. [Security](#18-security)
19. [Accessibility](#19-accessibility)
20. [UI conventions](#20-ui-conventions)
21. [Testing standards](#21-testing-standards)
22. [Self-review with fallow](#22-self-review-with-fallow)
23. [Performance](#23-performance)
24. [Code comments](#24-code-comments)
25. [Git](#25-git)
26. [Code quality checklist](#26-code-quality-checklist)

---

## 1. Project map

```
billet-studio/
├── billet-studio-frontend/        Angular 22, zoneless, Signal Forms, vitest
│   ├── src/app/core/              services (*-api.ts), interceptors, guards, stores, forms, utils,
│   │                              models (= API DTOs only)
│   ├── src/app/features/          routed pages (auth, account, admin, editor, billet-list, public-billet)
│   ├── src/app/shared/            reusable components / directives
│   ├── src/app/layout/            app-shell, bare layout
│   ├── src/app/billet/            the renderer: document, migration, markup, palette, view, particles, scene
│   ├── src/styles/                token + CSS component layer (the only place colors are applied)
│   ├── public/i18n/               de.json, en.json
│   ├── public/models/             optimized GLBs + WebP previews (pipeline output)
│   └── public/fonts/              woff2 fonts (pipeline output)
├── billet-studio-rest-service/    Spring Boot 4, package app.billetstudio: auth/, shared/, catalog/, billet/
├── sql/                           schema.sql, seed_*.sql, migrations/ - the USER runs them
├── tools/asset-pipeline/          own package.json; generates models, previews, fonts, seed_models.sql
├── CLAUDE.md  README.md  .env.example
```

Read-only sources outside the repo (never modify anything there):
`C:/xampp/htdocs/Projekte_2026/commerce-x` (origin of ported code),
`C:/xampp/htdocs/Projekte_2026/muttertag_threejs` (parity reference, bouquet GLB),
`C:/xampp/htdocs/Projekte_2026/digital-card-template` (GLB originals, CONFIG/palette references).

## 2. Hard rules at a glance

- The **user manages the database**. Deliver SQL files only; never connect to a database or execute
  SQL. Hibernate `ddl-auto` stays `none`. See [Database rules](#15-database-rules).
- **No Bootstrap** CSS or JS. Only the `bootstrap-icons` font.
- **Never `innerHTML`** (or any other HTML-string sink). Billet text goes through the inline-markup parser.
- **One `BilletView`** renders both the editor preview and the public page.
- **Editor UI tokens (`--ui-*`) and billet tokens (`--billet-*`) never mix.**
- **One live WebGL context**; three.js only in a lazy chunk.
- DE and EN i18n files always have identical keys.
- `npm test -- --no-watch` is judged by its **exit code**.
- Commit locally per verified phase; **no push** until the user links a remote.

---

## 3. Before implementing anything - check existing patterns first

Before creating any new component, directive, guard, interceptor, service method, controller
endpoint, dialog, picker or scheduled job:

1. **Grep/Glob this repo** for similar implementations. Grep for the RIGHT things to find every
   similarity. Examples:
   - New dialog → `shared/components/confirmation-modal` (native `<dialog>` pattern)
   - New custom form control → the `FormValueControl` pickers of the editor (color-picker, range-slider, font-picker)
   - New API service → `core/services/auth-api.ts`, `billet-api.ts`
   - New backend exception → the existing `ApiException` subclasses + `GlobalExceptionHandler`
   - New mail → `AuthMailService` + its Thymeleaf templates
   - New scheduled job → the account-deletion scheduler in `auth/`
2. **Nothing here yet? Look in commerce-x** - it is the origin of every ported part:
   `commerce-x/commercex-frontend/src/app/{core,features,shared,layout}`,
   `commerce-x/commercex-rest-service/src/main/java/app/commercex/{auth,shared}`,
   its tests under `src/test/java/app/commercex/auth/**`. Ported code keeps the commerce-x behaviour
   (race-condition fixes, lifecycle, response shapes) and loses only the shop/tenant coupling.
3. **Read the closest match in full** (not just one snippet).
4. **Copy the pattern strictly**: naming, file layout, method signature, response shape,
   signal-update style, transaction boundaries, dispose lifecycle.
5. **Deviate only with explicit justification**, and surface the deviation to the user.

Why: reinvented patterns reintroduce bugs the established one already solved (race conditions,
double state updates, lifecycle leaks). When the codebase has three dialogs with one lifecycle, the
fourth uses the same one.

---

## 4. Angular reference

Angular 22, **zoneless** (no zone.js), standalone components, no SSR.

- Style guide: https://angular.dev/style-guide
- Components: https://angular.dev/guide/components (inputs, outputs, content projection, styling)
- Templates & control flow: https://angular.dev/guide/templates, https://angular.dev/guide/templates/control-flow, https://angular.dev/guide/templates/defer
- Signals: https://angular.dev/guide/signals, [linkedSignal](https://angular.dev/guide/signals/linked-signal), [resource](https://angular.dev/guide/signals/resource)
- Dependency injection: https://angular.dev/guide/di, [injection context](https://angular.dev/guide/di/dependency-injection-context)
- RxJS interop: https://angular.dev/ecosystem/rxjs-interop
- HTTP: https://angular.dev/guide/http, [interceptors](https://angular.dev/guide/http/interceptors), [httpResource](https://angular.dev/guide/http/http-resource), [testing](https://angular.dev/guide/http/testing)
- Signal Forms: https://angular.dev/guide/forms/signals/overview
- Routing: https://angular.dev/guide/routing, [loading strategies](https://angular.dev/guide/routing/loading-strategies)
- Zoneless: https://angular.dev/guide/zoneless
- Testing: https://angular.dev/guide/testing
- Accessibility / Angular Aria: https://angular.dev/guide/aria/overview
- CDK Overlay: https://material.angular.dev/cdk/overlay/overview
- Security: https://angular.dev/best-practices/security
- Errors / diagnostics: https://angular.dev/errors, https://angular.dev/extended-diagnostics

---

## 5. TypeScript & Angular standards

You are an expert in TypeScript, Angular and scalable web applications. Write functional,
maintainable, performant and accessible code.

### TypeScript
- Strict type checking (strict tsconfig, strict templates)
- Prefer type inference when the type is obvious
- No `any`; use `unknown` when the type is uncertain

### Angular
- Standalone components only; do NOT set `standalone: true` (default)
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` - it is the zoneless default
- `input()` / `output()` / `model()` functions, never the decorators
- No `@HostBinding` / `@HostListener` - use the `host` object of `@Component` / `@Directive`
- Lazy-load every feature route
- `routerLink` in templates over click handlers that navigate
- `NgOptimizedImage` for static images (not for inline base64)
- Keep components small and single-purpose; prefer inline templates for small components
- External templates/styles use paths relative to the component TS file
- No `ngClass` / `ngStyle` - use `[class.x]` / `[style.x]` bindings

### Templates
- Native control flow (`@if`, `@for`, `@switch`, `@empty`). `@let` is allowed only where a template
  genuinely needs the same expression twice.
- No arrow functions in templates; no globals (`new Date()` etc.)
- Keep templates simple. Components are "dumb": logic needed elsewhere lives in services/utilities.
- The backend is the authority: limits, ownership and document validation live there. The editor and
  renderer are necessarily client-side, but every rule they enforce is re-validated by the backend.
- Never use `<br>` for spacing. It is allowed only where a line break is content: addresses, and
  line breaks a user typed into billet text (rendered from inline-markup break nodes).

### State management
- Signals for local state, `computed()` for derived state
- Pure, predictable state transformations; `set` / `update`, never `mutate`
- `linkedSignal` for state seeded from an input that the user may then edit
- `resource` / `httpResource` / `rxResource` for async reads bound to signals

#### Signal effect rules - CRITICAL
- ✅ `effect()` only for side effects (persistence, DOM, logging, analytics)
- ❌ **NEVER use `effect()` to set a signal from other signals** (signal A → signal B)
- ✅ Use `computed()` (or `linkedSignal`) for signal-to-signal derivation

```typescript
// ❌ FORBIDDEN
constructor() {
  effect(() => this.blockCount.set(this.model().blocks.length));
}

// ✅ CORRECT
readonly blockCount = computed(() => this.model().blocks.length);

// ✅ OK - side effect only
constructor() {
  effect(() => this.localStore.save(this.localId, this.model()));
}
```

### Dependency injection - `inject()` only
- ✅ `inject()` in field initializers (or the constructor body)
- ❌ No constructor parameter injection

```typescript
export class BilletList {
  private readonly billetApi = inject(BilletApi);
  private readonly router = inject(Router);
}
```

### Lifecycle - no lifecycle hooks
- ❌ No `ngOnInit`, `ngOnChanges`, `ngAfterViewInit`, `ngOnDestroy` etc.
- ✅ Initialization in field initializers / the constructor
- ✅ Cleanup via `inject(DestroyRef).onDestroy(...)` or `takeUntilDestroyed()`
- ✅ Code that needs the rendered DOM (three.js, the particle canvas, `ResizeObserver`,
  `IntersectionObserver`) runs in **`afterNextRender`** - the only sanctioned "after view" hook.

```typescript
export class BilletScene {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(async () => {
      const { createSceneRuntime } = await import('./scene-runtime');
      const runtime = await createSceneRuntime(this.host.nativeElement /* ... */);
      this.destroyRef.onDestroy(() => runtime.dispose());
    });
  }
}
```

### Services
- Single responsibility; `providedIn: 'root'` for singletons
- API services are `*-api.ts` and follow the error-handling architecture in section 13

### Formatting
- `.editorconfig` is the single source for whitespace (2 spaces; Java and SCSS 4; LF).
- Prettier (ported from commerce-x): `printWidth 100`, `singleQuote`, Angular HTML parser with
  `singleAttributePerLine`.

---

## 6. Naming: services, files and the word "model"

### No `.component` / `.service` suffixes
```
✅ auth-api.ts          (not auth.service.ts)
✅ local-billet-store.ts
✅ editor-history.ts
✅ account.ts           (component, not account.component.ts)
```

### "model" in a filename means exactly ONE thing
**`core/models/*.ts`** holds the API contract types, mirroring the backend records 1:1, one type per
file, camelCase file names (`loginRequestDto.ts`, `billetResponseDto.ts`, `deactivationReason.ts`). Nothing
else belongs in that folder, and **no file anywhere else may be named `*-model.ts`**. A form's
contract is `<component>-schema.ts` (section 7), and a form's writable state signal is always named
`model`.

A file that only holds shared types or pure helpers takes a plain descriptive name after its
subject (`billet-document.ts`, `scene-math.ts`, `palette.ts`), co-located with its one owner or in
`core/utils/` when several features share it.

### 3D models are "assets" in the frontend
Because "model" is already taken twice (DTOs and the form state), a 3D model is called an **asset**
in frontend file, component, service and class names: `asset-library`, `asset-picker`,
`asset-cache.ts`, `modelAssetDto.ts` (the catalog DTO). The backend, the REST paths and the database
keep "model" (`tbl_models`, `catalog/`, `/v1/models`, `model_slug`), and DTO / document fields mirror
the API as they are (`fileUrl`, `scene.modelSlug`) - they are contract, not file names.

---

## 7. Form standards - MANDATORY (Signal Forms)

ALL forms use **Signal Forms** (`@angular/forms/signals`). FORBIDDEN, never to appear:
`[formGroup]`, `formControlName`, `formGroupName`, `FormBuilder`, `FormGroup`, `FormControl`,
`ReactiveFormsModule`, the reactive `@angular/forms` import, `createFormUndo`, `.markAsPristine()`,
`form.pristine`. Simplest reference: `features/auth/login/`; the richest: `features/editor/`
(arrays, `applyEach`, `hidden()`).

### The core pattern (every form)
A form is a PAIR of a writable state signal and a field tree. Naming is fixed: the state is `model`,
the tree is `<entity>Form` (`loginForm`, `accountForm`, `billetForm`) - NEVER `form`, which shadows
the imported `form()` factory.
```typescript
readonly model = signal<LoginFormModel>({ ...EMPTY_MODEL });
readonly loginForm = form(this.model, loginSchema);
```
Templates bind `[formField]` inside a real `<form>`:
```html
<form (submit)="onSubmit($event)">
  <input type="email" id="email" [formField]="loginForm.email" />
  <app-field-error [field]="loginForm.email" />
</form>
```

### The form model is DERIVED from the request DTO (never hand-listed)
```typescript
type AccountFormModel = Required<Omit<AccountUpdateDto, 'preferredLanguage'>> & { preferredLanguage: string };
```
(a) numeric/enum `<select>` fields must be `string` because `[formField]` is strict; (b) DTO optionals
must be concrete in the model (empty = `''`, NEVER `undefined`). `<input type="number">` binds a
`Field<number>` directly. `onSubmit` maps model → DTO (`Number(m.select)`, `m.opt || undefined`).
The editor is the exception by design: its model IS the `BilletDocument`, the same shape stored in
localStorage and the database.

### Every form's contract lives in `<component>-schema.ts` - NO exceptions
Model type, empty value, schema and DTO mappers live in ONE file next to the component, named after
it: `login/login-schema.ts`, `editor/editor-schema.ts`. The component keeps two lines:
```typescript
readonly model = signal<LoginFormModel>({ ...EMPTY_MODEL });
readonly loginForm = form(this.model, loginSchema);
```
Empty value: `export const EMPTY_MODEL` when flat, `export function createXModel()` as soon as it
holds arrays or nested objects (a shared const would alias them across instances). Size is not a
criterion - a 3-line schema gets its own file too.

### Schema + validation (declared, not imperative)
- Whole-model schema: `export const xSchema = schema<XModel>((p) => {...})`, used as the root.
- Field group shared by two forms: `export function xSharedSchema(p: XPaths): void` with a
  hand-written `XPaths` interface of `SchemaPath<Leaf>`.
- A rule that reads COMPONENT state stays in the component, composed on top:
  `form(this.model, (p) => { apply(p, xSchema); disabled(p.x, { when: () => this.locked() }); })`.
- **EVERY rule carries its own message key, and no two rules of one field share one.** The template
  never names a key; `app-field-error` renders the message of the rule that broke. The error object
  is passed as translate params, so `{{maxLength}}`, `{{minLength}}`, `{{min}}`, `{{max}}` come from
  the rule. **Numeric bounds are never spelled out in a text.** A bound from component state is
  passed as a function (`max(p.x, () => this.limit(), …)`), never as a hand-written param.
  `core/forms/form-contract.spec.ts` enforces all of this with no baseline and no allow-list.
  Custom validators in `core/forms/signal-validators.ts` take `message` as a REQUIRED parameter.
- **Validator ORDER is part of the contract.** The field shows `errors()[0]`; reordering changes
  the message a user sees. Never reorder while moving code.
- **Reuse a text where it is already true, write a new one where it is missing.** A key shared
  across FIELDS is fine; a key shared across RULES of one field is a bug. Mechanical rules use the
  shared `FORMS.*` keys (`REQUIRED`, `MAX_LENGTH`, `MIN_LENGTH`, `MIN`, `MAX`). Validation keys live
  in a feature block (`AUTH.*`, `ACCOUNT.*`, `EDITOR.*`) or in `FORMS.*` - never at the root level.
- Built-ins, all `(path, [arg], { message, when? })`: `required, email, min, max, minLength,
  maxLength, pattern`. `message` is a translate KEY.
- Custom validators live ONLY in `core/forms/signal-validators.ts` (`nonBlank`, `passwordMatch`,
  a hex-color validator, …) - never inline a duplicate.
- Arrays: `applyEach(p.blocks, blockSchema)`. Conditional rule group: `applyWhen(...)`. Conditional
  field: `required(p.x, { when })`, `disabled(p.x, { when })`, `hidden(p.x, { when })`.
- Numeric bounds ONLY via `min()`/`max()` in the schema. NEVER native `min`/`max` attributes on a
  `[formField]` input (compile error); `step` is fine.

### Submit + guard
```html
<button type="submit" [disabled]="!accountForm().valid() || !canUndo()">   <!-- edit form -->
<button type="submit" [disabled]="!loginForm().valid()">                   <!-- simple form -->
```
Bind `!<form>().valid()`, NOT `invalid()` (`valid()` is false while pending OR invalid).
```typescript
async onSubmit(event?: Event): Promise<void> {
  event?.preventDefault();
  if (this.accountForm().invalid() || !this.canUndo()) {   // simple forms drop `!canUndo()`
    this.accountForm().markAsTouched();
    return;
  }
  // map model → DTO, call the *-api service
}
```

### Dirty / undo
- Ordinary forms: `createModelUndo(this.model)` from `core/forms/model-undo.ts` → `{ canUndo,
  saveSnapshot(), undo() }`. `canUndo` IS the dirty check; re-baseline with `saveSnapshot()` after
  loading and after a successful save that stays on the page.
- The editor: `features/editor/editor-history.ts` (undo/redo). Snapshots are the model's object
  references - NEVER `structuredClone`, or the focused textarea is re-created and loses focus.
  Keystrokes are grouped into one history step; Ctrl+Z / Ctrl+Y are intercepted.
- Input-driven prefill uses `linkedSignal`, never an `effect()` that writes the model.

### Error rendering - ONE convention, enforced by construction
- **The invalid border is the provider's job.** `provideSignalFormsConfig` in `app.config.ts`
  applies the class **`ui-invalid`** to every `[formField]` element while `touched() && invalid()`.
  NEVER bind `[class.ui-invalid]` in a template.
- **The message is `app-field-error`'s job.** Every bound field with a messaged rule pairs with
  `<app-field-error [field]="xForm.field" />`, which renders `errors()[0]` inside
  `.ui-field-error`, prefixed with `bi-exclamation-circle`.
- NEVER hand-write an error block: no `.ui-field-error` element outside that component, no
  `.errors()` read in a template. `form-contract.spec.ts` rejects both.
- Controls not bound via `[formField]` keep their own message channel; the guard knows them by name.

### Custom controls and reservations
- Custom inputs are typed `FormValueControl<T>` / `FormCheckboxControl` components bound with the
  same `[formField]` - no `ControlValueAccessor`. The editor's color-picker, range-slider,
  font-picker, asset-picker and emoji-picker are the references.
- `validateHttp` / `validateAsync` + `pending()` imply a per-field busy indicator, which breaks the
  loading contract (global spinner, section 13). Using them needs the user's explicit decision.

### Testing Signal Forms
Drive the `model` signal and assert via the field signals:
`model.update(m => ({ ...m, email: 'x' }))` then `expect(f.email().invalid()).toBe(true)`.
**MANDATORY:** for any component that loads async (a `resource()`, an awaited API call) AND renders
children, stub the template with `TestBed.overrideComponent(X, { set: { template: '<div></div>',
imports: [] } })`. `detach()` is NOT enough: when the resource settles the zoneless scheduler renders
the real template, a child throws against the logic-only mocks, and that unhandled async error fails
the run (exit 1) while every `it()` still passes.

---

## 8. Icons

- ✅ **ONLY** the Bootstrap Icons font: `<i class="bi bi-name" aria-hidden="true"></i>`
  (https://icons.getbootstrap.com/). Icon-only buttons carry an `aria-label`.
- ❌ **NEVER** inline SVG icons in templates.
- ❌ The `bootstrap` package itself (CSS and JS) is forbidden - no `btn`, `form-control`, `modal`,
  `dropdown` classes, no `data-bs-*` attributes. `bootstrap-icons` is the only Bootstrap dependency.
- Emojis inside billet content are document data (emoji-picker), not icons.

---

## 9. Theme & token system

Two token families that never touch each other:

| Family | Scope | Set by | Consumed by |
|---|---|---|---|
| `--ui-*` | the website (site theme) and, inside the editor, editor themes | `<html data-theme="studio" data-mode="light\|dark">` for the site; a `[appThemeScope]` element for an editor theme | the CSS component layer |
| `--billet-*` | one billet | inline style bindings on the billet root | `billet/` renderer styles only |

### The site: one fixed design ("Studio")
- **The website has exactly ONE design, the site theme `studio`**: clean white surfaces, one violet
  accent, Manrope headings, Inter for body and UI, in light and dark. Every page outside the editor
  renders in it: home, auth, account, admin, billet list, public pages, the app shell.
- `public/theme-boot.js` always sets `<html data-theme="studio">` and `data-mode` (stored choice,
  else `prefers-color-scheme`) before Angular starts - no flash, CSP-compatible (no inline script).
- **Never add a site theme switcher.** The header offers the colour mode only (`ColorModeMenu`:
  System / Hell / Dunkel). Nothing writes `data-theme` on `<html>` except `theme-boot.js`.
- `ColorModeService` (`core/theme/color-mode-service.ts`) owns the mode: `mode()`
  (`system | light | dark`), `resolvedMode()` (`light | dark`), `setMode(mode)`. It follows
  `prefers-color-scheme` live while the mode is `system`, follows other tabs via the `storage` event,
  persists `billet-studio.color-mode` (absent = system) and writes **only** `data-mode` on `<html>`.

### Editor themes: only inside the editor
- The 16 editor themes are **editor-only**. They apply through the `ThemeScope` directive
  (`[appThemeScope]="themeId"`, `shared/directives/theme-scope.ts`) on the editor root and on
  theme-picker cards - plus the dev ui-kit. Nothing else may ever render in an editor theme, and no
  editor theme is ever set on `<html>`. `theme-scope.spec.ts` enforces both (where a scope may be
  opened; nothing but `ThemeScope` writes `data-theme`).
- `ThemeScope` binds `data-theme` (unknown id → `DEFAULT_THEME`), `data-mode` (default: the site's
  `resolvedMode()`, override via `[themeMode]`) and the class `ui-theme-scope`, which re-applies
  background, text colour and body font from the scope's own tokens. The page around it stays Studio.
- An editor theme flows into a billet as a **starting preset**: `BilletDocument.theme` plus the
  palette / typography / particle colours it writes (docs/billet-document.md, "Themes vs. site").
  The renderer never reads the theme id.

### Source of truth
- `src/styles/themes/themes.json` holds the seeds of the site theme (`site`) and of the editor themes
  (`themes[]`). `scripts/generate-themes.mjs` derives every other `--ui-*` colour in OKLCH and writes
  `_themes.generated.scss`, `theme-registry.generated.ts` and `public/theme-boot.js`. **Never edit a
  `*.generated.*` file or `theme-boot.js` by hand**; change `themes.json` or the generator and re-run
  it. Workflow, selectors and APIs: "Design system reference" at the end of this file.
- Theme-independent scales (`--ui-space-*`, `--ui-text-*`, base radii, motion, weights) live in
  `_tokens.scss` on `:root`. A `:root` token must never reference a themed token: it would resolve
  in the site theme and leak Studio values into every editor-theme scope.
- **Every theme × mode, the site included, must pass the contrast spec** (WCAG AA for text and UI
  components), and every heading weight must be a face the font catalog ships. A new theme or seed
  change that fails either is not done - the generator refuses to write it.

### Where colors may appear
- Color values exist only in `themes.json` (site + editor themes) and in billet palettes (document
  data and templates). No hex/rgb/hsl literals in component SCSS or templates.
- The CSS component layer in `src/styles/` (`ui-btn`, `ui-field`, `ui-card`, `ui-tabs`, `ui-switch`,
  `ui-range`, `ui-dialog`, `ui-toast`, `ui-menu`, `ui-skeleton`, …) is the only place that applies
  `--ui-*` colors. Component classes are prefixed `ui-`.
- **Component SCSS is layout only**: grid, flex, sizing, positioning, spacing via `--ui-space-*`.
  No colors, backgrounds, borders or shadows there.

### Billet tokens (`--billet-*`)
- Set inline on the billet root from the document (`palette`, `typography`, `spacing`) - e.g.
  `[style.--billet-accent]`. They must **never reference `--ui-*`**, and nothing in `billet/` may
  depend on the site or editor theme: a billet looks the same in every editor theme and on the
  public page.
- The billet's light/dark follows the document's `colorMode` (and the preview toggle in the editor),
  never the site's or a scope's `data-mode`.

---

## 10. Styling

Order of preference:
1. The `ui-*` component classes from `src/styles/`
2. Global SCSS in `src/styles/` for anything app-wide
3. Component SCSS - layout/structure only
4. Modern CSS (grid, flex, custom properties, container queries, `color-mix()`, `light-dark()`)
5. Inline styles - avoid; the billet's `--billet-*` bindings are the sanctioned exception

- **rem only** - no `px` for sizes, spacing or font sizes (a `1px` hairline border is the exception).
- Breakpoints for the app chrome are defined once in `src/styles/` and reused; never ad-hoc widths.
  The billet renderer uses container queries instead (section 11).
- Dialogs are native `<dialog>` (`showModal()` gives focus trap, Esc and inertness). Popovers,
  dropdowns and menus use CDK Overlay. Toasts are our own `toast` component. Never hand-roll what
  these already give you.
- Motion: every animation and transition respects `prefers-reduced-motion`.

---

## 11. Billet renderer rules

The renderer lives in `src/app/billet/` (`billet-document.ts`, `migrate-document.ts`,
`text/inline-markup.ts`, `palette.ts`, `view/`, `particles/`, `scene/`, `templates/`).

### One view, WYSIWYG
- **One `BilletView`** is used by the editor preview AND the public page `/b/:token`. Never fork
  rendering for one of them; anything editor-specific stays outside `BilletView`.
- The billet root is `container-type: inline-size`. Sizes use **`cqi`** (and rem), **never `vw`/`vh`**,
  so the phone-width preview in the editor is exactly what a phone shows.
- The viewport meta has no `maximum-scale` / `user-scalable=no`.
- The public page waits for the billet's fonts before its reveal; it is `noindex`.
- Every billet page has one `h1`: the hero title, or - with both title lines empty - a visually
  hidden one reading `pageTitle || title` (a local `.sr-only`; the billet never uses site classes).
- The Muttertag reference document (`docs/fixtures/muttertag.billet.json`) must stay at visual parity
  with the live card (snapshot `e2e/fixtures/muttertag-original`; Playwright parity test, ≤ 1 % pixel
  difference at 390×844 and 1280×800, light and dark). Any renderer change re-runs it.
- Two deliberate deviations from the live card, both user decisions: the 3D hint is drawn in full
  `inkSoft` so it stays readable (the card's 50 % opacity is about 2.3:1); the hero label keeps the
  card's `accent` on `accentSoft` (3.7:1 in light mode), accepted as decorative text.

### Text: never `innerHTML`
- **NEVER** `innerHTML`, `[innerHTML]`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
  `DomSanitizer.bypassSecurityTrust*` - anywhere in the app, not only in `billet/`.
- User text goes through `src/app/billet/text/inline-markup.ts`: `*italic*`, `**bold**` and line
  breaks are parsed into nodes, and the template renders the nodes with `@for`. Anything else stays
  literal text.

### The document
- One JSON shape (`BilletDocument`) in localStorage, in the API and in the database.
- It carries `schemaVersion`. Every document that enters the frontend (localStorage, API, import,
  template) passes `migrateDocument()` first; the backend accepts only the current version
  (`UNSUPPORTED_SCHEMA_VERSION`).
- Changing the shape = bump `schemaVersion` + migration step + migration test + backend records /
  Jakarta validation / `BilletDocumentCodec` - in the same commit.
- **Blocks share one shape** (`id, type, text, icon, ariaLabel, dividerStyle, spaceAdjust`; `type`:
  `paragraph | heading | card | note | divider`). Signal Forms arrays need one element shape; fields a
  type does not use are `hidden()` in the schema. Never introduce per-type block shapes. Max 30 blocks.
- Spacing values are steps on the fixed scale `BILLET_SPACE_SCALE` in
  `src/app/billet/billet-document.ts`; the sliders move by step. A block's `spaceAdjust` is added to
  `spacing.blockGap` and clamped to the scale.
- Colors are hex values; dark palettes derive via OKLCH in `palette.ts`, which also reports contrast.

### Particles
- An absolutely positioned layer inside the billet - no scroll math, no `position: fixed`.
- Simulation is pure and separate from the component (unit-testable); motion uses delta time, so
  60 Hz and 120 Hz look the same.
- Settled petals are not redrawn every frame; the loop pauses when the billet is off-screen and is
  off entirely under `prefers-reduced-motion`.

---

## 12. three.js rules

- npm `three` only, loaded with a dynamic `import()` inside `afterNextRender`. three.js must never
  reach the initial bundle (bundle budget enforces it).
- **Exactly one live WebGL context.** The asset library and pickers show WebP previews, never extra
  canvases. Switching the model reuses the renderer.
- GLBs are meshopt-compressed with WebP textures: `GLTFLoader` + `MeshoptDecoder`. No Draco.
- `asset-cache.ts` keeps one load promise per URL (pattern: `window_three_prototype/js/viewer.js`,
  `preloadModel`) and evicts a failed promise so a retry reloads. Cached assets are shared: a scene
  clones what it mutates (`SkeletonUtils.clone` for skinned/animated assets), and disposing a scene
  must never break the next use of a cached asset.
- Render loop via `renderer.setAnimationLoop`; paused by `IntersectionObserver` when off-screen;
  sized by `ResizeObserver`; animated models run an `AnimationMixer` with delta time.
- Handle `webglcontextlost` (`preventDefault`, pause) and `webglcontextrestored` (rebuild what three
  cannot: environment/PMREM, render-on-demand state).
- DOM listeners are registered with an `AbortController` signal.
- **Dispose via `DestroyRef`**: stop the loop, disconnect observers, abort listeners, dispose
  controls, mixer, environment, materials/textures owned by the scene, and `renderer.dispose()`.
- The canvas has `touch-action: pan-y` so a phone keeps scrolling the page, and an `aria-label`
  from the document (`scene.ariaLabel`).

---

## 13. Backend integration & error handling

### Type safety
- DTOs in `core/models/` mirror the backend records exactly, as if generated from OpenAPI. Change
  both sides in the same commit.

### Error handling architecture - CRITICAL
Three layers handle errors and feedback globally. No manual loading flags or error toasts in
components.

**Backend:** `GlobalExceptionHandler` (extends `ResponseEntityExceptionHandler`) returns
`ApiError { errorCode, status, timestamp }` for everything, including framework errors (malformed
JSON = 400). Domain exceptions extend `ApiException`, which carries the HTTP status and the
UPPER_SNAKE `errorCode` (`MODULE_ERROR_TYPE`: `BILLET_NOT_FOUND`, `BILLET_LIMIT_REACHED`,
`BILLET_MODIFIED_ELSEWHERE`, `UNSUPPORTED_SCHEMA_VERSION`, `UNKNOWN_MODEL`).

**Frontend interceptors (registered in `app.config.ts`):**
- `errorInterceptor` catches every HTTP error, reads `errorCode`, calls
  `messageStore.addMessage('error', errorCode, status)` (red toast), handles 401 via
  `authApi.handleExpiredSession()`, then rethrows.
- `loadingInterceptor` owns the global spinner (after 250 ms, visible ≥ 400 ms); components read
  `isLoading`. **The interceptor owns the policy; callers never set a flag.** A request that must not
  spin (e.g. the editor's autosave, which shows its own save status) is excluded by a rule in the
  interceptor, never at the call site.
- `authTokenInterceptor`, `refreshTokenInterceptor`, `sessionCookieInterceptor` as ported.

**Interceptor DI deadlock rule - CRITICAL:** `errorInterceptor` injects `AuthApi`. Nothing `AuthApi`
injects (directly or transitively) may inject `LanguageService` or `TranslateService`:
`LanguageService` calls `TranslateService.use()` in its constructor, which fires an HTTP request
through the interceptor again → deadlock (no translations, endless spinner).

**API services (`*-api.ts`):**
- `try`: API call → signal state update → success toast via `messageStore.addMessage('success', …)`
- `catch`: `throw error` - the interceptor already showed the error toast; services never set error
  messages themselves.

**Components** `await` service calls. They `try/catch` only when they must react (revert UI, offer
"reload / keep mine" on a 409); otherwise the toast is already there.

**Adding an error code:** exception (extends `ApiException`) → handled by `GlobalExceptionHandler` →
`MESSAGES.ERROR.<CODE>` in `de.json` AND `en.json`.

**Message namespaces:** `MESSAGES.ERROR` (red), `MESSAGES.SUCCESS` (green), `MESSAGES.INFO` (blue),
`MESSAGES.WARNING` (yellow).

---

## 14. Backend conventions (Spring Boot)

- Package `app.billetstudio`: `auth/` (ported), `shared/` (ApiError, ApiException,
  GlobalExceptionHandler, SecureTokens, WebConfig, OpenApiConfig, grid), `catalog/` (tbl_models),
  `billet/`.
- Request/response DTOs are Java records with Jakarta validation. The billet document is parsed by
  `BilletDocumentCodec` (Jackson 3 `JsonMapper`): unknown fields are dropped, output is normalized
  (so "changed since publish" is a string compare).
- Parser limits (StreamReadConstraints: string 65 536 chars, depth 32, document = import cap) are set
  on the Boot JsonMapper by `shared/config/JacksonConfig` (it replaces Boot's `JsonMapper.Builder` and
  applies every customizer; in Jackson 3 a `JsonMapperBuilderCustomizer` cannot set them).
- Time is `Instant`, UTC (`hibernate.jdbc.time_zone = UTC`); entities stamp `created_at` /
  `updated_at` in `@PrePersist` / `@PreUpdate`. Schedulers run in UTC.
- Spring `@Transactional` (not `jakarta.transaction`); optimistic locking via `@Version`.
- Ownership: another user's billet answers **404**, never 403.
- Tokens (share tokens, reset tokens) come from `SecureTokens`; only hashes of secrets are stored.
- `@RateLimited` on create, import, publish and the public endpoint.
- Configuration comes from `application.yml` with `${ENV:default}` placeholders; every new variable
  is added to `.env.example` in the same commit.

---

## 15. Database rules

- **The user manages the database himself.** Claude delivers SQL files and NEVER connects to a
  database or executes SQL - no `mysql` CLI, no JDBC scripts, no phpMyAdmin automation, not even
  read-only queries. After delivering SQL, tell the user which files to run, in which order.
- Hibernate `ddl-auto` stays **`none`** in every profile.
- Fresh install: `sql/schema.sql` + `sql/seed_roles.sql` + `sql/seed_models.sql`.
- A schema change is a new file `sql/migrations/<YYYY-MM-DD>_<name>.sql` **and** the same change
  folded into `schema.sql`, in one commit.
- Target MariaDB 10.4 (XAMPP), stay MySQL 8.0.16+ compatible; mark anything MariaDB-only in the file
  header.
- InnoDB, `utf8mb4` / `utf8mb4_unicode_ci`. Constraint names are table-prefixed:
  `uk_<table>_…`, `idx_<table>_…`, `fk_<table>_…`, `chk_<table>_…` (MySQL scopes CHECK/FK names to
  the database).
- **Every `DATETIME` is UTC, written by the application.** No clock defaults (`CURRENT_TIMESTAMP`,
  `ON UPDATE …`); seeds use `UTC_TIMESTAMP()`. `DATETIME`, never `TIMESTAMP`.
- JSON is stored as `LONGTEXT` + `CHECK (JSON_VALID(...))`.
- Column `COMMENT`s explain semantics where the name does not (see `schema.sql`).
- Integration tests use a throwaway Testcontainers MariaDB (Docker), initialised from
  `sql/schema.sql` + seeds - never the user's database.

---

## 16. Asset pipeline

- GLBs, previews, fonts and `sql/seed_models.sql` are produced ONLY by the scripts in
  `tools/asset-pipeline/` (`optimize-models.mjs`, `render-previews.mjs`, `generate-seed-models.mjs`,
  `merge-fonts.mjs`). Never hand-copy or hand-edit files in `public/models/`, `public/fonts/`,
  `font-catalog.generated.ts`, `_fonts.generated.scss` or `seed_models.sql`.
- Sources are **read-only**: `digital-card-template/`, `muttertag_threejs/` (bouquet),
  `Basisrezept/fonts`, `commerce-x/.../public/fonts`. The pipeline reads from them and writes only
  into this repo.
- Output: `public/models/<slug>.v<n>.glb` + WebP preview; meshopt + WebP textures, max 2048 px;
  ≤ 6 MB per model (bouquet ≤ 8 MB). Changing a model's content bumps `v<n>` (cache busting) and
  regenerates the seed.
- `tbl_models` stores relative paths only; where the files are served from is
  `app.models.base-url` (`MODELS_BASE_URL`). Moving the files never needs SQL.
- Slugs are permanent (billet documents reference them). Credits come from the GLB's `asset.extras`.

---

## 17. Internationalization (i18n)

- ngx-translate, files `public/i18n/de.json` and `public/i18n/en.json`.
- Keys are UPPER_SNAKE_CASE, grouped by feature (`AUTH.*`, `EDITOR.*`, `MESSAGES.ERROR.*`, …) and
  matching backend error codes.
- **Both files MUST have exactly the same keys at every level**, and valid JSON at all times (one
  syntax error breaks every translation). After every edit, parse both files
  (`node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`); the key-parity spec must pass.
- New UI text is added to both files at once. No German (or English) UI text in code.
- German uses informal **"du"** throughout the product UI; admin screens and toasts stay neutral and
  concise without overusing it. English: professional and clear. No slang.
- Billet content (user text, template text) is document data - it is never passed through
  ngx-translate. The document's `lang` sets the billet root's `lang` attribute.

---

## 18. Security

### No account-state enumeration
Endpoints that take an email/identifier and can fail due to account state (login, forgot-password,
reset request, deactivate …) MUST answer identically for: user not found, wrong password, account
deactivated, scheduled for deletion, grace-period limbo. Same status (typically 401), same
`errorCode` (`INVALID_CREDENTIALS` / `UNAUTHORIZED`), same body. Never introduce codes like
`ACCOUNT_DELETED`, `ACCOUNT_DEACTIVATED`, `EMAIL_NOT_FOUND` there. Unknown emails still run a dummy
BCrypt compare (timing). Distinct codes are fine on already-authorized endpoints (an admin may get
`ACCOUNT_ALREADY_DEACTIVATED`). When in doubt, collapse to the generic failure and log the real
reason server-side only.

Accepted exception: register answers 409 `EMAIL_ALREADY_EXISTS` (sign-up UX), limited per IP via
`app.auth.register-rate-limit`.

### Backend security invariants (from the P1 review)
- With `ENFORCE_STRONG_SECRETS=true` the backend refuses to boot on any value that ships in the repo
  (`JwtUtil.IN_REPO_SECRETS`, `RootUserBootstrap.IN_REPO_PASSWORDS` / `IN_REPO_EMAIL`). Changing a
  placeholder in `application.yml` or `.env.example` means updating those sets in the same commit.
- Reset links/tokens are logged only when mail is disabled AND enforcement is off (dev). Never log a
  raw token anywhere else.
- Session expiry = min(idle, absolute_expires_at, created_at + the CURRENT role's absolute cap).
- `deletionScheduledAt != null` means self-deactivation (login within 30 days reactivates); an admin
  lock never has one. A plain admin edit of a self-deactivated account sends `deactivationReason: null`.
- URL-level denials answer `ApiError ACCESS_DENIED 403`; real-container behaviour is covered by
  `ServletContainerTest` because MockMvc never performs the `/error` forward.
- Image uploads: header-read size cap (100 MP), decoded-raster cap (16 MP), max 2 concurrent decodes;
  dwebp/avifdec run only after the header check.
- `docker info` is not a reliable Docker check on this machine; judge IT runs by Testcontainers'
  "Found Docker environment" log line and `Skipped: 0` on `*IT` classes.
- Every `@RequestBody` is capped before parsing by the handler-bound `shared/web/RequestBodyLimitAdvice`
  (default 16 KiB; `BilletController` 2 × max-document-bytes, import × 20) - never by a URL filter
  (URL filters see the undecoded path and are bypassable). Oversized bodies and parser-limit
  violations answer 400 `VALIDATION_ERROR`.
- `spring.mvc.formcontent.filter.enabled=false` must stay: `FormContentFilter` reads form-encoded
  PUT/PATCH/DELETE bodies unbounded, before authentication (pinned by `ServletContainerTest`).
- Rate-limit buckets are keyed by `ClientIp.rateLimitKey`: IPv4 address, IPv6 /64, IPv4-mapped IPv6 as
  IPv4; audit logs keep the full IP. Buckets that refilled are swept every 10 minutes.
- Every free-text field of the billet document carries `@NoControlCharacters` (only `
` allowed;
  tab, CR, other C0 and DEL are `VALIDATION_ERROR`). The editor strips `
` and turns tabs into spaces
  on input, and shortens text only at code-point/grapheme boundaries.
- The first publish of a billet takes a pessimistic row lock, so a billet only ever gets one share token.

### Application rules
- No HTML-string sinks (section 11). User content is text, always.
- Share tokens are 128-bit random (22 chars base64url); the public endpoint is rate-limited,
  `noindex`, ignores (never rejects) a stale bearer token, and returns only the published snapshot -
  only while the owner's account is active (lock/deactivation = the same 404 `BILLET_NOT_FOUND`;
  reactivation restores the link).
- Refresh cookie `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/v1/auth`. The access token lives in
  memory only.

### Secret files
These rules mirror the Read/Bash deny + allow patterns in `~/.claude/settings.json`; keep both in sync.

**NEVER read:** `.env` and every `.env.*` variant except those listed below (e.g. `.env.production`),
`**/secrets/**`, `*.pem`, `*.key`, `credentials*`, `**/.aws/**`, `**/.ssh/**`, `id_rsa*`,
`id_ed25519*`. This includes the commerce-x copies of these files.

**ALLOWED:** `.env.example`, `.env.template`, `.env.sample` (placeholders). `.env.local` may be read
with the Read tool to diagnose local configuration, but its values are never quoted, echoed,
summarised or written anywhere; `cat` / `Get-Content` stay banned for it.

**NEVER run:** `cat`, `type`, `grep`, `findstr`, `Get-Content`, `head`, `tail`, `sed`, `awk` on a
forbidden `.env*` file; `printenv`, `env`.

**If a secret appears in any output**, replace it with `[REDACTED]` in your answer, warn the user
where it leaked from, and never persist it (plans, summaries, commits) - not even partially.

When in doubt about a file, treat it as forbidden and ask.

---

## 19. Accessibility

- MUST pass all axe checks and WCAG 2.2 AA: focus management, contrast, ARIA, keyboard operation.
- **rem only**; the UI must survive 200 % zoom and text scaling.
- Every interaction works by keyboard: drag-and-drop block sorting has move up/down buttons; the
  color picker's saturation field and hue slider are arrow-key operable; dialogs return focus to
  their trigger.
- Visible focus via `--ui-focus-ring`; never `outline: none` without a replacement.
- Icon-only buttons have an `aria-label`; decorative icons are `aria-hidden="true"`.
- `prefers-reduced-motion` disables particles and non-essential motion.
- Every theme × mode passes the contrast spec (section 9); the billet palette tools warn on low contrast.

---

## 20. UI conventions

### Action buttons: disabled, not hidden
Action buttons (save, undo/redo, publish, row actions, toolbar actions, menu triggers) stay VISIBLE
and are `[disabled]` when not applicable. Never `@if`-hide an action based on entity state - a
vanishing button reads as "this feature is gone".
- ✅ `<button [disabled]="!canUndo()">`
- ❌ `@if (canUndo()) { <button> }`

Exception (inherited): when a state machine makes at most ONE of several terminal lifecycle actions
applicable, those may be hidden instead - decide it explicitly and state it in the PR/phase notes.
Conditional CONTENT (data blocks, optional cards) still uses `@if`; state-dependent input fields use
a collapse, not a permanently disabled empty field.

### Button variants
- `--primary`: the one main action of a view. `--secondary` (tonal accent): a real secondary action
  next to it. `--neutral` (grey outline, also the bare `ui-btn`): Cancel, pagination, undo,
  dismiss. `--ghost`: toolbar / row icons. `--danger`: the destructive confirm.
- **Disabled keeps the variant colour, muted** (a disabled primary still reads as the accent) - never
  a generic grey plane, and never by hand: `ui-btn` does it for every variant.

### Back-navigation: breadcrumb only
- The global `<app-breadcrumb />` in the app shell is the only back affordance: parent crumbs are
  links on desktop; on mobile it renders a back button to the parent crumb on the left.
- Every routed page sets `data: { breadcrumb: 'BREADCRUMB.KEY' }`; detail pages nest under their
  parent route. Dynamic crumbs (a billet title) set `breadcrumbDynamic: true` and their label via
  `BreadcrumbService.setDynamicLabel(...)`.
- NO page-level back buttons, anywhere.
- `returnUrl` (`core/utils/return-url.ts`) is reserved for flows reachable from several places - the
  login redirect (e.g. a guest clicking "Share").
- A form's Cancel action is a form action, not a back button, and stays.

### Loading
The global spinner is the default loading indicator. A local indicator exists only where the product
needs one by design (the editor's save status, model loading in the scene area), and its requests
are excluded in `loadingInterceptor` so the two never show at once.

---

## 21. Testing standards

**Every feature ships with tests in the same phase.** No "tests later".

**No unnecessary tests (user rule).** A test must guard behaviour that can realistically break and
would hurt: business rules, security/auth paths, state machines, data mapping, pure logic with edge
cases, regressions. Do NOT write tests that restate the code, re-test framework behaviour, cover
getters/DTOs/constants, duplicate a case another test already pins, or exist only to raise counts.
Prefer one well-chosen integration test over five mock-heavy unit tests of the same path. When in
doubt, leave it out and say so in the report.

**Databases in tests:** integration tests use Testcontainers MariaDB (Docker). The user's local
`db_billet_studio` is for running the app (manual smoke tests via the app's own API with clearly
named test accounts), never a test fixture and never touched with SQL.

### Frontend (Vitest)
- Spec next to the code: `foo.ts` → `foo.spec.ts`. Run `npm test -- --no-watch`
  (`npx ng test --no-watch`) after every step, not only at the end.
- **Verify the EXIT CODE, not the pass count.** An unhandled async error prints `Tests N passed`
  plus an `Errors` line and exits 1 - that run is RED. Confirm exit 0 and no
  `Errors` / `Unhandled` / `Uncaught` line.
- Use the shared mocks in `src/test-helpers.ts` (`createMockRouter`, `createMockAuthApi`,
  `createMockMessageStore`, `createMockActivatedRoute`, `translateTestingModule()`); extend them
  instead of inlining ad-hoc mocks. `TestBed` is zoneless by default in Angular 22 (no zone.js is
  installed), so specs add no `provideZonelessChangeDetection()`.
- Priority: pure functions (inline-markup, migrate-document, palette, spacing scale, particle
  simulation incl. 60 vs 120 Hz) → services with side effects (API, local store, save coordinator,
  history) → guards → interceptors (every branch) → component logic.
- Don't test template structure, "should create", visuals, or trivial passthroughs.
- One `describe` per file; test names are sentences
  (`'409 on autosave → offers reload and keep-mine'`).
- Bug fixes get a regression test that fails without the fix.
- Spec guards that must stay green: form contract, DE/EN key parity, theme contrast, font catalog.

### Backend (JUnit 5)
- Unit tests with Mockito; integration tests `*IT` with MockMvc + Testcontainers MariaDB (Docker).
- Run `mvnw.cmd test` (Windows) / `./mvnw test`; a phase is green only when the whole suite is.

### e2e (Playwright)
- Parity test (Muttertag template vs. original), guest flow, login/import/publish flow, session
  flows. Run output (`test-results/`, `playwright-report/`) is never committed.

### When to skip tests
CSS/theme-only changes (the contrast spec still runs), one-line typo or i18n fixes, pure markup
restructures without behaviour change.

---

## 22. Self-review with fallow

After implementing a feature and BEFORE reporting it done, run `npx fallow audit` in
`billet-studio-frontend/`. Fix what it reports **in the files you changed**:
- unused exports / dead code → remove (or wire back in)
- circular dependencies → break (`import type`, or move the shared type to a neutral module)
- duplication → extract once
- complexity hotspots → refactor your new code; leave pre-existing hotspots unless the fix is cheap

Ignore findings in files you did not touch. Skip for CSS/theme-only changes and one-line fixes.

---

## 23. Performance

- Zoneless: signals drive change detection; no `ChangeDetectorRef`, no explicit OnPush.
- Lazy-load every feature route; three.js lives only in the lazy scene chunk; bundle budgets in
  `angular.json` are gates, not suggestions.
- Tree-shakeable imports only.
- Fonts are local woff2 (latin + latin-ext subsets); a billet loads only the fonts its document uses.
- Models ≤ 6 MB (bouquet ≤ 8 MB); previews are small WebP thumbnails.
- Autosave: debounced (1.2 s after the last input, at most every 10 s), one request in flight,
  flushed on tab hide / leave.
- Render loops (three.js, particles) pause off-screen and never draw an unchanged frame on purpose.

---

## 24. Code comments

- Comment ONLY non-obvious couplings, complex decisions or mandatory directives ("never log this").
  No narration, no "explained to a child", no justification of why something is safe, no retelling
  of a discussion. Never document on a DTO/field what is enforced elsewhere.
  Test: does the sentence sit where the code makes it true? If not, move or delete it.
- **All comments in English.** No German comments and no German UI text in code (the UI is
  bilingual via i18n).
- Don't restate the code (`<!-- If logged in -->` above `@if (isLoggedIn())` is noise).

---

## 25. Git

- Local repository. **Commit after each verified phase** (tests/build green, user check done), plus
  follow-up fix commits as needed, e.g. `P1: port auth module`.
- **No `git push` and no `git remote add`** - the user links a remote himself; until then everything
  stays local.
- Never commit secrets or local state: `.env.local`, `.env.production`, uploads, logs and DB dumps
  are gitignored - keep it that way. `public/env.js` is tracked only as the empty local placeholder;
  it never holds real values in the repo.
- Never rewrite published phase commits (no force, no amend of an earlier phase).
- Line endings are fixed by `.gitattributes` (LF; `*.cmd`/`*.bat` CRLF; GLB/fonts/images binary).

---

## 26. Code quality checklist

Before a phase is committed:
- [ ] Derived state uses `computed()` / `linkedSignal`, never `effect()` writes
- [ ] No lifecycle hooks; DOM/three.js init only in `afterNextRender`, cleanup via `DestroyRef`
- [ ] All DI via `inject()`
- [ ] Native control flow; no `ngClass` / `ngStyle`; no explicit OnPush
- [ ] Forms follow section 7 (`model` + `<entity>Form`, `<component>-schema.ts`, `app-field-error`)
- [ ] No `innerHTML` or other HTML-string sinks
- [ ] No Bootstrap classes / `data-bs-*`; icons only via `bi` font
- [ ] No color literals outside `themes.json` / billet palettes; component SCSS layout-only; rem only
- [ ] `--billet-*` never references `--ui-*`
- [ ] DTOs match the backend records exactly; errors use the `errorCode` mapping
- [ ] New error codes / UI texts present in `de.json` AND `en.json`
- [ ] Strict TypeScript, no `any`
- [ ] axe clean; keyboard operable; reduced motion respected
- [ ] Tests added and green by exit code (frontend + backend); `npx fallow audit` clean for changed files
- [ ] Schema changes delivered as `sql/migrations/<date>_<name>.sql` + folded into `schema.sql`; no SQL executed
- [ ] New env variables documented in `.env.example`

---

## Design system reference

The `--ui-*` layer in one place. Live preview: the `UiKit` page (`features/dev/ui-kit`, route
`dev/ui`, dev builds only) - first every class in the site theme (Studio), then the theme picker and
a mini editor panel (card, input, badge, buttons) per editor theme, each inside its own `ThemeScope`.
Toggle light/dark with the header's colour-mode menu.

### Site theme and editor themes
- **Studio** (`site` in `themes.json`, id `studio`) is the ONE design of the website, on `<html>`.
  Inter for body and UI (400 text, 500 `--ui-font-weight-medium`, 600 `--ui-font-weight-strong`),
  Manrope for headings (600 for h3-h6 / card and dialog titles, 800 for h1/h2 / page titles / the
  wordmark; Manrope ships 200/400/600/800 - never 700). Light: white bg and surface, cool sunken
  plane, accent `#6246ea`. Dark: bg `#111016`, surface `#1a1920`, accent `#9d8cff` (AA as ink, so
  labels on it are dark).
- **Never add a site theme switcher**, and never render a site page in an editor theme. The header
  has the colour mode only.
- **Editor themes** (`themes[]`, 16 ids, `default` = `rose`) render only inside `[appThemeScope]`:
  the editor root, theme-picker cards, the dev ui-kit (`theme-scope.spec.ts` enforces it).

### Theme workflow
1. Edit seeds in `billet-studio-frontend/src/styles/themes/themes.json`: per theme `id`, `fontBody`,
   `fontHeading`, optional `headingWeight` (default 600), `displayWeight` (h1/h2, page titles,
   wordmark; default `headingWeight`), `headingScale` (default 1), `radius` (factor on the base
   radii), `shadowTint`; per `light` / `dark` only `bg`, `surface`, `text`, `accent`, optional
   `accent2` (decorative) and `sunken` (overrides the derived `--ui-surface-sunken`). Editor theme
   names are i18n keys `THEMES.<ID>`. The site id must differ from every editor id.
2. `npm run themes:gen` (also runs in prestart / prebuild / pretest) runs
   `scripts/generate-themes.mjs`. It derives every other token in OKLCH (contrast-driven searches CSS
   cannot do), checks WCAG AA for every pair the UI uses, checks every heading / display weight (and
   the site's body weights 400/500/600) against `billet/fonts/font-catalog.generated.ts`, and exits 1
   without writing when anything fails. It writes `src/styles/_themes.generated.scss`,
   `src/app/core/theme/theme-registry.generated.ts` and `public/theme-boot.js`.
3. `theme-contrast.spec.ts` re-checks the generated values of Studio and every editor theme, and
   that `theme-boot.js` sets only the site theme and reads only the colour-mode key.

Selectors: Studio is `[data-theme='studio']` / `[data-theme='studio'][data-mode='light|dark']`, with
`:root:not([data-theme])` fallbacks so a bare `<html>` still renders as the site. Editor themes are
`[data-theme='x']` (fonts, radii, weights) and `[data-theme='x'][data-mode='light|dark']` (colours,
shadows, `color-scheme`), never `:root`-only, so any element carrying both attributes renders in that
theme. `.ui-theme-scope` (`_base.scss`) re-applies `background-color`, `color` and `font-family` from
the scope's tokens; heading rules resolve their tokens on the heading itself, so they follow the
scope too. localStorage: `billet-studio.color-mode` only (absent = follow the system; a stale
`billet-studio.theme` key from earlier builds is ignored).

### Theme APIs (for the editor)
- `theme-registry.generated.ts`: `THEME_IDS` (the 16 editor ids, picker order), `ThemeId`,
  `ColorMode` (`'light' | 'dark'`), `DEFAULT_THEME` (`'rose'`), `SITE_THEME` (`'studio'`, not a
  `ThemeId`), `COLOR_MODE_STORAGE_KEY`, `THEMES: readonly ThemeMeta[]` (`id`, `nameKey`, `fontBody`,
  `fontHeading`, `swatch.light|dark` = final `bg surface text accent accent2`), `isThemeId(value)`,
  `ThemeColorTokens`; `THEME_COLOR_TOKENS` / `SITE_COLOR_TOKENS` are for the contrast spec only.
- `ColorModeService` (`core/theme/color-mode-service.ts`, root): `mode()`, `resolvedMode()`,
  `setMode(mode: ColorModeSetting)`; `ColorModeSetting = 'system' | ColorMode`. Writes only
  `<html data-mode>`; created at startup by `App`.
- `ThemeScope` (`shared/directives/theme-scope.ts`): `[appThemeScope]="themeId"` (required; unknown →
  `DEFAULT_THEME`), optional `[themeMode]` (default: `ColorModeService.resolvedMode()`). Host:
  `data-theme`, `data-mode`, class `ui-theme-scope`. Never set these attributes by hand.
- `ThemePicker` (`app-theme-picker`, `shared/components/theme-picker`): a
  `FormValueControl<string>` - `[formField]="billetForm.theme"` or standalone `[(value)]`; `disabled`
  input, `touch` output on focus-out, `focus()`. Native radio group (fieldset + legend
  `THEME_PICKER.LABEL`); each card is a `ThemeScope` in the site's resolved mode and shows the
  theme's swatches and name. An unknown value shows the default theme checked without writing back.
- `ColorModeMenu` (`app-color-mode-menu`): the header's icon button + CDK menu of
  `menuitemradio` items (i18n `COLOR_MODE.*`).
- Billet presets: every editor theme in `themes.json` carries a `billet` block (`light`/`dark`
  BilletPalette, six typography roles + `emphasis`, `particleColors`). The generator validates fonts
  against the catalog and five billet contrast rules (ink/background ≥ 4.5, ink/surface ≥ 4.5,
  inkSoft/background ≥ 4.5, accent/accentSoft ≥ 3, accent/background ≥ 3), requires every particle
  colour to reach 1.25:1 on the light AND on the dark background (rose exempt: it equals the live
  card) and writes
  `core/theme/billet-theme-presets.generated.ts`: `BilletThemePreset`, `BILLET_THEME_PRESETS`,
  `billetPresetFor(id)` (unknown → default). `rose` must equal `docs/fixtures/muttertag.billet.json`
  (the live card; `theme-contrast.spec.ts` pins it). `titleAccent.size` is relative to the final
  title size (1em of the hero h1).

### Icons (generated subset)
- `scripts/generate-icons.mjs` (`npm run icons:gen`; also prestart / prebuild / pretest) collects
  every `bi-<name>` in `src/**/*.{html,ts}` (specs excluded) plus the class names in
  `src/styles/icons/dynamic-icons.json` (only for names assembled at runtime), and writes
  `src/styles/_icons.generated.scss`: the `@font-face` (url() to the woff2 in
  `node_modules/bootstrap-icons`, bundled by the build with a hashed name), the base `.bi` rule and
  one `::before` rule per used icon, codepoints from `bootstrap-icons.json`. A name that does not
  exist fails the script. `bootstrap-icons.css` is never included.
- A new icon needs nothing but its literal class in a template or TS string; the next
  start / build / test regenerates the subset. Prefer literal names over string building.

### Tokens
| Group | Tokens |
|---|---|
| Surfaces | `--ui-bg`, `--ui-surface`, `--ui-surface-raised` (menus, dialogs, toasts), `--ui-surface-sunken` (hover, table head, disabled) |
| Text | `--ui-text`, `--ui-text-muted` (≥ 4.5:1, placeholders too), `--ui-text-subtle` (≥ 3:1, icons/decoration only, never text) |
| Lines | `--ui-border` (decorative hairline), `--ui-border-strong` (≥ 3:1, control boundaries) |
| Accent | `--ui-accent` (fills, ≥ 3:1 on bg), `--ui-accent-hover`, `--ui-accent-soft` (tinted bg), `--ui-on-accent` (label on accent), `--ui-accent-ink` (accent as text/icon, ≥ 4.5:1), `--ui-accent-tonal` / `--ui-accent-tonal-hover` (secondary-button fill), `--ui-on-accent-tonal` (accent ink, ≥ 4.5:1 on both tonal fills), `--ui-accent-2` (decorative), `--ui-focus-ring` |
| Status | `--ui-{danger,success,warning,info}` (fill), `-soft` (tinted bg), `-ink` (text/icon), `--ui-on-{status}` (label on the fill), `--ui-danger-hover` |
| Misc colour | `--ui-overlay` (dialog backdrop), `--ui-shadow-sm/md/lg` |
| Type | `--ui-font-body`, `--ui-font-heading`, `--ui-font-heading-weight` (h3-h6, card/dialog titles), `--ui-font-display-weight` (h1/h2, page titles, wordmark), `--ui-font-heading-scale`, `--ui-font-mono`, `--ui-font-weight-medium` (500: tabs, secondary labels), `--ui-font-weight-strong` (600: labels, buttons, badges), `--ui-text-xs/sm/md/lg/xl/2xl/3xl`, `--ui-leading-tight/normal` |
| Shape | `--ui-radius-sm/md/lg/xl` (per theme), `--ui-radius-pill` |
| Space | `--ui-space-1..12` = .25 .5 .75 1 1.25 1.5 2 2.5 3 4 5 6 rem |
| Motion | `--ui-duration-fast/base/slow` (0 under reduced motion), `--ui-ease` |
| Layout | `--ui-control-height`, `--ui-header-height`, `--ui-content-max`; breakpoints `sm 36 / md 48 / lg 64 / xl 80 rem` via `@use '…/styles/breakpoints' as bp; @include bp.up(md)` |

Pairing rule: text on a plane uses `--ui-text` / `--ui-text-muted`; accent-coloured text uses
`--ui-accent-ink`, never `--ui-accent`; text on a fill uses the matching `--ui-on-*`; status text
uses `-ink` on `-soft`.

### Component classes (`src/styles/components/`)
- **Layout:** `ui-container`, `ui-page` (+ `__header __title __lead`), `ui-stack` (+ `--sm --lg`),
  `ui-cluster`, `ui-grid` (column minimum via `--ui-grid-min`), `ui-visually-hidden`.
- **App:** `ui-app-header` (frosted when sticky), `ui-app-footer`, `ui-wordmark` (+ `__mark` accent
  tile with the billet icon, `__accent`), `ui-skip-link`.
- **Buttons:** `ui-btn` + `--primary` (accent fill) `| --secondary` (tonal: `--ui-accent-tonal`
  fill, `--ui-on-accent-tonal` label, no shadow) `| --neutral` (grey outline on the surface; the bare
  `ui-btn` looks the same) `| --ghost | --danger`, `--sm | --lg`, `--icon` (needs `aria-label`),
  `--block`. Disabled via `disabled` or `aria-disabled="true"`: each variant names
  `--_bg-disabled / --_fg-disabled / --_border-disabled` and one `:disabled` rule applies them -
  primary and danger mix their fill 50 % into the surface (label 90 % opaque), secondary a paler tonal
  fill with the ink mixed towards the surface, neutral a lighter border with a `--ui-text-subtle`
  label, ghost a subtle label. No shadow, `cursor: not-allowed`. A new variant sets all three.
- **Forms:** `ui-field` > `ui-label` + control + `ui-hint`; controls `ui-input`, `ui-textarea`,
  `ui-select`; `ui-invalid` / `aria-invalid="true"` set the danger border (never by hand, section 7);
  `ui-field-error` is rendered only by `app-field-error`. `ui-check` = label around a native
  checkbox/radio; `ui-switch` on `<input type="checkbox" role="switch">`; `ui-range` (fill via
  `[style.--ui-range-progress]="pct + '%'"`); `ui-segmented` > `ui-segmented__option` (label around a
  radio, or a button with `aria-pressed` / `aria-checked`).
- **Surfaces:** `ui-card` (+ `__header __title __body __footer`, `--interactive` for a stretched-link
  card whose link is `ui-card__link`), `ui-thumb` (+ `__emoji __img`, `--loaded`: a 3D model preview
  on a tinted plane, rendered only by `app-asset-thumb`; as a card's first child it is the card's
  full-bleed top), `ui-dialog` on a native `<dialog>` (+ `__header __title __body __footer`, `--lg`),
  `ui-menu` / `ui-menu__item` (+ `--danger`) / `ui-menu__check` (trailing tick of a checked
  `menuitemradio`) / `ui-menu__separator` / `ui-menu__label` and `ui-popover` for CDK overlay panels
  (`cdk.overlay()` is included globally), `ui-table-wrap` > `ui-table` (+ `__actions` cell).
- **Feedback:** `ui-alert` (+ `--info --success --warning --danger`, `__title`), `ui-badge`
  (+ `--accent --muted --success --warning --danger`), `ui-spinner` (+ `--sm --lg`, pair with a
  `role="status"` text), `ui-skeleton`, `ui-avatar` (+ `--sm --lg --xl`), `ui-toast-region` >
  `ui-toast` (+ variants, `__body`).
- **Navigation:** `ui-tabs` > `ui-tab` (`aria-selected` or `aria-current="page"`), `ui-breadcrumb`
  (the `<ol>` inside a labelled `<nav>`), `ui-link`.
- **Theme preview:** `ui-theme-option` / `__frame` / `__name` / `__check` (site theme) and
  `ui-theme-card` (+ `__bar __swatch --accent-2 --text __body __title __line __actions __button
  __chip`, rendered inside a `ThemeScope`), used by `app-theme-picker`. `ui-theme-scope` is set by
  `ThemeScope` only.

Use a class as-is; a missing variant is added to `src/styles/components/`, never as colour in
component SCSS.
