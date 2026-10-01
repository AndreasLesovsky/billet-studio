import { parseStartParams, START_NONE, type StartParams } from '../../../billet/billet-start';
import type { AssistBilletDto } from '../../../core/models/models';

/**
 * The start params of an offered billet (docs/assist.md): a label the start link knows passes
 * its whitelist, NONE switches off, and TEMPLATE_DEFAULT, BLANK, UI_LANGUAGE and auto leave the
 * choice to the template and the interface - exactly as a link without that param.
 */
export function startParamsOf(billet: AssistBilletDto): StartParams {
  return parseStartParams({
    get: (name) => {
      const label = billet[name];
      if (label === 'NONE') return START_NONE;
      return label === 'auto' ? null : label;
    },
  });
}
