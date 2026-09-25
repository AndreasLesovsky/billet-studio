// Serves the snapshot of the live Mother's Day card (e2e/fixtures/muttertag-original) for the parity
// test. Its GLB is absent on purpose, so the model request answers 404 and the canvas stays empty.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../fixtures/muttertag-original/', import.meta.url));
const PORT = 4321;
const TYPES = { '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

/** The file a request path names, or null when it points outside the snapshot folder. */
function fileFor(url) {
  const path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  return file.startsWith(ROOT) ? file : null;
}

const isFile = (file) =>
  stat(file).then(
    (stats) => stats.isFile(),
    () => false,
  );
const typeOf = (file) => TYPES[extname(file)] ?? 'application/octet-stream';

createServer(async (request, response) => {
  const file = fileFor(request.url);
  if (!file || !(await isFile(file))) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': typeOf(file), 'cache-control': 'no-store' });
  createReadStream(file).pipe(response);
}).listen(PORT, () => console.log(`Parity original on http://localhost:${PORT}/index.html`));
