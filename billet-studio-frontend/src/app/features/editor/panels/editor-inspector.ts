import { Component, input } from '@angular/core';

import type { ColorMode } from '../../../core/theme/theme-registry.generated';
import { DesignPanel } from './design/design-panel';
import { EditorPanel } from './editor-panel';
import { ParticlesPanel } from './particles/particles-panel';
import { ScenePanel } from './scene/scene-panel';
import { SpacingPanel } from './spacing/spacing-panel';

export type InspectorTab = 'design' | 'spacing' | 'scene' | 'particles';

/** The inspector column: the panel of the chosen inspector tab. Inputs: see EditorPanel. */
@Component({
  selector: 'app-editor-inspector',
  imports: [DesignPanel, ParticlesPanel, ScenePanel, SpacingPanel],
  template: `
    @switch (tab()) {
      @case ('design') {
        <app-design-panel
          [billetForm]="billetForm()"
          [document]="document()"
          [previewColorMode]="previewColorMode()"
        />
      }
      @case ('spacing') {
        <app-spacing-panel [billetForm]="billetForm()" [document]="document()" />
      }
      @case ('scene') {
        <app-scene-panel [billetForm]="billetForm()" [document]="document()" />
      }
      @case ('particles') {
        <app-particles-panel [billetForm]="billetForm()" [document]="document()" />
      }
    }
  `,
})
export class EditorInspector extends EditorPanel {
  readonly tab = input.required<InspectorTab>();
  /** The palette the preview shows the billet in (the design panel's theme cards follow it). */
  readonly previewColorMode = input.required<ColorMode>();
}
