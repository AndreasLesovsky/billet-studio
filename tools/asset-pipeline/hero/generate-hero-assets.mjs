// Writes the runtime asset table of the home page's 3D hero from the hero manifests
// (docs/hero-story.md, "Files"):
//   hero/hero-captures.json   textures (npm run hero:capture)
//   hero/hero-gifts.json      light gifts (npm run hero:gifts)
//   hero/hero-story.json      the optimised story GLB (npm run hero:story), optional:
//                             { "file": "hero/story.<hash8>.glb", "bytes": <number>, ... }
//   hero/hero-posters.json    the start and end posters (npm run hero:posters), optional
// Output, in billet-studio-frontend/src/app/features/home/hero-story/:
//   hero-assets.generated.ts  the whole table, imported only by the lazy hero chunk
//   hero-home.generated.ts    what the home page itself needs (story URL, posters, gift credits),
//                             so the texture table stays out of the home chunk
// Without hero-story.json the table says `story: null` and the home page shows the hero without 3D.
// Without hero-posters.json `posters` is null: the stage shows a placeholder until the 3D is drawn.
// Exit 1, writing nothing, when a manifest is incomplete (a template without its screens or gift,
// a language or colour mode missing) or names a file that is not in public/.
// Usage: npm run hero:assets (hero:capture, hero:gifts, hero:story and hero:posters run it at their end)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERO_DIR, "../../../billet-studio-frontend");
const PUBLIC_DIR = join(FRONTEND_DIR, "public");
const TEMPLATES_PATH = join(
  FRONTEND_DIR,
  "src/app/billet/templates/templates.ts",
);
const OUTPUT_DIR = join(FRONTEND_DIR, "src/app/features/home/hero-story");
const OUTPUT_PATH = join(OUTPUT_DIR, "hero-assets.generated.ts");
const HOME_OUTPUT_PATH = join(OUTPUT_DIR, "hero-home.generated.ts");
const CAPTURES_PATH = join(HERO_DIR, "hero-captures.json");
const GIFTS_PATH = join(HERO_DIR, "hero-gifts.json");
const STORY_PATH = join(HERO_DIR, "hero-story.json");
const POSTERS_PATH = join(HERO_DIR, "hero-posters.json");

const LANGS = ["de", "en"];
const MODES = ["light", "dark"];
/** The occasion the story tells; the print and the message exist for it only. */
const SHOWCASE = "valentinstag";
const STORY_FILE = /^hero\/story\.[0-9a-f]{8}\.glb$/;
/** The runtime's <img> declares this size (hero-story.ts). */
const POSTER_PX = 1024;

function templateIds() {
  const source = readFileSync(TEMPLATES_PATH, "utf8");
  const ids = /export const TEMPLATE_IDS = \[([^\]]*)\]/.exec(source)?.[1];
  if (!ids) throw new Error("TEMPLATE_IDS not found in templates.ts");
  return [...ids.matchAll(/'([a-z0-9-]+)'/g)].map(([, id]) => id);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Public URL of a file under public/, after checking that it is there. */
function publicUrl(file, errors, at) {
  if (typeof file !== "string" || !file.startsWith("hero/")) {
    errors.push(`${at}: file must be a path under public/hero/`);
    return "";
  }
  if (!existsSync(join(PUBLIC_DIR, file)))
    errors.push(`${at}: public/${file} does not exist`);
  return `/${file}`;
}

function texture(entry, errors, at) {
  return {
    url: publicUrl(entry.file, errors, at),
    cssWidth: entry.cssWidth,
    cssHeight: entry.cssHeight,
  };
}

function isRect(rect) {
  return (
    rect !== null &&
    typeof rect === "object" &&
    ["x", "y", "w", "h"].every((key) => Number.isFinite(rect[key])) &&
    rect.w > 0 &&
    rect.h > 0
  );
}

