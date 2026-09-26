import type { Page, Route } from '@playwright/test';

import { apiError, CORS_HEADERS, MODEL_CATALOG, modelLibraryAnswer } from './guest-api';

type BilletDocument = { title: string; scene: { enabled: boolean; modelSlug: string } };

interface StoredBillet {
  readonly id: number;
  version: number;
  document: BilletDocument;
  published: BilletDocument | null;
  shareToken: string | null;
  publishedAt: string | null;
  readonly createdAt: string;
  updatedAt: string;
}

/** The signed-in user (UserWithTokenDto); the token is a stand-in, nothing checks it. */
const USER = {
  id: 7,
  name: 'Anna',
  email: 'anna@example.com',
  accessToken: 'e2e-access-token',
  role: 'ROLE_USER',
  reactivated: false,
  avatarUrl: null,
  expiresInSeconds: 900,
};

/** 22 characters of base64url, like the backend's 128-bit tokens. */
export const SHARE_TOKEN = 'e2eShareToken_1234567A';

/**
 * A stand-in for the backend of one signed-in user, with the /v1/billets rules the editor and the
 * list depend on (docs/api-contract.md): versions and 409 BILLET_MODIFIED_ELSEWHERE, the draft vs.
 * the published snapshot, a share token that outlives an unpublish. Login and refresh answer the
 * user; the model library answers as for a guest.
 */
export class AccountBackend {
  readonly billets = new Map<number, StoredBillet>();
  /** `METHOD /path` of every billet request, in order. */
  readonly requests: string[] = [];
  private nextId = 100;

  async install(page: Page): Promise<void> {
    await page.route('**/v1/**', (route) => this.answer(route));
  }

  private async answer(route: Route): Promise<void> {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const models = modelLibraryAnswer(method, path);
    const body: unknown = request.postDataJSON();
    if (path.startsWith('/v1/billets')) this.requests.push(`${method} ${path}`);

    const [status, json] =
      models !== undefined ? [200, models] : (this.handle(method, path, body) ?? notFound());
    // A 204 carries no body at all.
    await route.fulfill(
      status === 204 ? { status, headers: CORS_HEADERS } : { status, json, headers: CORS_HEADERS },
    );
  }

  private handle(method: string, path: string, body: unknown): [number, unknown] | null {
    switch (`${method} ${path}`) {
      case 'POST /v1/auth/login':
      case 'POST /v1/auth/refresh':
        return [200, USER];
      case 'GET /v1/billets':
        return [200, this.list()];
      case 'POST /v1/billets/import':
        return [201, this.import(body as { documents: BilletDocument[] })];
    }
    const [, idText, action] = /^\/v1\/billets\/(\d+)(?:\/(\w+))?$/.exec(path) ?? [];
    const billet = this.billets.get(Number(idText));
    return billet ? this.handleBillet(billet, `${method} ${action ?? ''}`, body) : null;
  }

  private import({ documents }: { documents: BilletDocument[] }) {
    return { billets: documents.map((document) => this.summary(this.create(document))) };
  }

  private handleBillet(
    billet: StoredBillet,
    call: string,
    body: unknown,
  ): [number, unknown] | null {
    const { version } = (body ?? {}) as { version?: number };
    switch (call) {
      case 'GET ':
        return [200, this.detail(billet)];
      case 'PUT ':
        if (version !== billet.version) return [409, apiError('BILLET_MODIFIED_ELSEWHERE', 409)];
        billet.document = (body as { document: BilletDocument }).document;
        billet.version++;
        billet.updatedAt = new Date().toISOString();
        return [
          200,
          {
            version: billet.version,
            updatedAt: billet.updatedAt,
            hasUnpublishedChanges: changed(billet),
          },
        ];
      case 'POST publish':
        if (version !== billet.version) return [409, apiError('BILLET_MODIFIED_ELSEWHERE', 409)];
        billet.published = billet.document;
        billet.shareToken ??= SHARE_TOKEN;
        billet.publishedAt = new Date().toISOString();
        return [
          200,
          {
            shareToken: billet.shareToken,
            publishedAt: billet.publishedAt,
            version: billet.version,
          },
        ];
      case 'POST unpublish':
        billet.published = null;
        billet.publishedAt = null;
        return [204, null];
      default:
        return null;
    }
  }

  private create(document: BilletDocument): StoredBillet {
    const now = new Date().toISOString();
    const billet: StoredBillet = {
      id: this.nextId++,
      version: 0,
      document,
      published: null,
      shareToken: null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.billets.set(billet.id, billet);
    return billet;
  }

  /** Newest edit first, then newest id. */
  private list() {
    return [...this.billets.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
      .map((billet) => this.summary(billet));
  }

  private summary(billet: StoredBillet) {
    const { scene, title } = billet.document;
    const modelSlug = scene.enabled ? scene.modelSlug : null;
    return {
      id: billet.id,
      title,
      modelSlug,
      previewUrl: MODEL_CATALOG.find((m) => m.slug === modelSlug)?.previewUrl ?? null,
      ...this.shareFacts(billet),
      createdAt: billet.createdAt,
      updatedAt: billet.updatedAt,
    };
  }

  private detail(billet: StoredBillet) {
    const { scene } = billet.document;
    return {
      id: billet.id,
      version: billet.version,
      document: billet.document,
      model: scene.enabled ? (MODEL_CATALOG.find((m) => m.slug === scene.modelSlug) ?? null) : null,
      ...this.shareFacts(billet),
      createdAt: billet.createdAt,
      updatedAt: billet.updatedAt,
    };
  }

  private shareFacts(billet: StoredBillet) {
    return {
      published: billet.published !== null,
      hasUnpublishedChanges: changed(billet),
      shareToken: billet.shareToken,
      publishedAt: billet.publishedAt,
    };
  }
}

function changed(billet: StoredBillet): boolean {
  return (
    billet.published !== null &&
    JSON.stringify(billet.published) !== JSON.stringify(billet.document)
  );
}

function notFound(): [number, unknown] {
  return [404, apiError('NOT_FOUND', 404)];
}
