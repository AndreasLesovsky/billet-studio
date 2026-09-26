import type { Page } from '@playwright/test';

/**
 * For specs that assert nothing about the 3D: the page behaves as in a browser without WebGL, so
 * every billet scene keeps its preview image (the scene's own fallback, one console warning).
 * Headless Chromium renders WebGL in software; booting a scene and drawing the bouquet blocked the
 * page for seconds and starved parallel workers. The backend suite keeps the real 3D.
 */
export async function withoutWebGl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...options: unknown[]
    ) {
      return type.includes('webgl') ? null : getContext.call(this, type, ...options);
    } as typeof getContext;
  });
}
