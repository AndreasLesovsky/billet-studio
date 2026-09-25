import type { BilletLang } from '../billet-document';
import { templateParticles, templateScene, type TemplateContent } from './template';

/** A fresh start: the original layout and scene, no text. Also the repair source of migration. */
export function blankContent(lang: BilletLang): TemplateContent {
  return {
    title: lang === 'de' ? 'Mein Billet' : 'My billet',
    pageTitle: '',
    hero: { label: '', titleLine1: '', titleLine2: '', sub: '' },
    scene: templateScene('flower-bouquet', lang),
    divider: { style: 'diamond' },
    blocks: [],
    signature: { name: '', sub: '' },
    particles: templateParticles('petal'),
  };
}