/** One texture per key; `pick` returns the entry for the key or reports it missing. */
function collectCaptures(entries, templates, errors) {
  const find = (kind, template, lang, mode) =>
    entries.find(
      (entry) =>
        entry.kind === kind &&
        entry.template === template &&
        entry.lang === lang &&
        entry.mode === mode,
    );
  const need = (kind, template, lang, mode) => {
    const at = `hero-captures.json ${kind} ${template ?? "-"} ${lang} ${mode}`;
    const entry = find(kind, template, lang, mode);
    if (!entry) errors.push(`${at}: missing`);
    return { entry, at };
  };
  const byLang = (build) =>
    Object.fromEntries(LANGS.map((lang) => [lang, build(lang)]));
  const byMode = (build) =>
    Object.fromEntries(MODES.map((mode) => [mode, build(mode)]));
  const plain = (kind, template, lang, mode) => {
    const { entry, at } = need(kind, template, lang, mode);
    return entry ? texture(entry, errors, at) : null;
  };

  const screens = Object.fromEntries(
    templates.map((template) => [
      template,
      byLang((lang) =>
        byMode((mode) => {
          const { entry, at } = need("screen", template, lang, mode);
          if (!entry) return null;
          if (!isRect(entry.sceneRect))
            errors.push(`${at}: sceneRect missing or invalid`);
          return { ...texture(entry, errors, at), sceneRect: entry.sceneRect };
        }),
      ),
    ]),
  );
  return {
    printFront: byLang((lang) => plain("print-front", SHOWCASE, lang, "light")),
    printInside: byLang((lang) =>
      plain("print-inside", SHOWCASE, lang, "light"),
    ),
    lock: byLang((lang) => byMode((mode) => plain("lock", null, lang, mode))),
    notification: byLang((lang) =>
      byMode((mode) => plain("notification", SHOWCASE, lang, mode)),
    ),
    screens,
  };
}

function collectGifts(gifts, templates, errors) {
  return Object.fromEntries(
    templates.map((template) => {
      const at = `hero-gifts.json ${template}`;
      const gift = gifts.find((entry) => entry.templateId === template);
      if (!gift) {
        errors.push(`${at}: missing`);
        return [template, null];
      }
      const { fitSize, yOffset, exposure } = gift.scene ?? {};
      if (
        ![fitSize, yOffset, exposure].every(Number.isFinite) ||
        fitSize <= 0 ||
        exposure <= 0
      )
        errors.push(
          `${at}: scene.fitSize, scene.yOffset and scene.exposure are required`,
        );
      if (typeof gift.credit !== "string" || !gift.credit.trim())
        errors.push(`${at}: credit missing`);
      return [
        template,
        {
          slug: gift.slug,
          url: publicUrl(gift.file, errors, at),
          bytes: gift.bytes,
          credit: gift.credit,
          fitSize,
          yOffset,
          exposure,
        },
      ];
    }),
  );
}

function collectStory(errors) {
  if (!existsSync(STORY_PATH)) return null;
  const story = readJson(STORY_PATH);
  const at = "hero-story.json";
  if (!STORY_FILE.test(story.file ?? ""))
    errors.push(`${at}: file must be hero/story.<hash8>.glb`);
  if (!(story.bytes > 0)) errors.push(`${at}: bytes must be a positive number`);
  return { url: publicUrl(story.file, errors, at), bytes: story.bytes };
}

/** The start poster per language, the end poster per language x mode; null without a capture. */
function collectPosters(errors) {
  if (!existsSync(POSTERS_PATH)) return null;
  const entries = readJson(POSTERS_PATH).entries ?? [];
  const url = (kind, lang, mode) => {
    const at = `hero-posters.json ${kind} ${lang} ${mode ?? "-"}`;
    const entry = entries.find(
      (candidate) =>
        candidate.kind === kind &&
        candidate.lang === lang &&
        (candidate.mode ?? null) === mode,
    );
    if (!entry) {
      errors.push(`${at}: missing`);
      return "";
    }
    if (entry.widthPx !== POSTER_PX || entry.heightPx !== POSTER_PX)
      errors.push(`${at}: must be ${POSTER_PX} x ${POSTER_PX} px`);
    return publicUrl(entry.file, errors, at);
  };
  return {
    start: Object.fromEntries(LANGS.map((lang) => [lang, url("start", lang, null)])),
    end: Object.fromEntries(
      LANGS.map((lang) => [
        lang,
        Object.fromEntries(MODES.map((mode) => [mode, url("end", lang, mode)])),
      ]),
    ),
  };
}

