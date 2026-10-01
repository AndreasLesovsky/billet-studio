import { Component, computed, inject, resource } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { NUMBER_LIMITS } from '../../../../billet/billet-limits';
import { AssetCatalogApi } from '../../../../core/services/asset-catalog-api';
import { AssetPicker } from '../../../../shared/components/asset-picker/asset-picker';
import { AssetPickerSkeleton } from '../../../../shared/components/asset-picker/asset-picker-skeleton';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { RangeSlider } from '../../../../shared/components/range-slider/range-slider';
import { BilletText } from '../../billet-text';
import { EditorCommands } from '../../editor-commands';
import { EditorPanel } from '../editor-panel';
import {
  ASSET_DEFAULT_KEYS,
  matchesAssetDefaults,
  withAsset,
  withAssetDefaults,
} from '../../../../billet/asset-defaults';

type StageKey = (typeof ASSET_DEFAULT_KEYS)[number];

const STAGE_LABELS: Readonly<Record<StageKey, string>> = {
  fitSize: 'EDITOR.SCENE.FIT_SIZE',
  yOffset: 'EDITOR.SCENE.Y_OFFSET',
  exposure: 'EDITOR.SCENE.EXPOSURE',
  cameraDistance: 'EDITOR.SCENE.CAMERA_DISTANCE',
  cameraHeight: 'EDITOR.SCENE.CAMERA_HEIGHT',
  autoRotateSpeed: 'EDITOR.SCENE.AUTO_ROTATE_SPEED',
};

/**
 * The inspector's scene tab: the 3D model from the library, its framing, and the texts around it.
 * Picking a model is one undo step that brings the model's own framing; the sliders only change
 * stage settings, so the preview updates without loading the model again. Each slider resets to the
 * model's default, the button to all of them. Inputs and commands: see EditorPanel.
 */
@Component({
  selector: 'app-scene-panel',
  imports: [
    AssetPicker,
    AssetPickerSkeleton,
    BilletText,
    FieldError,
    FormField,
    RangeSlider,
    TranslatePipe,
  ],
  templateUrl: './scene-panel.html',
  styleUrl: './scene-panel.scss',
})
export class ScenePanel extends EditorPanel {
  private readonly catalog = inject(AssetCatalogApi);
  private readonly commands = inject(EditorCommands);

  /** The active models; a failed load already showed its toast and can be retried. */
  protected readonly library = resource({ loader: () => this.catalog.list() });
  protected readonly assets = computed(() => (this.library.hasValue() ? this.library.value() : []));
  /** The picker once the library is there; the retry alert after a failure; else its skeleton. */
  protected readonly libraryView = computed<'picker' | 'failed' | 'loading'>(() => {
    if (this.library.hasValue()) return 'picker';
    return this.library.status() === 'error' ? 'failed' : 'loading';
  });

  protected readonly scene = computed(() => this.document().scene);
  private readonly slug = computed(() => this.scene().modelSlug);
  /** The billet's model, also when it has left the library (for its credit and defaults). */
  private readonly assetRequest = resource({
    params: () => this.slug() || undefined,
    loader: ({ params }) => this.catalog.get(params),
  });
  // A model picked from the library is known at once, without waiting for its own request.
  private readonly listedAsset = computed(
    () => this.assets().find((a) => a.slug === this.slug()) ?? null,
  );
  protected readonly asset = computed(
    () => this.listedAsset() ?? (this.assetRequest.hasValue() ? this.assetRequest.value() : null),
  );
  /** The model's defaults are on their way: the sliders hold the places of marks and resets. */
  protected readonly assetLoading = computed(
    () => this.asset() === null && this.assetRequest.isLoading(),
  );
  protected readonly retired = computed(
    () => this.library.hasValue() && !this.assets().some((a) => a.slug === this.slug()),
  );

  protected readonly atDefaults = computed(() => {
    const defaults = this.asset()?.defaults;
    return !defaults || matchesAssetDefaults(this.scene(), defaults);
  });

  protected readonly sliders = computed(() => {
    const defaults = this.asset()?.defaults ?? null;
    return ASSET_DEFAULT_KEYS.map((key) => ({
      key,
      labelKey: STAGE_LABELS[key],
      step: NUMBER_LIMITS[key].step,
      defaultValue: defaults ? defaults[key] : null,
      marks: defaults ? [defaults[key]] : [],
    }));
  });
  /** Rotation speed sits with its switch; the other sliders frame the model. */
  protected readonly framing = computed(() =>
    this.sliders().filter((slider) => slider.key !== 'autoRotateSpeed'),
  );
  protected readonly speed = computed(() =>
    this.sliders().find((slider) => slider.key === 'autoRotateSpeed')!,
  );

  protected pickAsset(slug: string): void {
    const asset = this.assets().find((a) => a.slug === slug);
    if (!asset || slug === this.slug()) return;
    this.commands.commit((document) => withAsset(document, asset));
  }

  protected resetToAsset(): void {
    const defaults = this.asset()?.defaults;
    if (defaults) this.commands.commit((document) => withAssetDefaults(document, defaults));
  }

  protected reloadLibrary(): void {
    this.library.reload();
  }
}
