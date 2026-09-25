import { defineTemplate } from './template';

export const HOCHZEIT = defineTemplate({
  nameKey: 'TEMPLATES.HOCHZEIT',
  themeId: 'dune',
  modelSlug: 'champagne-bottle',
  emoji: '💍',
  divider: 'diamond',
  particles: 'petal',
  texts: {
    de: {
      title: 'Hochzeit',
      pageTitle: 'Alles Gute zur Hochzeit',
      hero: {
        label: 'Zu eurer Hochzeit',
        titleLine1: 'Auf',
        titleLine2: 'euch zwei',
        sub: 'und eure gemeinsame Geschichte',
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'Heute sagt ihr Ja: zueinander, zu allem, was kommt, und zu einem Leben, das ihr gemeinsam gestaltet. Wie schön, dass wir dabei sein dürfen.',
        },
        {
          type: 'paragraph',
          text: 'Wir wünschen euch Geduld für die grauen Tage, Mut für die großen Schritte und unzählige Momente, in denen ihr euch anseht und *einfach wisst*.',
        },
        {
          type: 'card',
          icon: '💍',
          ariaLabel: 'Ein Rat fürs Eheleben',
          text: 'Streitet nie hungrig. Tanzt öfter in der Küche. Und lasst den anderen **ab und zu** gewinnen.\n\nDer Rest findet sich.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '🥂 Auf die Liebe und auf euch!',
        },
      ],
      signature: { name: 'Von Herzen', sub: 'alles Liebe für euren großen Tag' },
    },
    en: {
      title: 'Wedding',
      pageTitle: 'Congratulations on your wedding',
      hero: {
        label: 'On your wedding day',
        titleLine1: "Here's to",
        titleLine2: 'you two',
        sub: 'and the story you will write together',
      },
      blocks: [
        {
          type: 'paragraph',
          text: 'Today you say yes: to each other, to everything that lies ahead and to a life you will shape together. How wonderful that we get to be part of it.',
        },
        {
          type: 'paragraph',
          text: 'We wish you patience for the gray days, courage for the big steps and countless moments in which you look at each other and *simply know*.',
        },
        {
          type: 'card',
          icon: '💍',
          ariaLabel: 'A tip for married life',
          text: 'Never argue on an empty stomach. Dance in the kitchen more often. And let the other one win **every now and then**.\n\nThe rest will follow.',
        },
        {
          type: 'note',
          spaceAdjust: -1,
          text: '🥂 To love, and to you!',
        },
      ],
      signature: { name: 'With love', sub: 'all the best for your big day' },
    },
  },
});
