import { Component, computed, input, signal } from '@angular/core';

import { resolveAvatarUrl } from './avatar-url';
import { getUserInitials } from './user-initials';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Round user avatar with a fallback chain: uploaded image → two-letter initials → guest icon. An
 * image that fails to load falls back to the initials. Decorative by default: the surrounding
 * control carries the accessible name; pass `alt` where the image stands alone.
 */
@Component({
  selector: 'app-user-avatar',
  host: { class: 'ui-avatar', '[class]': 'sizeClass()' },
  template: `
    @switch (mode()) {
      @case ('image') {
        <img [src]="url()" [alt]="alt()" decoding="async" (error)="failedUrl.set(url())" />
      }
      @case ('initials') {
        <span aria-hidden="true">{{ initials() }}</span>
      }
      @default {
        <i class="bi bi-person" aria-hidden="true"></i>
      }
    }
  `,
})
export class UserAvatar {
  readonly name = input<string | null | undefined>();
  readonly email = input<string | null | undefined>();
  readonly imageUrl = input<string | null | undefined>();
  readonly alt = input('');
  readonly size = input<AvatarSize>('md');

  protected readonly url = computed(() => resolveAvatarUrl(this.imageUrl()));
  protected readonly initials = computed(() => getUserInitials(this.name(), this.email()));
  protected readonly failedUrl = signal<string | null>(null);

  readonly mode = computed<'image' | 'initials' | 'guest'>(() => {
    const url = this.url();
    if (url && url !== this.failedUrl()) return 'image';
    if (this.initials()) return 'initials';
    return 'guest';
  });

  protected readonly sizeClass = computed(() => {
    const size = this.size();
    return size === 'md' ? '' : `ui-avatar--${size}`;
  });
}
