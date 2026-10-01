import { describe, expect, it } from 'vitest';

import { startQuery } from '../../../billet/billet-start';
import { startParamsOf } from './assist-start';

describe('startParamsOf', () => {
  it('turns the labels of an offered billet into the start link', () => {
    expect(
      startQuery(
        startParamsOf({
          template: 'geburtstag',
          theme: 'midnight',
          particles: 'NONE',
          divider: 'star',
          colorMode: 'dark',
          lang: 'en',
          model: 'champagne-bottle',
        }),
      ),
    ).toEqual({
      template: 'geburtstag',
      theme: 'midnight',
      particles: 'none',
      divider: 'star',
      colorMode: 'dark',
      lang: 'en',
      model: 'champagne-bottle',
    });
  });

  it('leaves template defaults, the blank start, auto and the interface language out', () => {
    expect(
      startQuery(
        startParamsOf({
          template: 'BLANK',
          theme: 'TEMPLATE_DEFAULT',
          particles: 'TEMPLATE_DEFAULT',
          divider: 'TEMPLATE_DEFAULT',
          colorMode: 'auto',
          lang: 'UI_LANGUAGE',
          model: 'NONE',
        }),
      ),
    ).toEqual({ model: 'none' });
  });
});
