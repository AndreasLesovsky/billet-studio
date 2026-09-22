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
subject (`billet-document.ts`, `spacing-scale.ts`, `palette.ts`), co-located with its one owner or in
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
| `--ui-*` | the editor/app chrome | `<html data-theme="<id>" data-mode="light\|dark">` | the CSS component layer |
| `--billet-*` | one billet | inline style bindings on the billet root | `billet/` renderer styles only |

### Editor themes (`--ui-*`)
- Source of truth: `themes.json` (~16 themes, ~10 seed tokens each). `scripts/generate-themes.mjs`
  generates `_themes.generated.scss` (`[data-theme=x]` selectors with `light-dark()`) and
  `public/theme-boot.js`, which sets `data-theme` / `data-mode` before Angular starts (no flash,
  CSP-compatible - no inline script). **Never edit a `*.generated.*` file or `theme-boot.js` by
  hand**; change `themes.json` or the generator and re-run it.
- Derived tokens (`--ui-surface-raised`, `--ui-text-muted`, `--ui-border`, `--ui-accent-soft`,
  `--ui-on-accent`, `--ui-accent-ink`, `--ui-focus-ring`) are computed once in `_ui-base.scss` via
  `color-mix()`, together with the shared scales `--ui-space-*` and `--ui-radius-*`. Add a derived
  token there, never per component.
- `ThemeService` owns switching: validated theme IDs only, mode `system | light | dark`.
- The theme-picker cards set `data-theme` on themselves, so each card previews its own theme.
- **Every theme × mode must pass the contrast spec** (WCAG AA for text and UI components). A new
  theme or seed change that fails it is not done.

### Where colors may appear
- Color values exist only in `themes.json` (editor) and in billet palettes (document data and
  templates). No hex/rgb/hsl literals in component SCSS or templates.
- The CSS component layer in `src/styles/` (`ui-btn`, `ui-field`, `ui-card`, `ui-tabs`, `ui-switch`,
  `ui-range`, `ui-dialog`, `ui-toast`, `ui-menu`, `ui-skeleton`, …) is the only place that applies
  `--ui-*` colors. Component classes are prefixed `ui-`.
- **Component SCSS is layout only**: grid, flex, sizing, positioning, spacing via `--ui-space-*`.
  No colors, backgrounds, borders or shadows there.

### Billet tokens (`--billet-*`)
- Set inline on the billet root from the document (`palette`, `typography`, `spacing`) - e.g.
  `[style.--billet-accent]`. They must **never reference `--ui-*`**, and nothing in `billet/` may
  depend on the editor theme: a billet looks the same in every editor theme and on the public page.
- The billet's light/dark follows the document's `colorMode` (and the preview toggle in the editor),
  never the editor's `data-mode`.

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
`inline-markup.ts`, `palette.ts`, `spacing-scale.ts`, `view/`, `particles/`, `scene/`).

### One view, WYSIWYG
- **One `BilletView`** is used by the editor preview AND the public page `/b/:token`. Never fork
  rendering for one of them; anything editor-specific stays outside `BilletView`.
- The billet root is `container-type: inline-size`. Sizes use **`cqi`** (and rem), **never `vw`/`vh`**,
  so the phone-width preview in the editor is exactly what a phone shows.
- The viewport meta has no `maximum-scale` / `user-scalable=no`.
- The public page waits for the billet's fonts before its reveal; it is `noindex`.
- The Muttertag template must stay at visual parity with `muttertag_threejs/index.html` (Playwright
  parity test, ≤ 1 % pixel difference at 390×844 and 1280×800, light and dark). Any renderer change
  re-runs it.

### Text: never `innerHTML`
- **NEVER** `innerHTML`, `[innerHTML]`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
  `DomSanitizer.bypassSecurityTrust*` - anywhere in the app, not only in `billet/`.
- User text goes through `inline-markup.ts`: `*italic*`, `**bold**` and line breaks are parsed into
  nodes, and the template renders the nodes with `@for`. Anything else stays literal text.

### The document
- One JSON shape (`BilletDocument`) in localStorage, in the API and in the database.
- It carries `schemaVersion`. Every document that enters the frontend (localStorage, API, import,
  template) passes `migrateDocument()` first; the backend accepts only the current version
  (`UNSUPPORTED_SCHEMA_VERSION`).
- Changing the shape = bump `schemaVersion` + migration step + migration test + backend records /
  Jakarta validation / `BilletDocumentCodec` - in the same commit.
- **Blocks share one shape** (`id, type, text, icon, ariaLabel, dividerStyle, spaceBefore`; `type`:
  `paragraph | heading | card | note | divider`). Signal Forms arrays need one element shape; fields a
  type does not use are `hidden()` in the schema. Never introduce per-type block shapes. Max 30 blocks.
- Spacing values are steps on the fixed scale in `spacing-scale.ts`; the sliders move by step.
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
  (so "changed since publish" is a string compare), `StreamReadConstraints` cap body size.
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

### Application rules
- No HTML-string sinks (section 11). User content is text, always.
- Share tokens are 128-bit random (22 chars base64url); the public endpoint is rate-limited and
  returns only the published snapshot.
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
