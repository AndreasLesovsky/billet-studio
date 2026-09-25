import { pattern, required, schema } from '@angular/forms/signals';

import { HEX_INPUT_PATTERN } from './color-math';

/** The picker's hex field: typed text, written to the colour only once it reads as a colour. */
export interface HexFormModel {
  hex: string;
}

export const hexSchema = schema<HexFormModel>((p) => {
  required(p.hex, { message: 'CONTROLS.COLOR.HEX_REQUIRED' });
  pattern(p.hex, HEX_INPUT_PATTERN, { message: 'CONTROLS.COLOR.HEX_INVALID' });
});
