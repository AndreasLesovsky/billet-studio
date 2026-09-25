import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { injectTemplateCards } from '../../../core/utils/template-cards';
import { AssetThumb } from '../../../shared/components/asset-thumb/asset-thumb';

/**
 * Every billet template with its 3D model, theme colours and a short description. "Use template"
 * opens /billets/new?template=<id>, which stores the billet and opens its editor; a link starts
 * blank.
 */
@Component({
  selector: 'app-template-gallery',
  imports: [AssetThumb, RouterLink, TranslatePipe],
  templateUrl: './template-gallery.html',
  styleUrl: './template-gallery.scss',
})
export class TemplateGallery {
  protected readonly cards = injectTemplateCards();
}
