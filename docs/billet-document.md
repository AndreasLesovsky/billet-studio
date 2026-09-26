# Billet document (schemaVersion 1)

The billet is ONE JSON document. The same shape lives in guest localStorage, in
`tbl_billets.document` / `published_document`, in every API payload that carries a billet, and in
the frontend editor's form model. Backend records (`app.billetstudio.billet.document.*`) and the
frontend type (`src/app/billet/billet-document.ts`) mirror this file 1:1.

Rules:
- Every field is always present with a concrete value (no `undefined`, no missing keys). `''`, `0`,
  `false`, `[]` are the empty values. Signal forms need this; the backend rejects missing fields.
- Unknown fields are dropped by the backend (Jackson read into records, written back normalized).
- The backend accepts only the current `schemaVersion` on write (`UNSUPPORTED_SCHEMA_VERSION`).
  Old documents are upgraded by the frontend's `migrateDocument()` before they are edited or sent.
- Text fields are plain text with a tiny inline markup: `*emphasis*`, `**strong**`, and `\n` line
  breaks (a blank line = paragraph gap inside a block). Never HTML; the renderer never uses
  innerHTML. Emoji are allowed everywhere.
- Colours are `#rrggbb` (lowercase written by the frontend; backend accepts either case).
- Text contains no control characters other than the `\n` line break: U+0000–U+001F (tab and
  carriage return included) and U+007F in any text field are a 400 `VALIDATION_ERROR`.
- Text must be well-formed UTF-16: an unpaired surrogate (half an emoji) is a 400 `VALIDATION_ERROR`.
  The frontend shortens text only at code-point/grapheme boundaries (`Array.from` / `Intl.Segmenter`),
  never with `String.slice` on UTF-16 units.
- Themes vs. site: the whole UI - the website and the editor's chrome - has ONE fixed design (site
  theme "studio", light + dark by system). A theme is a billet design preset and nothing else: it
  applies only to the billet, i.e. the editor's live preview and the published page. It flows into
  the billet through `theme` + the preset values it writes into `palette`, `typography` and
  `particles.colors`. The renderer only reads the concrete values, never the theme id, so a later
  change to a theme preset never alters an existing billet. The `rose` preset equals the original
  Mother's Day card exactly.
- Limits are enforced by both sides (backend = source of truth, frontend = `billet-limits.ts`).

## TypeScript shape

```ts
type HexColor = string;                       // ^#[0-9a-fA-F]{6}$
type SpaceStep = number;                      // integer index into BILLET_SPACE_SCALE, 0..18
type DividerStyle = 'diamond' | 'dot' | 'heart' | 'star' | 'line' | 'none';
type BlockType = 'paragraph' | 'heading' | 'card' | 'note' | 'divider';
type ParticleShape = 'petal' | 'snowflake' | 'leaf' | 'confetti' | 'heart';

interface BilletDocument {
  schemaVersion: 1;
  theme: string;                 // ^[a-z0-9-]{1,40}$ theme id (THEME_IDS), a billet design preset. It never
                                 // styles the editor; picking a theme (re)initialises palette, typography
                                 // and particles.colors from that theme's billet preset, which the user
                                 // may then customise. Unknown ids fall back to the default theme.
  title: string;                 // 1..120  internal name (lists); also tbl_billets.title
  pageTitle: string;             // 0..120  <title> of the public page ('' = use hero text)
  lang: 'de' | 'en';             // lang attribute of the public page
  colorMode: 'auto' | 'light' | 'dark';   // auto = follows the viewer's OS setting
  palette: {
    light: BilletPalette;
    dark: BilletPalette;
    darkLinked: boolean;         // editor derives `dark` from `light` while true (values are still stored)
  };
  typography: {
    title: FontRef;              // hero line 1
    titleAccent: FontRef;        // hero line 2 (size is relative to the title size)
    heading: FontRef;            // heading blocks
    body: FontRef;               // paragraphs, cards, notes
    signature: FontRef;          // signature name
    ui: FontRef;                 // hero label, hero sub, 3D hint, signature sub
    emphasis: 'inkSoft' | 'accent';   // colour of *emphasis* in body text
  };
  spacing: {                     // all SpaceStep
    gutter: SpaceStep;           // horizontal page padding
    heroTop: SpaceStep;
    heroBottom: SpaceStep;
    dividerGap: SpaceStep;       // above and below the divider under the 3D scene
    blockGap: SpaceStep;         // default space before each block (after the first)
    signatureGap: SpaceStep;     // space above the signature
    pageBottom: SpaceStep;
  };
  hero: {
    label: string;               // 0..80
    titleLine1: string;          // 0..60
    titleLine2: string;          // 0..60
    sub: string;                 // 0..120
  };
  scene: {
    enabled: boolean;
    modelSlug: string;           // ^[a-z0-9-]{1,60}$ (must exist in tbl_models when enabled)
    height: number;              // rem, 15..40, step 0.25
    fitSize: number;             // 0.5..3.0
    yOffset: number;             // -1.0..1.0
    exposure: number;            // 0.2..2.0
    cameraDistance: number;      // 1.5..6.0
    cameraHeight: number;        // -1.0..2.0
    autoRotate: boolean;
    autoRotateSpeed: number;     // 0..3
    hint: string;                // 0..120 ('' hides the hint)
    ariaLabel: string;           // 0..160
  };
  divider: { style: DividerStyle };
  blocks: BilletBlock[];         // 0..30
  signature: {
    name: string;                // 0..60
    sub: string;                 // 0..120
  };
  particles: {
    enabled: boolean;
    shape: ParticleShape;
    colors: HexColor[];          // 1..8
    density: number;             // integer 0..100 (50 = original Mother's Day amount)
    speed: number;               // 0.25..3 multiplier of the shape preset
    size: number;                // 0.5..2 multiplier of the shape preset
  };
}

interface BilletPalette {        // names map to the original card tokens in brackets
  accent: HexColor;              // [rose]        hero line 2, label, divider mark, signature, particles default
  accentSoft: HexColor;          // [rose-pale]   hero background
  border: HexColor;              // [rose-border] divider lines, card border
  background: HexColor;          // [cream]       page background
  ink: HexColor;                 // [ink]         main text
  inkSoft: HexColor;             // [ink-soft]    secondary text
  surface: HexColor;             // [white]       card background
}

interface FontRef {
  fontId: string;                // ^[a-z0-9-]{1,40}$, id from FONT_CATALOG (unknown ids fall back per role)
  weight: number;                // 100..900, multiple of 100
  italic: boolean;
  size: number;                  // 0.5..2.0 multiplier of the role's base size
}

interface BilletBlock {          // one shape for every type (signal-forms arrays need it)
  id: string;                    // ^[a-z0-9-]{1,40}$, client generated, unique in the document
  type: BlockType;
  text: string;                  // paragraph ≤ 2000, heading ≤ 160, card ≤ 1200, note ≤ 600, divider ''
  icon: string;                  // card only (≤ 16 chars, usually one emoji), else ''
  ariaLabel: string;             // card only (≤ 120), else ''
  dividerStyle: DividerStyle;    // divider only, else 'none'
  spaceAdjust: number;           // integer -6..6, added to spacing.blockGap (clamped to the scale)
}
```

