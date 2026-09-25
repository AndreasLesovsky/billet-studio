import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * No chrome at all: the shared billet page (/b/:token) is the recipient's view of a billet, not the
 * app. Toasts and the confirmation dialog still come from the root component; the page shows its
 * own loading state (it has no header, so no global activity bar).
 */
@Component({
  selector: 'app-bare-layout',
  imports: [RouterOutlet],
  template: `
    <main id="main-content" class="bare">
      <router-outlet />
    </main>
  `,
  styles: `
    :host,
    .bare {
      display: flex;
      flex-direction: column;
      min-block-size: 100dvh;
    }

    .bare {
      flex: 1;
    }
  `,
})
export class BareLayout {}