/** A TS literal of plain data: unquoted keys where they are identifiers, single-quoted strings. */
function literal(value, indent = "") {
  if (value === null) return "null";
  if (typeof value === "string")
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  const inner = `${indent}  `;
  const key = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`);
  const lines = Object.entries(value).map(
    ([name, entry]) => `${inner}${key(name)}: ${literal(entry, inner)},`,
  );
  return `{\n${lines.join("\n")}\n${indent}}`;
}

const HEADER = `// Generated by tools/asset-pipeline/hero/generate-hero-assets.mjs - do not edit
import type { TemplateId } from '../../../billet/templates/templates';

export type HeroLang = 'de' | 'en';
export type HeroMode = 'light' | 'dark';

/** Normalised to the 390x844 phone window, y from the top. */
export interface HeroRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface HeroTexture {
  readonly url: string;
  /** The captured element's CSS size (a screen: the 390x844 window). */
  readonly cssWidth: number;
  readonly cssHeight: number;
}

export interface HeroScreenTexture extends HeroTexture {
  /** The billet's 3D area on this screen. */
  readonly sceneRect: HeroRect;
}

/** A light gift and its catalog scene defaults (billet units). */
export interface HeroGiftAsset {
  readonly slug: string;
  readonly url: string;
  readonly bytes: number;
  readonly credit: string;
  readonly fitSize: number;
  readonly yOffset: number;
  readonly exposure: number;
}

export interface HeroStoryAsset {
  readonly url: string;
  readonly bytes: number;
}

type ByLang<T> = Readonly<Record<HeroLang, T>>;
type ByMode<T> = Readonly<Record<HeroMode, T>>;

export interface HeroAssets {
  /** null until the story GLB is built: the hero shows no 3D. */
  readonly story: HeroStoryAsset | null;
  readonly printFront: ByLang<HeroTexture>;
  readonly printInside: ByLang<HeroTexture>;
  readonly lock: ByLang<ByMode<HeroTexture>>;
  readonly notification: ByLang<ByMode<HeroTexture>>;
  readonly screens: Readonly<Record<TemplateId, ByLang<ByMode<HeroScreenTexture>>>>;
  readonly gifts: Readonly<Record<TemplateId, HeroGiftAsset>>;
}
`;

const HOME_HEADER = `// Generated by tools/asset-pipeline/hero/generate-hero-assets.mjs - do not edit
import type { TemplateId } from '../../../billet/templates/templates';
import type { HeroLang, HeroMode } from './hero-assets.generated';

/** The story's first frame and its idle pose, ${POSTER_PX} px square WebP with alpha. */
export interface HeroPosters {
  readonly start: Readonly<Record<HeroLang, string>>;
  readonly end: Readonly<Record<HeroLang, Readonly<Record<HeroMode, string>>>>;
}

/** What the home page needs before the lazy hero chunk loads (hero-assets.generated.ts has all). */
export interface HeroHome {
  /** The story GLB; null until it is built: the hero shows no 3D. */
  readonly storyUrl: string | null;
  /** null until they are captured: a placeholder stands in until the 3D is drawn. */
  readonly posters: HeroPosters | null;
  /** Each template's gift attribution (CC-BY), shown under the stage. */
  readonly credits: Readonly<Record<TemplateId, string>>;
}
`;

function main() {
  const templates = templateIds();
  const errors = [];
  const captures = collectCaptures(
    readJson(CAPTURES_PATH).entries,
    templates,
    errors,
  );
  const gifts = collectGifts(readJson(GIFTS_PATH).gifts, templates, errors);
  const story = collectStory(errors);
  const posters = collectPosters(errors);
  if (errors.length) {
    console.error(`Hero assets incomplete:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  const table = { story, ...captures, gifts };
  const home = {
    storyUrl: story ? story.url : null,
    posters,
    credits: Object.fromEntries(
      Object.entries(gifts).map(([id, gift]) => [id, gift.credit]),
    ),
  };
  writeFileSync(
    OUTPUT_PATH,
    `${HEADER}\nexport const HERO_ASSETS: HeroAssets = ${literal(table)};\n`,
  );
  writeFileSync(
    HOME_OUTPUT_PATH,
    `${HOME_HEADER}\nexport const HERO_HOME: HeroHome = ${literal(home)};\n`,
  );
  console.log(
    `Wrote ${OUTPUT_PATH}\n  and ${HOME_OUTPUT_PATH}\n  story: ${story ? story.url : "none (the hero shows no 3D)"}; ` +
      `posters: ${posters ? "start x 2, end x 4" : "none"}; ` +
      `${templates.length} templates with screens and gifts.`,
  );
}

main();
