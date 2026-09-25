import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { injectTemplateCards } from '../../../core/utils/template-cards';
import { AssetThumb } from '../../../shared/components/asset-thumb/asset-thumb';

/**
 * Every billet template with its 3D model, theme colours and a short description. "Use template"
 * stays visible but disabled until the editor exists.
 */
@Component({
  selector: 'app-template-gallery',
  imports: [AssetThumb, TranslatePipe],
  templateUrl: './template-gallery.html',
  styleUrl: './template-gallery.scss',
})
export class TemplateGallery {
  protected readonly cards = injectTemplateCards();
}
