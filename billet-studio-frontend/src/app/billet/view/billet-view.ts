import { Component, computed, inject, input } from '@angular/core';

import type { ModelAssetDto } from '../../core/models/modelAssetDto';
import type { BilletDocument } from '../billet-document';
import { BilletParticles } from '../particles/billet-particles';
import { BilletScene } from '../scene/billet-scene';
import { BilletBlock } from './billet-block';
import { BilletDivider } from './billet-divider';
import { FitText } from './fit-text';
import {
  billetRootStyle,
  blockSpaces,
  resolveBilletMode,
  type BilletViewMode,
} from './billet-view-style';
import { mediaQuery, PREFERS_DARK } from './media-query';
import { blockReveal, Reveal, REVEAL, RevealTimeline } from './reveal';

/**
 * The one renderer of a billet: the editor preview and the public page both show this, never a
 * fork (CLAUDE.md §11). Everything it draws comes from the document's concrete values as
 * --billet-* properties on the host; it never reads the site's --ui-* tokens.
 */
@Component({
  selector: 'app-billet-view',
  imports: [BilletBlock, BilletDivider, BilletParticles, BilletScene, FitText, Reveal],
  templateUrl: './billet-view.html',
  styleUrl: './billet-view.scss',
  providers: [RevealTimeline],
  host: {
    '[attr.lang]': 'document().lang',
    '[style]': 'rootStyle()',
    // REVEAL_CLASS: RevealTimeline.replay() toggles the same class.
    '[class.billet--reveal]': 'animate()',
    '[class.billet--frame]': "fill() === 'frame'",
  },
})
export class BilletView {
  readonly document = input.required<BilletDocument>();
  readonly model = input<ModelAssetDto | null>(null);
  /** Defaults to the document's colorMode; 'auto' follows the viewer's system. */
  readonly mode = input<BilletViewMode>();
  /** Plays the live card's entrance. */
  readonly animate = input(true);
  readonly particles = input(true);
  /** 'page' fills the viewport (public page), 'frame' its container (editor preview). */
  readonly fill = input<'page' | 'frame'>('page');
  /** How much a CSS transform magnifies the billet (the editor's preview zoom), for the 3D canvas. */
  readonly magnification = input(1);

  private readonly timeline = inject(RevealTimeline);
  private readonly systemDark = mediaQuery(PREFERS_DARK);

  protected readonly reveal = REVEAL;

  protected readonly resolvedMode = computed(() =>
    resolveBilletMode(this.mode() ?? this.document().colorMode, this.systemDark()),
  );

  protected readonly rootStyle = computed(() =>
    billetRootStyle(this.document(), this.resolvedMode()),
  );

  protected readonly blocks = computed(() => {
    const { blocks, spacing } = this.document();
    const spaces = blockSpaces(blocks, spacing.blockGap);
    return blocks.map((block, index) => ({
      block,
      space: spaces[index],
      reveal: blockReveal(index, block.type),
    }));
  });

  protected readonly showParticles = computed(
    () => this.particles() && this.document().particles.enabled,
  );

  /** Plays the entrance again from the start; does nothing while `animate` is off. */
  replay(): void {
    if (this.animate()) this.timeline.replay();
  }
}
