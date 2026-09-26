import { Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import { BEAT_IDS } from './hero-beats';
import { HeroStoryController } from './hero-story-controller';

interface Chapter {
  readonly titleKey: string;
  readonly textKey: string;
}

const CHAPTERS: readonly Chapter[] = BEAT_IDS.map((id) => ({
  titleKey: `HOME.CHAPTER_${id.toUpperCase()}_TITLE`,
  textKey: `HOME.CHAPTER_${id.toUpperCase()}_TEXT`,
}));

/**
 * The story's three beats as text beside the stage: the one playing is marked, a click jumps to
 * it. Without 3D (no story, no WebGL) they are plain text.
 */
@Component({
  selector: 'app-hero-chapters',
  imports: [NgTemplateOutlet, TranslatePipe],
  template: `
    <ol class="ui-hero-chapters" role="list">
      @for (chapter of chapters; track chapter.titleKey; let index = $index) {
        <li>
          @if (interactive()) {
            <button
              type="button"
              class="ui-hero-chapter"
              [attr.aria-current]="active() === index ? 'step' : null"
              (click)="controller.seekBeat(index)"
            >
              <ng-container *ngTemplateOutlet="content; context: { $implicit: chapter, index }" />
            </button>
          } @else {
            <div class="ui-hero-chapter">
              <ng-container *ngTemplateOutlet="content; context: { $implicit: chapter, index }" />
            </div>
          }
        </li>
      }
    </ol>

    <ng-template #content let-chapter let-index="index">
      <span class="ui-hero-chapter__index" aria-hidden="true">{{ index + 1 }}</span>
      <span class="ui-hero-chapter__body">
        <span class="ui-hero-chapter__title">{{ chapter.titleKey | translate }}</span>
        <span class="ui-hero-chapter__text">{{ chapter.textKey | translate }}</span>
      </span>
    </ng-template>
  `,
})
export class HeroChapters {
  protected readonly controller = inject(HeroStoryController);
  protected readonly chapters = CHAPTERS;

  protected readonly interactive = computed(() => this.controller.status() !== 'fallback');
  /** Marked only while the 3D shows the story; -1 before. */
  protected readonly active = computed(() =>
    this.controller.status() === 'ready' ? this.controller.beat() : -1,
  );
}
