// The emoji picker's curated set for cards: five groups of twelve, so with six columns every group
// fills whole rows and Up/Down move straight across group borders.

export interface EmojiGroup {
  readonly id: string;
  readonly titleKey: string;
  readonly emojis: readonly string[];
}

export const EMOJI_COLUMNS = 6;

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    id: 'love',
    titleKey: 'CONTROLS.EMOJI.GROUP.LOVE',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '💕', '💖', '💝', '💌', '🥰'],
  },
  {
    id: 'flowers',
    titleKey: 'CONTROLS.EMOJI.GROUP.FLOWERS',
    emojis: ['🌸', '🌷', '🌹', '🌺', '🌻', '🌼', '💐', '🌿', '🍀', '🌱', '🍃', '🦋'],
  },
  {
    id: 'celebration',
    titleKey: 'CONTROLS.EMOJI.GROUP.CELEBRATION',
    emojis: ['🎉', '🎊', '🎂', '🍰', '🧁', '🎁', '🎈', '🥂', '🍾', '🎶', '🥳', '🎀'],
  },
  {
    id: 'winter',
    titleKey: 'CONTROLS.EMOJI.GROUP.WINTER',
    emojis: ['🎄', '🎅', '🤶', '⛄', '❄️', '🌟', '🕯️', '🔔', '🦌', '🍪', '🧣', '☕'],
  },
  {
    id: 'symbols',
    titleKey: 'CONTROLS.EMOJI.GROUP.SYMBOLS',
    emojis: ['⭐', '✨', '💫', '🌙', '☀️', '🌈', '🕊️', '🦁', '🏡', '🙏', '🤗', '✉️'],
  },
];
