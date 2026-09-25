import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The structural guard for the form contract (CLAUDE.md section 7): a validation message belongs to
 * the RULE that failed, and its rendering belongs to app-field-error.
 *
 * Read the sources, fail on the construct itself, so nobody has to remember. No baseline and no
 * allow-list: a new violation is fixed in the form, never recorded here.
 */

const APP = join('src', 'app');
const I18N = join('public', 'i18n');

/** Validators whose call sites this guard reads. Mirrors signal-validators.ts + the built-ins. */
const VALIDATORS = [
  'required',
  'email',
  'minLength',
  'maxLength',
  'min',
  'max',
  'pattern',
  'validate',
  'nonBlank',
  'passwordMatch',
  'maxUtf8Bytes',
] as const;

/** Rules whose message may carry the bound as a placeholder, and the placeholder that belongs to it. */
const BOUND_PLACEHOLDER: Record<string, string> = {
  maxLength: 'maxLength',
  minLength: 'minLength',
  min: 'min',
  max: 'max',
};

const I18N_KEY = /^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)*$/;

/** The one component that renders validation messages; it may read errors() and own the class. */
const FIELD_ERROR_DIR = /[\\/]field-error[\\/]/;

interface Rule {
  file: string;
  scope: string;
  field: string;
  validator: string;
  keys: string[];
  /** The literal bound, when the rule has one and it is not a LogicFn or a constant. */
  bound: number | null;
  /** Whether the rule has a bound argument at all (literal, constant or function). */
  bounded: boolean;
  /** How many distinct `{ kind: ... }` failures a hand-written validate() can return. */
  branches: number;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const FILES = walk(APP);
const read = (f: string) => readFileSync(f, 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const dirOf = (f: string) => f.slice(0, Math.max(f.lastIndexOf('/'), f.lastIndexOf('\\')));

/** Text from `from` up to the paren that closes the one at `from`. */
function callBody(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(from + 1, i);
  }
  return '';
}

/** Splits a call body on top-level commas, so a callback argument stays in one piece. */
function topLevelArgs(body: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      args.push(body.slice(start, i));
      start = i + 1;
    }
  }
  args.push(body.slice(start));
  return args.map((a) => a.trim());
}

function rulesOf(file: string): Rule[] {
  const src = stripComments(read(file));
  const rules: Rule[] = [];
  // Attribute each call to the declaration it sits in, so two sub-schemas in one file with the same
  // field name are told apart.
  const scopes = [...src.matchAll(/(?:export\s+)?(?:const|function)\s+(\w+)/g)].map((m) => ({
    at: m.index ?? 0,
    name: m[1],
  }));
  const scopeAt = (i: number) => [...scopes].reverse().find((s) => s.at < i)?.name ?? '(top)';

  for (const validator of VALIDATORS) {
    const call = new RegExp(`(^|[^\\w.])${validator}\\s*\\(`, 'g');
    for (const m of src.matchAll(call)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const body = callBody(src, open);
      const args = topLevelArgs(body);
      const path = args[0]?.match(/^[a-zA-Z_$][\w$]*\.([\w.[\]]+)/)?.[1];
      if (!path) continue;
      const keys = [...body.matchAll(/'([^']+)'/g)]
        .map((k) => k[1])
        .filter((k) => I18N_KEY.test(k));
      const boundArg = args[1] ?? '';
      const bounded = validator in BOUND_PLACEHOLDER;
      rules.push({
        file,
        scope: scopeAt(m.index ?? 0),
        field: path,
        validator,
        keys: [...new Set(keys)],
        bound: bounded && /^-?\d+(\.\d+)?$/.test(boundArg) ? Number(boundArg) : null,
        bounded,
        branches: (body.match(/\{\s*kind\s*:/g) ?? []).length,
      });
    }
  }
  return rules;
}

/** Condition and body of every `@if` that asks a field whether it is invalid. */
function errorBlocks(file: string): { condition: string; body: string }[] {
  const src = read(file);
  const blocks: { condition: string; body: string }[] = [];
  for (const m of src.matchAll(/@if\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const condition = callBody(src, open);
    if (!/\.invalid\(\)/.test(condition)) continue;
    const braceStart = src.indexOf('{', open + condition.length);
    if (braceStart < 0) continue;
    let depth = 0;
    for (let i = braceStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        blocks.push({ condition, body: src.slice(braceStart + 1, i) });
        break;
      }
    }
  }
  return blocks;
}

function flatten(obj: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.set(key, String(v));
  }
  return out;
}

