import { defineTemplate } from './template';

export const WEIHNACHTEN = defineTemplate({
  nameKey: 'TEMPLATES.WEIHNACHTEN',
  themeId: 'midnight',
  modelSlug: 'snow-globe',
  emoji: '🎄',
  divider: 'star',
  particles: 'snowflake',
  texts: {
    de: {
      title: 'Weihnachten',
      pageTitle: 'Frohe Weihnachten',
      hero: {
        label: 'Zum Fest der Liebe',
        titleLine1: 'Frohe',
        titleLine2: 'Weihnachten',
        sub: 'und ein leuchtendes neues Jahr',
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'Wenn draußen der erste Schnee fällt und drinnen die Kerzen brennen, merke ich jedes Jahr aufs Neue, was wirklich zählt: *Zeit* mit den Menschen, die man liebt.',
        },
        {
          type: 'paragraph',
          text: 'Danke, dass du dazugehörst. Ich wünsche dir ruhige Tage, warme Hände und ganz viele Gründe zum Lächeln.',
        },
        {
          type: 'card',
          icon: '🎄',
          ariaLabel: 'Ein Weihnachtsgruß',
          text: 'Plätzchen: **gebacken**. Geschenke: **eingepackt**. Lichterkette: fast entwirrt.\n\nJetzt fehlt nur noch, dass wir gemeinsam anstoßen.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '✨ Der Punsch ist warm, du musst nur noch vorbeikommen.',
        },
      ],
      signature: { name: 'Herzlichst', sub: 'frohe Festtage und einen guten Rutsch' },
    },
    en: {
      title: 'Christmas',
      pageTitle: 'Merry Christmas',
      hero: {
        label: "Season's greetings",
        titleLine1: 'Merry',
        titleLine2: 'Christmas',
        sub: 'and a bright New Year',
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'When the first snow falls outside and the candles glow inside, I realize every year what truly matters: *time* with the people you love.',
        },
        {
          type: 'paragraph',
          text: 'Thank you for being part of it. I wish you peaceful days, warm hands and plenty of reasons to smile.',
        },
        {
          type: 'card',
          icon: '🎄',
          ariaLabel: 'A Christmas greeting',
          text: 'Cookies: **baked**. Presents: **wrapped**. Fairy lights: almost untangled.\n\nAll that is missing now is a toast together.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '✨ The punch is warm, all you have to do is drop by.',
        },
      ],
      signature: { name: 'Warmly', sub: 'happy holidays and a happy New Year' },
    },
  },
});
