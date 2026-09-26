// The story's chapters, in their own module: the home chunk needs only these names, the parsing
// in hero-framing.ts belongs to the lazy hero chunk.

/** The three chapters, in story order (i18n HOME.CHAPTER_<ID>_TITLE / _TEXT). */
export const BEAT_IDS = ['write', 'gift', 'share'] as const;
export type BeatId = (typeof BEAT_IDS)[number];