/**
 * Inline templates count as templates: a small component keeps its template in the .ts file, and a
 * hand-written error block there is the same bug as in an .html file.
 */
function templateOf(file: string): string {
  if (file.endsWith('.html')) return read(file);
  const src = read(file);
  return [...src.matchAll(/template:\s*`([\s\S]*?)`/g)].map((m) => m[1]).join('\n');
}

// ALL non-spec ts files, not just *-schema.ts: a component may compose rules on top of its schema,
// and a rule the guard cannot see is a rule without a message.
const RULE_SOURCES = FILES.filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const TEMPLATES = FILES.filter(
  (f) =>
    f.endsWith('.html') ||
    (f.endsWith('.ts') && !f.endsWith('.spec.ts') && /template:\s*`/.test(read(f))),
);
const RULES = RULE_SOURCES.flatMap(rulesOf);
const DE = flatten(JSON.parse(readFileSync(join(I18N, 'de.json'), 'utf8')));
const EN = flatten(JSON.parse(readFileSync(join(I18N, 'en.json'), 'utf8')));

const id = (r: Rule, note: string) => `${r.file}::${r.scope}.${r.field}::${note}`;

interface RuleText {
  key: string;
  lang: 'de' | 'en';
  text: string;
}

/** Every translated text a rule's keys resolve to, in both languages, flat. */
function textsOf(r: Rule): RuleText[] {
  return r.keys.flatMap((key) =>
    (
      [
        ['de', DE],
        ['en', EN],
      ] as const
    ).flatMap(([lang, dict]) => (dict.has(key) ? [{ key, lang, text: dict.get(key)! }] : [])),
  );
}

function byField(): Map<string, Rule[]> {
  const grouped = new Map<string, Rule[]>();
  for (const r of RULES) {
    const k = `${r.file}::${r.scope}.${r.field}`;
    grouped.set(k, [...(grouped.get(k) ?? []), r]);
  }
  return grouped;
}

describe('the form contract', () => {
  it('no two rules of one field share a message key', () => {
    const violations: string[] = [];
    for (const [field, rules] of byField()) {
      const owners = new Map<string, string[]>();
      for (const r of rules) {
        for (const key of r.keys) owners.set(key, [...(owners.get(key) ?? []), r.validator]);
      }
      for (const [key, vs] of owners) {
        if (vs.length > 1) {
          violations.push(`${field}::shared ${key} by ${[...new Set(vs)].sort().join('+')}`);
        }
      }
    }
    expect(violations.sort(), 'one key cannot describe two rules').toEqual([]);
  });

  it('every rule carries a message key', () => {
    const violations = RULES.filter((r) => r.keys.length === 0).map((r) =>
      id(r, `${r.validator} has no message`),
    );
    expect(violations.sort(), "a rule without a message can only borrow another rule's").toEqual(
      [],
    );
  });

  it('validation keys live in a feature block or FORMS, never at the root or in MESSAGES', () => {
    const violations = RULES.flatMap((r) =>
      r.keys
        .filter((k) => !k.includes('.') || k.startsWith('MESSAGES.'))
        .map((k) => id(r, `${k} is not a validation key`)),
    );
    expect([...new Set(violations)].sort()).toEqual([]);
  });

  it('no error block renders a fixed key - the validator decides, not the template', () => {
    const violations: string[] = [];
    for (const file of TEMPLATES) {
      for (const { body } of errorBlocks(file)) {
        for (const m of body.matchAll(/'([^']+)'\s*\|\s*translate/g)) {
          if (I18N_KEY.test(m[1])) violations.push(`${file}::fixed ${m[1]}`);
        }
      }
    }
    expect([...new Set(violations)].sort(), 'app-field-error renders the broken rule').toEqual([]);
  });

  it('every message key exists in both languages', () => {
    const keys = [...new Set(RULES.flatMap((r) => r.keys))];
    const violations = keys.flatMap((k) => [
      ...(DE.has(k) ? [] : [`de.json::missing ${k}`]),
      ...(EN.has(k) ? [] : [`en.json::missing ${k}`]),
    ]);
    expect(violations.sort()).toEqual([]);
  });

  it('de.json and en.json carry the same keys at every level', () => {
    const only = (a: Map<string, string>, b: Map<string, string>, side: string) =>
      [...a.keys()].filter((k) => !b.has(k)).map((k) => `${side} only::${k}`);
    expect([...only(DE, EN, 'de.json'), ...only(EN, DE, 'en.json')].sort()).toEqual([]);
  });

  it('de.json and en.json use the same placeholders in every text', () => {
    const placeholders = (s: string) =>
      (s.match(/\{\{\s*\w+\s*\}\}/g) ?? [])
        .map((p) => p.replace(/\s/g, ''))
        .sort()
        .join();
    const violations = [...DE.keys()]
      .filter((k) => EN.has(k) && placeholders(DE.get(k)!) !== placeholders(EN.get(k)!))
      .map((k) => `placeholders differ::${k}`);
    expect(violations.sort()).toEqual([]);
  });

  it('a bound placeholder sits on the rule that owns the bound', () => {
    const isBound = (p: string) => Object.values(BOUND_PLACEHOLDER).includes(p);
    const violations = RULES.flatMap((r) =>
      textsOf(r).flatMap(({ key, text }) =>
        [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
          .map((m) => m[1])
          .filter((p) => isBound(p) && BOUND_PLACEHOLDER[r.validator] !== p)
          .map((p) => id(r, `${key} uses {{${p}}}, which ${r.validator} does not provide`)),
      ),
    );
    expect([...new Set(violations)].sort(), 'the placeholder would render empty').toEqual([]);
  });

  /**
   * CLAUDE.md: numeric bounds are never spelled out in a text. The rule passes its bound as a
   * translate param, so the text follows when the bound changes; a written number goes stale.
   */
  it('a bounded rule spells no number - it uses its placeholder', () => {
    const violations = RULES.filter((r) => r.bounded).flatMap((r) =>
      textsOf(r)
        .filter(({ text }) => /\d/.test(text.replace(/\{\{\s*\w+\s*\}\}/g, '')))
        .map(({ key, lang }) => id(r, `${lang} ${key} writes a number`)),
    );
    expect(
      [...new Set(violations)].sort(),
      'use {{maxLength}} / {{minLength}} / {{min}} / {{max}}',
    ).toEqual([]);
  });

  /**
   * A length limit in another rule's message is always residue: as guidance for an empty field it
   * is useless, and the sibling length rule states it itself.
   */
  it('no rule repeats a sibling length bound in its text', () => {
    const digitsOf = (s: string) => s.replace(/\D/g, '');
    const violations: string[] = [];
    for (const rules of byField().values()) {
      const lengthBounds = rules
        .filter((r) => ['maxLength', 'minLength'].includes(r.validator) && r.bound !== null)
        .map((r) => digitsOf(String(r.bound)));
      if (lengthBounds.length === 0) continue;
      for (const r of rules.filter((x) => !x.bounded)) {
        for (const { key, lang, text } of textsOf(r)) {
          const numbers = text.match(/\d[\d.,]*/g) ?? [];
          if (numbers.some((n) => lengthBounds.includes(digitsOf(n)))) {
            violations.push(id(r, `${lang} ${key} repeats a sibling length bound`));
          }
        }
      }
    }
    expect([...new Set(violations)].sort()).toEqual([]);
  });

  /**
   * A rule whose message is never rendered is only half a contract: every field BOUND in a template
   * ([formField]) that carries a messaged rule (matched by field name against the rules declared in
   * the template's own directory) must render <app-field-error [field]="same expression" />.
   */
  it('every bound field with a messaged rule renders its error', () => {
    const messagedFieldsByDir = new Map<string, Set<string>>();
    for (const r of RULES.filter((x) => x.keys.length > 0)) {
      const dir = dirOf(r.file);
      const leaf = r.field.split('.').pop()!.replace(/\[.*$/, '');
      messagedFieldsByDir.set(dir, (messagedFieldsByDir.get(dir) ?? new Set()).add(leaf));
    }
    const violations: string[] = [];
    for (const file of TEMPLATES) {
      const fields = messagedFieldsByDir.get(dirOf(file));
      if (!fields) continue;
      const src = templateOf(file);
      for (const m of src.matchAll(/\[formField\]="([^"]+)"/g)) {
        const expr = m[1];
        const leaf = expr.split('.').pop()!.replace(/\[.*$/, '');
        if (!fields.has(leaf)) continue;
        const escaped = expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`<app-field-error\\s+\\[field\\]="${escaped}"`).test(src)) {
          violations.push(`${file}::${expr} can turn invalid without showing why`);
        }
      }
    }
    expect([...new Set(violations)].sort(), 'a dead save button is not feedback').toEqual([]);
  });

  /**
   * The invalid border comes from the global provideSignalFormsConfig classes map in app.config.ts,
   * applied to every [formField] element. A hand binding is either redundant or disagrees with it.
   */
  it('no template binds ui-invalid by hand - the provider owns the invalid border', () => {
    const violations = TEMPLATES.filter((f) => /\[class\.ui-invalid\]/.test(templateOf(f))).map(
      (f) => `${f}::binds [class.ui-invalid]`,
    );
    expect(violations.sort()).toEqual([]);
  });

  /** Error markup exists exactly once, inside app-field-error. */
  it('error markup lives only in the field-error component', () => {
    const violations: string[] = [];
    for (const file of TEMPLATES.filter((f) => !FIELD_ERROR_DIR.test(f))) {
      const src = templateOf(file);
      if (/\.errors\(\)/.test(src)) violations.push(`${file}::reads errors() in a template`);
      if (/\bui-field-error\b/.test(src)) violations.push(`${file}::hand-written .ui-field-error`);
    }
    expect(violations.sort(), 'one component renders every message').toEqual([]);
  });

  /**
   * A field the UI never touches at all: its rule can block a save with nothing to click and nothing
   * to read. Mentioning the field anywhere beside its own schema counts.
   */
  it('every rule sits on a field the UI knows', () => {
    const violations: string[] = [];
    for (const r of RULES) {
      const leaf = r.field.split('.').pop()!.replace(/\[.*$/, '');
      const neighbours = FILES.filter(
        (f) =>
          dirOf(f) === dirOf(r.file) &&
          f !== r.file &&
          (f.endsWith('.html') || (f.endsWith('.ts') && !f.endsWith('.spec.ts'))),
      );
      // A component that composes a rule on top of its schema carries its own inline template.
      const self = templateOf(r.file) ? [r.file] : [];
      const mentions = (f: string) =>
        new RegExp(`\\b${leaf}\\b`).test(f === r.file ? templateOf(f) : read(f));
      if (![...neighbours, ...self].some(mentions)) {
        violations.push(id(r, `${leaf} appears in no template and no component`));
      }
    }
    expect(
      [...new Set(violations)].sort(),
      'a rule on a field the UI never shows blocks in silence',
    ).toEqual([]);
  });

  /** A hand-written validate() with two failure branches needs a key for each. */
  it('a hand-written validate names every failure it can return', () => {
    const violations = RULES.filter(
      (r) => r.validator === 'validate' && r.branches > r.keys.length,
    ).map((r) => id(r, `${r.branches} failure branches, ${r.keys.length} message(s)`));
    expect([...new Set(violations)].sort()).toEqual([]);
  });

  /** An error block that reads a NEIGHBOUR's errors renders a message about the wrong field. */
  it('an error block reads the errors of the field it belongs to', () => {
    const violations: string[] = [];
    for (const file of TEMPLATES) {
      for (const { condition, body } of errorBlocks(file)) {
        const asked = condition.match(/([\w.$[\]()]+?)\(\)\.invalid\(\)/)?.[1];
        if (!asked) continue;
        for (const m of body.matchAll(/([\w.$[\]()]+?)\(\)\.errors\(\)/g)) {
          if (m[1] !== asked) violations.push(`${file}::${asked} renders ${m[1]}'s error`);
        }
      }
    }
    expect([...new Set(violations)].sort()).toEqual([]);
  });

  /**
   * Right message, wrong place: if more elements close than open between the binding and its
   * message, the message has left the field's container and runs on into whatever follows.
   */
  it('an error block sits inside the container of its field', () => {
    const violations: string[] = [];
    for (const file of TEMPLATES) {
      const src = templateOf(file);
      for (const m of src.matchAll(/\[formField\]="([^"]+)"/g)) {
        const expr = m[1];
        const escaped = expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rendered = new RegExp(`<app-field-error\\s+\\[field\\]="${escaped}"`).exec(src);
        if (!rendered) continue; // the check above owns "renders at all"
        const between = src.slice(m.index ?? 0, rendered.index);
        const closed = (between.match(/<\/div>/g) ?? []).length;
        const opened = (between.match(/<div\b/g) ?? []).length;
        if (closed > opened) {
          violations.push(`${file}::${expr} renders its error outside the field's container`);
        }
      }
    }
    expect([...new Set(violations)].sort()).toEqual([]);
  });

  it('every validation message ends in a full stop', () => {
    const keys = [...new Set(RULES.flatMap((r) => r.keys))];
    const violations = keys.flatMap((k) => [
      ...((DE.get(k) ?? '.').trimEnd().endsWith('.') ? [] : [`de.json::no full stop ${k}`]),
      ...((EN.get(k) ?? '.').trimEnd().endsWith('.') ? [] : [`en.json::no full stop ${k}`]),
    ]);
    expect(violations.sort()).toEqual([]);
  });
});
