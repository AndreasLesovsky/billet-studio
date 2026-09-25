import { defineTemplate } from './template';

export const GEBURTSTAG = defineTemplate({
  nameKey: 'TEMPLATES.GEBURTSTAG',
  themeId: 'peach',
  modelSlug: 'birthday-cake',
  emoji: '🎂',
  divider: 'star',
  particles: 'confetti',
  texts: {
    de: {
      title: 'Geburtstag',
      pageTitle: 'Alles Gute zum Geburtstag',
      hero: {
        label: 'Zu deinem Geburtstag',
        titleLine1: 'Alles',
        titleLine2: 'Gute!',
        sub: 'auf ein wunderbares neues Lebensjahr',
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'Heute dreht sich alles um dich, und das völlig zu Recht. Danke für dein Lachen, deine Ideen und dafür, dass mit dir jeder Tag ein bisschen *heller* ist.',
        },
        {
          type: 'paragraph',
          text: 'Ich wünsche dir ein Jahr voller Momente, in denen du einfach glücklich bist: große Abenteuer, kleine Freuden und Menschen, die dich feiern.',
        },
        {
          type: 'card',
          icon: '🎂',
          ariaLabel: 'Ein Geburtstagswunsch',
          text: 'Kerzen auspusten, Augen zu, etwas wünschen und **nicht verraten**.\n\nDie Torte hat heute übrigens keine Kalorien.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '🎁 Dein Geschenk wartet schon, aber erst nach dem Kuchen.',
        },
      ],
      signature: { name: 'Von Herzen', sub: 'feier schön, du hast es verdient' },
    },
    en: {
      title: 'Birthday',
      pageTitle: 'Happy birthday',
      hero: {
        label: "It's your birthday",
        titleLine1: 'Happy',
        titleLine2: 'Birthday!',
        sub: "here's to a wonderful year ahead",
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'Today is all about you, and rightly so. Thank you for your laughter, your ideas and for making every day a little *brighter*.',
        },
        {
          type: 'paragraph',
          text: 'I wish you a year full of moments in which you are simply happy: big adventures, small joys and people who celebrate you.',
        },
        {
          type: 'card',
          icon: '🎂',
          ariaLabel: 'A birthday wish',
          text: 'Blow out the candles, close your eyes, make a wish and **keep it secret**.\n\nBy the way, the cake has no calories today.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '🎁 Your present is waiting, but only after the cake.',
        },
      ],
      signature: { name: 'With love', sub: 'celebrate big, you deserve it' },
    },
  },
});
