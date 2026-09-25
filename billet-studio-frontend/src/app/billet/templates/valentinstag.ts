import { defineTemplate, SEPARATOR } from './template';

export const VALENTINSTAG = defineTemplate({
  nameKey: 'TEMPLATES.VALENTINSTAG',
  themeId: 'sakura',
  modelSlug: 'heart-emoji',
  emoji: '💝',
  divider: 'heart',
  particles: 'heart',
  texts: {
    de: {
      title: 'Valentinstag',
      pageTitle: 'Für dich · Valentinstag',
      hero: {
        label: `14. Februar${SEPARATOR}Valentinstag`,
        titleLine1: 'Für dich,',
        titleLine2: 'mein Herz',
        sub: 'weil jeder Tag mit dir zählt',
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'Mit dir fühlt sich selbst ein ganz gewöhnlicher Dienstag wie ein kleines Fest an. Du bringst mich zum Lachen, wenn ich es am wenigsten erwarte, und hältst mich fest, wenn ich es am meisten brauche.',
        },
        {
          type: 'paragraph',
          text: 'Ich liebe unsere *kleinen Rituale*: den ersten Kaffee am Morgen, die Nachrichten zwischendurch und das Gefühl, bei dir angekommen zu sein.',
        },
        {
          type: 'card',
          icon: '🌹',
          ariaLabel: 'Ein kleines Geständnis',
          text: 'Ich gebe es zu: Du hattest **fast immer** recht.\n\nNur über das letzte Stück Schokolade verhandeln wir noch.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '💌 Heute Abend gehört nur uns. Der Tisch ist schon reserviert.',
        },
      ],
      signature: { name: 'Für immer dein', sub: 'heute, morgen und an allen Tagen danach' },
    },
    en: {
      title: "Valentine's Day",
      pageTitle: "For you · Valentine's Day",
      hero: {
        label: `February 14${SEPARATOR}Valentine's Day`,
        titleLine1: 'For you,',
        titleLine2: 'my love',
        sub: 'because every day with you counts',
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'With you, even an ordinary Tuesday feels like a small celebration. You make me laugh when I least expect it and hold me close when I need it most.',
        },
        {
          type: 'paragraph',
          text: 'I love our *little rituals*: the first coffee in the morning, the messages in between and the feeling of coming home to you.',
        },
        {
          type: 'card',
          icon: '🌹',
          ariaLabel: 'A small confession',
          text: 'I admit it: you were right **almost every time**.\n\nWe are still negotiating the last piece of chocolate, though.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '💌 Tonight is just for us. The table is already booked.',
        },
      ],
      signature: { name: 'Forever yours', sub: 'today, tomorrow and every day after' },
    },
  },
});