`BILLET_SPACE_SCALE` (rem), index → value:
`0:0, 1:.25, 2:.5, 3:.75, 4:1, 5:1.25, 6:1.5, 7:1.75, 8:2, 9:2.25, 10:2.5, 11:3, 12:3.5, 13:4, 14:4.5, 15:5, 16:6, 17:7, 18:8`

Fixed design constants (not in the document): page max width 30rem, hero bottom fade 3.75rem,
card radius 1.125rem / padding 1.625rem, letter-spacings, uppercase label/sub/hint.

Role base sizes (at size 1.0, container-relative like the original `clamp(min, Ncqi, max)`):
title `clamp(4.5rem, 22cqi, 5.5rem)`, titleAccent `1em` of the title, heading
`clamp(1.625rem, 7cqi, 2rem)`, body `clamp(1.25rem, 5.5cqi, 1.5rem)` (card
`clamp(1.125rem, 5cqi, 1.3125rem)`, note `clamp(0.9375rem, 4cqi, 1.125rem)`), signature
`clamp(2.125rem, 10cqi, 2.75rem)`, ui label `0.625rem`, hero sub `0.8125rem`, hint `0.625rem`,
signature sub `0.6875rem`.

- Hero title lines (title, titleAccent) shrink to fit on one line (`FitText`, down to 0.6× of their
  size); a longer line then wraps between words, and one word wider than the page shrinks further.
  A title line never breaks inside a word.
- The 3D hint is drawn in full `inkSoft` (the original card: 50 % opacity, about 2.3:1), so it stays
  readable - a user decision. The hero label keeps the original's `accent` on `accentSoft` (the live
  card in light mode: 3.7:1) - also a user decision, accepted as decorative text.
- `scene.hint` is the author's text (the card's "pinch zum zoomen" still holds on touch). The mouse
  wheel is not in the document: a plain wheel scrolls the page past the scene, Ctrl/⌘ + wheel
  zooms, and the scene says so itself, once, in the site's language (CLAUDE.md section 12).
- Every billet page has an `h1`: with both title lines empty it is visually hidden and reads
  `pageTitle`, else `title`.

Density mapping: `count = round(density × 0.56)`, `inAirMax = round(count × 0.43)`,
`totalCap = count × 3` (50 → 28 / 12 / 84, the original).

## Reference document — the original Mother's Day card

