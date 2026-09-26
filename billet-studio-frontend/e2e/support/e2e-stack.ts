import type { BrowserContext } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The stack the backend suite (playwright.backend.config.ts) runs against. Every port and the
 * database are deliberately NOT the development ones (4200, 8080, db_billet_studio on 3306), so the
 * suite and a running dev stack never collide and no request can reach the developer's data.
 */
const APP_PORT = 4320;
const BACKEND_PORT = 8081;

/** The throwaway database of docker-compose.e2e.yml. */
const DATABASE = {
  url: 'jdbc:mysql://127.0.0.1:3307/db_billet_studio_e2e?useSSL=false&serverTimezone=UTC',
  username: 'root',
  password: 'e2e',
};

export const APP_URL = `http://localhost:${APP_PORT}`;
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
export const API_URL = `${BACKEND_URL}/v1/`;

/** The development backend, environment.ts's default API. The suite blocks it outright. */
const DEV_BACKEND = /^https?:\/\/(localhost|127\.0\.0\.1):8080\//;

/** Specs that need the real backend; the mocked suite (playwright.config.ts) skips them. */
export const BACKEND_SPECS = ['account-flows.spec.ts'];

const REST_SERVICE = join(__dirname, '..', '..', '..', 'billet-studio-rest-service');
const BUILD_HINT =
  'run "mvnw.cmd -DskipTests package" (./mvnw elsewhere) in billet-studio-rest-service';

/**
 * Where the backend runs, created on demand. Its config imports .env.local and ../.env.local
 * relative to the working directory, so it must not start in billet-studio-rest-service/: a
 * developer's .env.local would feed the suite. Gitignored with e2e/artifacts/; logs and uploads
 * land here too.
 */
export function backendWorkdir(): string {
  const workdir = join(__dirname, '..', 'artifacts', 'backend');
  mkdirSync(workdir, { recursive: true });
  return workdir;
}

/**
 * The built backend jar. The suite runs the jar instead of `mvnw spring-boot:run`: that would
 * compile into the target/classes a running dev backend (spring-boot:run with devtools) watches
 * and restart it. A jar older than the backend sources would test old code, so it is refused.
 */
export function backendJar(): string {
  const target = join(REST_SERVICE, 'target');
  const jar = existsSync(target)
    ? readdirSync(target).find((file) => /^billet-studio-rest-service-.+\.jar$/.test(file))
    : undefined;
  if (!jar) throw new Error(`No backend jar in ${target}: ${BUILD_HINT}.`);
  const built = statSync(join(target, jar)).mtimeMs;
  if (newestChange([join(REST_SERVICE, 'src', 'main'), join(REST_SERVICE, 'pom.xml')]) > built) {
    throw new Error(`${jar} is older than the backend sources: ${BUILD_HINT}.`);
  }
  return join(target, jar);
}

function newestChange(paths: readonly string[]): number {
  return Math.max(
    ...paths.flatMap((path) =>
      statSync(path).isDirectory()
        ? readdirSync(path, { recursive: true }).map(
            (entry) => statSync(join(path, String(entry))).mtimeMs,
          )
        : [statSync(path).mtimeMs],
    ),
  );
}

/**
 * Environment of the backend process. Pins everything a developer's shell could otherwise feed into
 * it (root account, JWT secret, mail, model base URL), like MariaDbITBase does for the ITs.
 */
export function backendEnv(): Record<string, string> {
  return {
    SERVER_PORT: String(BACKEND_PORT),
    DATABASE_URL: DATABASE.url,
    DATABASE_USERNAME: DATABASE.username,
    DATABASE_PASSWORD: DATABASE.password,
    JPA_DDL_AUTO: 'none',
    CORS_ALLOWED_ORIGINS: APP_URL,
    FRONTEND_URL: APP_URL,
    // ng serve serves public/models, so the catalog's GLBs and previews come from the suite's app.
    MODELS_BASE_URL: `${APP_URL}/`,
    // Every test signs up its own account from one IP (3 per 7 days otherwise).
    RATE_LIMIT_ENABLED: 'false',
    MAIL_ENABLED: 'false',
    ENFORCE_STRONG_SECRETS: 'false',
    SWAGGER_ENABLED: 'false',
    JWT_SECRET: 'e2e-only-secret-of-the-throwaway-stack-0123456789abcdef0123456789abcdef',
    ROOT_EMAIL: 'root@e2e.test',
    ROOT_PASSWORD: 'E2e-Root-Passwort-1',
    LOG_DIRECTORY: './logs',
    UPLOAD_DIRECTORY: './uploads',
  };
}

/**
 * Points every page of a browser context at the e2e backend. index.html loads env.js before the
 * app, and the app reads window.__env once at startup, so the test serves that file instead of the
 * empty local placeholder. The development backend is blocked as well: should the app ever fall
 * back to environment.ts's default, requests fail loudly instead of reaching the dev backend.
 */
export async function pointAppAtE2eBackend(context: BrowserContext): Promise<void> {
  const env = { apiUrl: API_URL, frontendUrl: APP_URL };
  await context.route('**/env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__env = ${JSON.stringify(env)};`,
    }),
  );
  await context.route(DEV_BACKEND, (route) => route.abort('blockedbyclient'));
}
