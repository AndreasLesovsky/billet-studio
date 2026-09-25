import { CdkMenu, CdkMenuGroup, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { ColorModeService, ColorModeSetting } from '../../../core/theme/color-mode-service';

interface ModeOption {
  readonly value: ColorModeSetting;
  readonly labelKey: string;
  readonly icon: string;
}

const MODE_OPTIONS: readonly ModeOption[] = [
  { value: 'system', labelKey: 'COLOR_MODE.SYSTEM', icon: 'bi-circle-half' },
  { value: 'light', labelKey: 'COLOR_MODE.LIGHT', icon: 'bi-sun' },
  { value: 'dark', labelKey: 'COLOR_MODE.DARK', icon: 'bi-moon-stars' },
];

/** Below the trigger, right edges aligned; above it when there is no room below. */
const MENU_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
];

/**
 * The header's colour-mode switch: an icon button showing the current setting, opening a CDK menu
 * of System / Light / Dark as menuitemradio (arrow keys, Esc, focus back to the trigger). The site
 * has one fixed design, so this is its only appearance control.
 */
@Component({
  selector: 'app-color-mode-menu',
  imports: [CdkMenu, CdkMenuGroup, CdkMenuItemRadio, CdkMenuTrigger, TranslatePipe],
  template: `
    <button
      type="button"
      class="ui-btn ui-btn--ghost ui-btn--icon"
      [cdkMenuTriggerFor]="menu"
      [cdkMenuPosition]="positions"
      [attr.aria-label]="
        'COLOR_MODE.TRIGGER' | translate: { mode: (current().labelKey | translate) }
      "
    >
      <i class="bi" [class]="current().icon" aria-hidden="true"></i>
    </button>

    <ng-template #menu>
      <div
        class="ui-menu color-mode-menu__panel"
        cdkMenu
        [attr.aria-label]="'COLOR_MODE.LABEL' | translate"
      >
        <div cdkMenuGroup>
          @for (option of options; track option.value) {
            <button
              type="button"
              class="ui-menu__item"
              cdkMenuItemRadio
              [cdkMenuItemChecked]="mode() === option.value"
              (cdkMenuItemTriggered)="select(option.value)"
            >
              <i class="bi" [class]="option.icon" aria-hidden="true"></i>
              {{ option.labelKey | translate }}
              <i class="bi bi-check2 ui-menu__check" aria-hidden="true"></i>
            </button>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: `
    .color-mode-menu__panel {
      min-inline-size: 10rem;
      margin-block: var(--ui-space-2);
    }
  `,
})
export class ColorModeMenu {
  private readonly colorMode = inject(ColorModeService);

  protected readonly options = MODE_OPTIONS;
  protected readonly positions = MENU_POSITIONS;
  protected readonly mode = this.colorMode.mode;
  protected readonly current = computed(
    () => MODE_OPTIONS.find((o) => o.value === this.mode()) ?? MODE_OPTIONS[0],
  );

  protected select(mode: ColorModeSetting): void {
    this.colorMode.setMode(mode);
  }
}
