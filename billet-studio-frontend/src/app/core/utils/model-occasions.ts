/** How the model library's occasions (tbl_models.occasion) are labelled and pictured. */
export interface OccasionMeta {
  readonly labelKey: string;
  readonly emoji: string;
}

/** The occasions of tbl_models; an occasion missing here still filters, under its raw key. */
const OCCASIONS: Readonly<Record<string, OccasionMeta>> = {
  mothers_day: { labelKey: 'CONTROLS.ASSET.OCCASION.MOTHERS_DAY', emoji: '💐' },
  valentines: { labelKey: 'CONTROLS.ASSET.OCCASION.VALENTINES', emoji: '❤️' },
  birthday: { labelKey: 'CONTROLS.ASSET.OCCASION.BIRTHDAY', emoji: '🎂' },
  celebration: { labelKey: 'CONTROLS.ASSET.OCCASION.CELEBRATION', emoji: '🥂' },
  christmas: { labelKey: 'CONTROLS.ASSET.OCCASION.CHRISTMAS', emoji: '🎄' },
  general: { labelKey: 'CONTROLS.ASSET.OCCASION.GENERAL', emoji: '🎁' },
};

/** A model's stand-in when its occasion has no emoji of its own. */
export const FALLBACK_EMOJI = '✨';

export const occasionMeta = (key: string): OccasionMeta | null =>
  Object.hasOwn(OCCASIONS, key) ? OCCASIONS[key] : null;
