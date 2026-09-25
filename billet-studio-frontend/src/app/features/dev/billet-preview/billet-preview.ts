import { Component, computed, inject, input, resource, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import {
  BILLET_LANGS,
  createDocument,
  type BilletDocument,
  type BilletLang,
} from '../../../billet/billet-document';
import { migrateDocument } from '../../../billet/migrate-document';
import { TEMPLATE_IDS, TEMPLATES, type TemplateId } from '../../../billet/templates/templates';
import { BilletView } from '../../../billet/view/billet-view';
import type { BilletViewMode } from '../../../billet/view/billet-view-style';
import type { ModelAssetDto } from '../../../core/models/models';
import { AssetCatalogApi } from '../../../core/services/asset-catalog-api';
import { PARITY_DOCUMENT } from './parity-document.generated';

type PreviewId = 'parity' | TemplateId | 'blank';

const PREVIEWS: readonly { readonly id: PreviewId; readonly labelKey: string }[] = [
  { id: 'parity', labelKey: 'BILLET_PREVIEW.PARITY' },
  ...TEMPLATE_IDS.map((id) => ({ id, labelKey: TEMPLATES[id].nameKey })),
  { id: 'blank', labelKey: 'BILLET_PREVIEW.BLANK' },
];

const MODES: readonly { readonly mode: BilletViewMode; readonly labelKey: string }[] = [
  { mode: 'auto', labelKey: 'COLOR_MODE.SYSTEM' },
  { mode: 'light', labelKey: 'COLOR_MODE.LIGHT' },
  { mode: 'dark', labelKey: 'COLOR_MODE.DARK' },
];

const LANGUAGE_NAMES: Record<BilletLang, string> = {
  de: 'NAV.LANGUAGE_DE',
  en: 'NAV.LANGUAGE_EN',
};

/** The live card as a document; it passes migrateDocument() like every document entering the app. */
const PARITY = migrateDocument(PARITY_DOCUMENT);

/**
 * Dev only (/dev/billet/:templateId): one billet in the public page's renderer, for manual QA of
 * the templates and of the parity fixture (docs/fixtures/muttertag.billet.json) against the live
 * card. The Playwright parity test uses the real public page, not this one.
 */
@Component({
  selector: 'app-billet-preview',
  imports: [BilletView, TranslatePipe],
  templateUrl: './billet-preview.html',
  styleUrl: './billet-preview.scss',
})
export class BilletPreview {
  readonly templateId = input.required<string>();

  private readonly router = inject(Router);
  private readonly assets = inject(AssetCatalogApi);
  private readonly view = viewChild.required(BilletView);

  protected readonly previews = PREVIEWS;
  protected readonly modes = MODES;
  protected readonly langs = BILLET_LANGS.map((lang) => ({
    lang,
    code: lang.toUpperCase(),
    nameKey: LANGUAGE_NAMES[lang],
  }));
  protected readonly lang = signal<BilletLang>('de');
  protected readonly mode = signal<BilletViewMode>('auto');

  /** An unknown id shows the parity fixture. */
  protected readonly previewId = computed<PreviewId>(() => {
    const id = this.templateId();
    return PREVIEWS.find((preview) => preview.id === id)?.id ?? 'parity';
  });

  protected readonly document = computed(() => previewDocument(this.previewId(), this.lang()));

  private readonly asset = resource({
    params: () => {
      const { scene } = this.document();
      return scene.enabled ? scene.modelSlug : undefined;
    },
    loader: ({ params }) => this.assetFor(params),
  });

  protected readonly model = computed(() => (this.asset.hasValue() ? this.asset.value() : null));

  protected selectPreview(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    void this.router.navigate(['/dev/billet', id]);
  }

  protected replay(): void {
    const view: BilletView = this.view();
    view.replay();
  }

  /** The catalog's entry; without a backend, the asset pipeline's own files. */
  private async assetFor(slug: string): Promise<ModelAssetDto | null> {
    try {
      return (await this.assets.get(slug)) ?? localAsset(slug, this.document().scene);
    } catch {
      return localAsset(slug, this.document().scene);
    }
  }
}

function previewDocument(id: PreviewId, lang: BilletLang): BilletDocument {
  if (id === 'parity' && PARITY) return PARITY;
  if (id === 'parity' || id === 'blank') return createDocument({ lang });
  return createDocument({ lang, templateId: id });
}

/** public/models as tools/asset-pipeline writes it (<slug>.v1.glb, previews/<slug>.v1.webp). */
function localAsset(slug: string, scene: BilletDocument['scene']): ModelAssetDto {
  return {
    slug,
    nameDe: slug,
    nameEn: slug,
    occasion: '',
    fileUrl: `models/${slug}.v1.glb`,
    previewUrl: `models/previews/${slug}.v1.webp`,
    fileSizeBytes: 0,
    credit: null,
    active: true,
    defaults: {
      fitSize: scene.fitSize,
      yOffset: scene.yOffset,
      exposure: scene.exposure,
      cameraDistance: scene.cameraDistance,
      cameraHeight: scene.cameraHeight,
      autoRotateSpeed: scene.autoRotateSpeed,
    },
  };
}
