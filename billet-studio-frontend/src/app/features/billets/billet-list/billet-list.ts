import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * "My billets", a placeholder until P7 lists server and local billets here. Open to guests: their
 * billets live on this device. "New billet" stays visible but disabled until the editor exists.
 */
@Component({
  selector: 'app-billet-list',
  imports: [TranslatePipe],
  templateUrl: './billet-list.html',
  styleUrl: './billet-list.scss',
})
export class BilletList {}
