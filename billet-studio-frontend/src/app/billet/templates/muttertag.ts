import { defineTemplate } from './template';

/** The original card's design and layout (theme rose = the live card), with generic words. */
export const MUTTERTAG = defineTemplate({
  nameKey: 'TEMPLATES.MUTTERTAG',
  themeId: 'rose',
  modelSlug: 'flower-bouquet',
  emoji: '💐',
  divider: 'diamond',
  particles: 'petal',
  texts: {
    de: {
      title: 'Muttertag für Mama',
      pageTitle: 'Für Mama · Muttertag',
      hero: {
        label: 'Alles Liebe zum Muttertag',
        titleLine1: 'Für',
        titleLine2: 'Mama',
        sub: 'mit ganz viel Liebe',
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'Du warst immer da – an den leichten Tagen und an den schweren. Deine Geduld, dein Lachen und deine stille Stärke begleiten mich bis heute, und ich *bewundere* sie jeden Tag ein bisschen mehr.',
        },
        {
          type: 'paragraph',
          text: 'Danke für alles, was du mir mitgegeben hast. Vieles davon verstehe ich erst jetzt, und umso dankbarer bin ich, dass du meine Mama bist.',
        },
        {
          type: 'card',
          icon: '🌸',
          ariaLabel: 'Ein kleines Dankeschön',
          text: 'Für die Pflaster auf aufgeschlagenen Knien, die besten Ratschläge und das Essen, das nirgends so gut schmeckt wie bei dir: **danke**.\n\nDu bist und bleibst die Größte.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '💐 Heute darfst du einfach mal die Füße hochlegen – der Rest ist erledigt.',
        },
      ],
      signature: { name: 'In Liebe', sub: 'dein Kind, für immer dankbar' },
    },
    en: {
      title: "Mother's Day for Mom",
      pageTitle: "For Mom · Mother's Day",
      hero: {
        label: "Happy Mother's Day",
        titleLine1: 'For',
        titleLine2: 'Mom',
        sub: 'with all my love',
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'You were always there – on the easy days and on the hard ones. Your patience, your laughter and your quiet strength are still with me, and I *admire* them a little more every day.',
        },
        {
          type: 'paragraph',
          text: 'Thank you for everything you have given me. Much of it I only understand now, and it makes me all the more grateful that you are my mom.',
        },
        {
          type: 'card',
          icon: '🌸',
          ariaLabel: 'A little thank-you',
          text: 'For the band-aids on scraped knees, the best advice and the food that tastes better at your table than anywhere else: **thank you**.\n\nYou are, and always will be, the best.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '💐 Today you get to put your feet up – everything else is taken care of.',
        },
      ],
      signature: { name: 'With love', sub: 'your ever-grateful child' },
    },
  },
});
