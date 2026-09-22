// Writes the frontend version + build date into a TS constant the app can import.
// Runs via the prestart/prebuild/pretest npm hooks so package.json stays the single source for the
// version; the output file is gitignored.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const target = join(root, 'src', 'app', 'core', 'version.ts');
const buildDate = new Date().toISOString();

const content = `// AUTO-GENERATED from package.json by scripts/generate-version.mjs. Do not edit by hand.
export const APP_VERSION = '${pkg.version}';
export const APP_BUILD_DATE = '${buildDate}';
`;

writeFileSync(target, content);
console.log(`version.ts -> ${pkg.version} (${buildDate})`);
