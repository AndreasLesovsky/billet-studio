import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthApi } from '../../core/services/auth-api';
import { injectTemplateCards } from '../../core/utils/template-cards';
import { AssetThumb } from '../../shared/components/asset-thumb/asset-thumb';
import { HeroChapters } from './hero-story/hero-chapters';
import { HeroStory } from './hero-story/hero-story';
import { HeroStoryController } from './hero-story/hero-story-controller';

/** The teaser row fits five cards; the gallery at /templates shows them all. */
const TEASER_COUNT = 5;

/**
 * Landing page: the hero (headline, the story's chapters, the actions and the 3D story beside
 * them) and a teaser row of templates (each starts a billet from its template). "New billet"
 * leads to the template gallery.
 */
@Component({
  selector: 'app-home',
  imports: [AssetThumb, HeroChapters, HeroStory, RouterLink, TranslatePipe],
  providers: [HeroStoryController],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  protected readonly isLoggedIn = inject(AuthApi).isLoggedIn;
  /** Without a built story the hero is text only, laid out in one column from the start. */
  protected readonly staged = inject(HeroStoryController).available;

  private readonly templateCards = injectTemplateCards();
  protected readonly templates = computed(() => this.templateCards().slice(0, TEASER_COUNT));
}
