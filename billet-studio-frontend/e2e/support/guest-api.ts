import type { Page } from '@playwright/test';

/** The app's origin (playwright.config.ts); ng serve also serves public/models there. */
const APP_ORIGIN = 'http://localhost:4320';

interface SeedModel {
  readonly slug: string;
  readonly nameDe: string;
  readonly nameEn: string;
  readonly occasion: string;
  readonly fileSizeBytes: number;
  readonly credit: string;
  /** fitSize, yOffset, exposure, cameraDistance, cameraHeight, autoRotateSpeed */
  readonly defaults: readonly [number, number, number, number, number, number];
}

/** The active rows of sql/seed_models.sql, in library order. */
const SEED_MODELS: readonly SeedModel[] = [
  {
    slug: 'flower-bouquet',
    nameDe: 'Blumenstrauß',
    nameEn: 'Flower bouquet',
    occasion: 'mothers_day',
    fileSizeBytes: 5773100,
    credit:
      'Flower Bouquet by icecool (CC-BY-4.0) https://sketchfab.com/3d-models/flower-bouquet-48e92013548247a9ad486dc13110c9b4',
    defaults: [1.6, -0.08, 0.6, 2.8, 0.1, 0.45],
  },
  {
    slug: 'heart-emoji',
    nameDe: 'Herz',
    nameEn: 'Heart',
    occasion: 'valentines',
    fileSizeBytes: 21276,
    credit:
      'Heart emoji by assetfactory (SKETCHFAB Standard) https://sketchfab.com/3d-models/heart-emoji-ee06846511314b96981313971236e188',
    defaults: [1.5, -0.05, 0.65, 2.8, 0.1, 0.55],
  },
  {
    slug: 'beating-heart',
    nameDe: 'Schlagendes Herz',
    nameEn: 'Beating heart',
    occasion: 'valentines',
    fileSizeBytes: 25576,
    credit:
      'PUMPING HEART MODEL by omarelone (CC-BY-4.0) https://sketchfab.com/3d-models/pumping-heart-model-6f815b9822dc479eae0a17b8dcab9c75',
    defaults: [1.6, -0.08, 0.6, 2.8, 0.1, 0.45],
  },
  {
    slug: 'birthday-cake',
    nameDe: 'Geburtstagstorte',
    nameEn: 'Birthday cake',
    occasion: 'birthday',
    fileSizeBytes: 3206196,
    credit:
      'Birthday Cake by Taylor (CC-BY-4.0) https://sketchfab.com/3d-models/birthday-cake-054d99bef15c4905b9f7ffe95ce9a08a',
    defaults: [2, -0.08, 0.85, 2.8, 0.1, 0.45],
  },
  {
    slug: 'gift-box',
    nameDe: 'Geschenk',
    nameEn: 'Gift box',
    occasion: 'general',
    fileSizeBytes: 164752,
    credit:
      'Gift Box by local.yany (CC-BY-4.0) https://sketchfab.com/3d-models/gift-box-83296611584143a3afad6c0d0c0a4227',
    defaults: [1.3, -0.08, 0.6, 2.8, 0.1, 0.45],
  },
  {
    slug: 'champagne-bottle',
    nameDe: 'Champagnerflasche',
    nameEn: 'Champagne bottle',
    occasion: 'celebration',
    fileSizeBytes: 1967408,
    credit:
      'Champagne Bottle by ethan_garden (CC-BY-4.0) https://sketchfab.com/3d-models/champagne-bottle-1ce8a43374bf4057b757dc635351042b',
    defaults: [1.6, -0.08, 0.6, 2.8, 0.1, 0.45],
  },
  {
    slug: 'snow-globe',
    nameDe: 'Schneekugel',
    nameEn: 'Snow globe',
    occasion: 'christmas',
    fileSizeBytes: 1905960,
    credit:
      'Christmas Ball by Ivanix88 (CC-BY-4.0) https://sketchfab.com/3d-models/christmas-ball-36868988285f4b60b3e389e1aa1bab3f',
    defaults: [1.35, 0.07, 0.6, 2.8, 0.1, 0.45],
  },
];

/** GET /v1/models as the backend answers it (ModelDto[], docs/api-contract.md). */
export const MODEL_CATALOG = SEED_MODELS.map(({ defaults, ...model }) => {
  const [fitSize, yOffset, exposure, cameraDistance, cameraHeight, autoRotateSpeed] = defaults;
  return {
    ...model,
    fileUrl: `${APP_ORIGIN}/models/${model.slug}.v1.glb`,
    previewUrl: `${APP_ORIGIN}/models/previews/${model.slug}.v1.webp`,
    active: true,
    defaults: { fitSize, yOffset, exposure, cameraDistance, cameraHeight, autoRotateSpeed },
  };
});

/** The refresh call sends credentials, so a wildcard origin would be refused. */
export const CORS_HEADERS = {
  'access-control-allow-origin': APP_ORIGIN,
  'access-control-allow-credentials': 'true',
};

/** An ApiError body (docs/api-contract.md). */
export function apiError(errorCode: string, status: number) {
  return { errorCode, status, timestamp: new Date().toISOString() };
}

/** The model library's answer to a request, or undefined when the request is not for it. */
export function modelLibraryAnswer(method: string, path: string): object | undefined {
  if (method !== 'GET') return undefined;
  if (/\/v1\/models\/?$/.test(path)) return MODEL_CATALOG;
  const slug = /\/v1\/models\/([^/]+)$/.exec(path)?.[1];
  return MODEL_CATALOG.find((m) => m.slug === slug);
}

/**
 * The billet assistant as a deployment without it answers (DISABLED: the page shows no assistant),
 * or undefined when the request is not for it. assist.spec.ts routes /v1/assist itself.
 */
export function assistAnswer(method: string, path: string): object | undefined {
  return method === 'GET' && path === '/v1/assist/status' ? { status: 'DISABLED' } : undefined;
}

/**
 * Stands in for the backend of a visitor who is not signed in: the model library answers, the
 * assistant is switched off, every other /v1 request is 401 (the refresh on startup included), so
 * the app runs as a guest.
 */
export async function mockGuestApi(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const models =
      modelLibraryAnswer(request.method(), path) ?? assistAnswer(request.method(), path);
    if (models) {
      await route.fulfill({ json: models, headers: CORS_HEADERS });
    } else {
      await route.fulfill({
        status: 401,
        json: apiError('UNAUTHORIZED', 401),
        headers: CORS_HEADERS,
      });
    }
  });
}
