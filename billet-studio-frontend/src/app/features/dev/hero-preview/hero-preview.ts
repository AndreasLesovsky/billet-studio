import {
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, type ParamMap } from '@angular/router';

import { HeroChapters } from '../../home/hero-story/hero-chapters';
import { HeroStory } from '../../home/hero-story/hero-story';
import {
  HERO_STORY_OPTIONS,
  HeroStoryController,
  type HeroStoryOptions,
} from '../../home/hero-story/hero-story-controller';
import { afterFrames } from '../hero-capture/hero-capture-ready';

/** What a capture or an inspection script waits for (H7 poster capture). */
interface HeroStoryProbe {
  readonly ready: boolean;
  readonly status: string;
}

declare global {
  interface Window {
    __heroStory?: HeroStoryProbe;
  }
}

const MEMORY_POLL_MS = 500;

function flag(params: ParamMap, name: string): boolean {
  const value = params.get(name);
  return value !== null && value !== '0' && value !== 'false';
}

function oneOf<T extends string>(values: readonly T[], value: string | null): T | undefined {
  return values.find((candidate) => candidate === value);
}

function storyTime(value: string | null): number | 'end' | undefined {
  if (value === 'end') return 'end';
  return value !== null && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

/** A path on this origin only (a GLB under public/). */
function sameOriginPath(value: string | null): string | undefined {
  return value?.startsWith('/') && !value.startsWith('//') ? value : undefined;
}

/** `?t=<seconds>|end&lang=de|en&mode=light|dark&debug&capture&story=<path>`; unknown values are ignored. */
function parseOptions(params: ParamMap): HeroStoryOptions {
  return {
    storyUrl: sameOriginPath(params.get('story')),
    time: storyTime(params.get('t')),
    lang: oneOf(['de', 'en'], params.get('lang')),
    mode: oneOf(['light', 'dark'], params.get('mode')),
    debug: flag(params, 'debug'),
    capture: flag(params, 'capture'),
  };
}

/**
 * Dev only (/dev/hero): the home page's 3D story alone, for inspection and the coming poster
 * capture. `t` fixes the story time (paused; `end` = the idle pose), `aspect` the stage's
 * width / height (the authored frame must stay whole), `lang` / `mode` the textures, `debug`
 * three's shader checks plus the stage's state and GPU memory, `capture` a readable drawing
 * buffer, `story` another story GLB (a raw export under test). window.__heroStory reports when the requested frame is drawn.
 */
@Component({
  selector: 'app-hero-preview',
  imports: [HeroChapters, HeroStory],
  providers: [
    HeroStoryController,
    {
      provide: HERO_STORY_OPTIONS,
      useFactory: () => parseOptions(inject(ActivatedRoute).snapshot.queryParamMap),
    },
  ],
  templateUrl: './hero-preview.html',
  styleUrl: './hero-preview.scss',
})
export class HeroPreview {
  readonly aspect = input<string>();

  protected readonly controller = inject(HeroStoryController);
  protected readonly debug = !!inject(HERO_STORY_OPTIONS).debug;
  protected readonly stageAspect = computed(() => {
    const aspect = Number(this.aspect());
    return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  });
  protected readonly state = signal('');

  constructor() {
    const view = inject(DOCUMENT).defaultView;
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const status = this.controller.status();
      if (!view) return;
      if (status !== 'ready') {
        view.__heroStory = { ready: status === 'fallback', status };
        return;
      }
      // The seeked frame is drawn on the next animation frame.
      void afterFrames(view, 2).then(() => (view.__heroStory = { ready: true, status }));
    });
    if (this.debug) {
      const timer = setInterval(() => this.state.set(this.describe()), MEMORY_POLL_MS);
      destroyRef.onDestroy(() => clearInterval(timer));
    }
  }

  private describe(): string {
    const controller = this.controller;
    return JSON.stringify(
      {
        status: controller.status(),
        beat: controller.beat(),
        phase: controller.phase(),
        playing: controller.playing(),
        occasion: controller.occasion(),
        memory: controller.memory(),
      },
      null,
      2,
    );
  }
}