Parity fixture: the LIVE card https://muttertag.andreas-web.dev (snapshot in
`billet-studio-frontend/e2e/fixtures/muttertag-original/index.html`; it differs from the local
`muttertag_threejs/index.html` only in `--rose-pale`, live `#fdf5f2` is canonical). The same document lives in
[`fixtures/muttertag.billet.json`](fixtures/muttertag.billet.json), which backend tests and the
Playwright parity test read directly — change both together. Its `·` separators are typed like
the card's `&nbsp;·&nbsp;`: a space and a no-break space (U+00A0, `\u00a0` below) on each side.

```json
{
  "schemaVersion": 1,
  "theme": "rose",
  "title": "Muttertag 2026 – Mama",
  "pageTitle": "Für Mama · Muttertag 2026",
  "lang": "de",
  "colorMode": "auto",
  "palette": {
    "light": { "accent": "#c8614a", "accentSoft": "#fdf5f2", "border": "#e8c4bb", "background": "#faf6f0", "ink": "#2a1f1a", "inkSoft": "#6b5148", "surface": "#ffffff" },
    "dark":  { "accent": "#c8614a", "accentSoft": "#261710", "border": "#5a3028", "background": "#1e1410", "ink": "#f0e8e4", "inkSoft": "#c4a090", "surface": "#231512" },
    "darkLinked": false
  },
  "typography": {
    "title":       { "fontId": "cormorant-garamond", "weight": 300, "italic": false, "size": 1 },
    "titleAccent": { "fontId": "cormorant-garamond", "weight": 300, "italic": true,  "size": 1 },
    "heading":     { "fontId": "cormorant-garamond", "weight": 400, "italic": false, "size": 1 },
    "body":        { "fontId": "cormorant-garamond", "weight": 400, "italic": false, "size": 1 },
    "signature":   { "fontId": "cormorant-garamond", "weight": 300, "italic": true,  "size": 1 },
    "ui":          { "fontId": "jost",               "weight": 300, "italic": false, "size": 1 },
    "emphasis": "inkSoft"
  },
  "spacing": { "gutter": 8, "heroTop": 14, "heroBottom": 13, "dividerGap": 9, "blockGap": 10, "signatureGap": 11, "pageBottom": 15 },
  "hero": { "label": "10. Mai 2026 \u00a0·\u00a0 Muttertag", "titleLine1": "Für", "titleLine2": "Mama", "sub": "von Andreas" },
  "scene": {
    "enabled": true, "modelSlug": "flower-bouquet", "height": 23.75,
    "fitSize": 1.6, "yOffset": -0.08, "exposure": 0.6, "cameraDistance": 2.8, "cameraHeight": 0.1,
    "autoRotate": true, "autoRotateSpeed": 0.45,
    "hint": "wischen zum drehen \u00a0·\u00a0 pinch zum zoomen", "ariaLabel": "3D Blumenstrauß, interaktiv drehbar"
  },
  "divider": { "style": "diamond" },
  "blocks": [
    { "id": "b1", "type": "paragraph", "text": "Du hast Dinge erlebt, bei denen andere längst aufgegeben hätten. Nicht jeder bringt diesen Löwencharakter 🦁 mit. Diese stille, unerschütterliche Kraft ist etwas, das ich tief *bewundere*.", "icon": "", "ariaLabel": "", "dividerStyle": "none", "spaceAdjust": 0 },
    { "id": "b2", "type": "paragraph", "text": "Ich schaue mir noch vieles von dir ab. Du weißt Dinge, die kein Buch lehrt und kein Kurs vermittelt. Ich bin froh, dass du meine Mama bist.", "icon": "", "ariaLabel": "", "dividerStyle": "none", "spaceAdjust": 0 },
    { "id": "b3", "type": "card", "text": "Sei es, wie man den perfekten Teig macht, ob **Nockerl** oder **Palatschinken**. Oder wie man mit Geld umgeht, ohne am Ende des Monats leer dazustehen.\n\nLehrplan: laufend. Danke für die Geduld.", "icon": "🌸", "ariaLabel": "Mit einem Schmunzler", "dividerStyle": "none", "spaceAdjust": 0 },
    { "id": "b4", "type": "note", "text": "🎶 Die Soundbar wolltest du schon lange. Bis heute warten, das wären nur sinnlose Tage ohne Soundbar gewesen.", "icon": "", "ariaLabel": "", "dividerStyle": "none", "spaceAdjust": -1 }
  ],
  "signature": { "name": "Andreas", "sub": "in Dankbarkeit & mit Liebe" },
  "particles": { "enabled": true, "shape": "petal", "colors": ["#e8927a", "#f0b9aa", "#d97060", "#c8614a", "#f5cdc0", "#eaaa96"], "density": 50, "speed": 1, "size": 1 }
}
```

Spacing check against the original: gutter 2rem (32px), hero padding 4.5rem/4rem (72/64px),
divider margin 2.25rem (36px), section gap 2.5rem (40px), card→note 2.25rem (36px, `spaceAdjust -1`),
note→signature 3rem (48px), page bottom 5rem (80px), scene 23.75rem (380px).
