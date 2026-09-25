import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ParityFixture {
  readonly hero: Readonly<Record<string, string>>;
  readonly scene: Readonly<Record<string, unknown>> & { readonly hint: string };
  readonly [key: string]: unknown;
}

/** docs/fixtures/muttertag.billet.json: the live Mother's Day card as a billet document. */
export const PARITY_DOCUMENT: ParityFixture = JSON.parse(
  readFileSync(join(__dirname, '../../../docs/fixtures/muttertag.billet.json'), 'utf8'),
);

/** The seeded bouquet (sql/seed_models.sql), served by ng serve from public/models. */
export const FLOWER_BOUQUET = {
  slug: 'flower-bouquet',
  nameDe: 'Blumenstrauß',
  nameEn: 'Flower bouquet',
  occasion: 'mothers_day',
  fileUrl: '/models/flower-bouquet.v1.glb',
  previewUrl: '/models/previews/flower-bouquet.v1.webp',
  fileSizeBytes: 5773100,
  credit:
    'Flower Bouquet by icecool (CC-BY-4.0) https://sketchfab.com/3d-models/flower-bouquet-48e92013548247a9ad486dc13110c9b4',
  active: true,
  defaults: {
    fitSize: 1.6,
    yOffset: -0.08,
    exposure: 0.6,
    cameraDistance: 2.8,
    cameraHeight: 0.1,
    autoRotateSpeed: 0.45,
  },
};

/** A PublicBilletDto (docs/api-contract.md). */
export function publicBillet(document: object, model: object | null = FLOWER_BOUQUET) {
  return { document, model, publishedAt: '2026-05-10T06:00:00Z' };
}

/**
 * Stands in for the backend: GET /v1/public/billets/<token> answers the billet registered for the
 * token, every other /v1 request the backend's 404 (the app runs against a cross-origin API, so the
 * answers carry CORS headers).
 */
export async function mockBilletApi(page: Page, billets: Record<string, object>): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const token = /\/v1\/public\/billets\/([^/]+)$/.exec(path)?.[1];
    const billet = token === undefined ? undefined : billets[decodeURIComponent(token)];
    const headers = { 'access-control-allow-origin': '*' };
    if (billet) {
      await route.fulfill({ json: billet, headers });
      return;
    }
    const errorCode = token === undefined ? 'NOT_FOUND' : 'BILLET_NOT_FOUND';
    await route.fulfill({
      status: 404,
      json: { errorCode, status: 404, timestamp: new Date().toISOString() },
      headers,
    });
  });
}
