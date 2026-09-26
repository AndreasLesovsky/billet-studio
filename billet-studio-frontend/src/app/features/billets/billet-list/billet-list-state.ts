import type { BilletDocument } from '../../../billet/billet-document';
import { TEMPLATES } from '../../../billet/templates/templates';
import type { BilletDetailDto, BilletSummaryDto } from '../../../core/models/models';
import { MAX_ACCOUNT_BILLETS, MAX_IMPORT_DOCUMENTS } from '../../../core/services/billet-api';
import type { LocalBilletEntry } from '../../../core/services/local-billet-store';
import { billetPresetFor } from '../../../core/theme/billet-theme-presets.generated';
import type { ColorMode } from '../../../core/theme/theme-registry.generated';
import {
  previewOf,
  type CatalogPreviews,
  type ModelPreview,
} from '../../../core/utils/model-previews';
import {
  NOT_SHARED,
  shareFactsOf,
  type ShareFacts,
} from '../../../shared/components/share-dialog/share-state';

/** The account's billets as the list has them: loading, failed, or newest edit first. */
export type AccountRows = 'loading' | 'failed' | readonly BilletSummaryDto[];

/** What a card shows of one billet, in the account or on this device. */
export interface BilletCardView {
  readonly title: string;
  readonly emoji: string;
  readonly preview: ModelPreview;
  /** The theme's colours; empty where the list does not know the theme (an account billet). */
  readonly swatches: readonly string[];
  /** "5 minutes ago", in the interface language. */
  readonly edited: string;
  readonly facts: ShareFacts;
  /** The id of the card's edit link, where the focus goes when the card before it is deleted. */
  readonly linkId: string;
}

/** A billet without a model, or whose preview is missing. */
const BLANK_EMOJI = '💌';

const MINUTE_MS = 60_000;
/** Largest unit first; under a minute reads as "this minute". */
const RELATIVE_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['day', 24 * 60 * MINUTE_MS],
  ['hour', 60 * MINUTE_MS],
  ['minute', MINUTE_MS],
];

function editedAgo(updatedAt: string, now: number, locale: string): string {
  const elapsed = Math.max(0, now - Date.parse(updatedAt));
  const [unit, size] = RELATIVE_UNITS.find(([, ms]) => elapsed >= ms) ?? RELATIVE_UNITS[2];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    -Math.floor(elapsed / size),
    unit,
  );
}

export const accountLinkId = (id: number) => `billet-list-account-${id}`;
export const localLinkId = (localId: string) => `billet-list-edit-${localId}`;

/** An account billet's card; its preview comes with the summary. */
export function accountCardOf(row: BilletSummaryDto, now: number, locale: string): BilletCardView {
  return {
    title: row.title,
    emoji: BLANK_EMOJI,
    preview: { src: row.previewUrl, pending: false },
    swatches: [],
    edited: editedAgo(row.updatedAt, now, locale),
    facts: shareFactsOf(row),
    linkId: accountLinkId(row.id),
  };
}

/** A device billet's card: its theme's colours, its model's preview as far as the catalog is known. */
export function localCardOf(
  entry: LocalBilletEntry,
  previews: CatalogPreviews,
  mode: ColorMode,
  now: number,
  locale: string,
): BilletCardView {
  const { accent, accentSoft, background, ink } = billetPresetFor(entry.theme).palette[mode];
  return {
    title: entry.title,
    emoji: entry.templateId ? TEMPLATES[entry.templateId].emoji : BLANK_EMOJI,
    preview: previewOf(previews, entry.modelSlug),
    swatches: [accent, accentSoft, background, ink],
    edited: editedAgo(entry.updatedAt, now, locale),
    facts: NOT_SHARED,
    linkId: localLinkId(entry.localId),
  };
}

/** A new account billet (a duplicate) as a row of the list. */
export function summaryOf(billet: BilletDetailDto): BilletSummaryDto {
  const { id, document, model, createdAt, updatedAt } = billet;
  return {
    id,
    title: document.title,
    modelSlug: document.scene.enabled ? document.scene.modelSlug : null,
    previewUrl: model?.previewUrl ?? null,
    ...shareFactsOf(billet),
    publishedAt: billet.publishedAt,
    createdAt,
    updatedAt,
  };
}

/** "Move all to my account", as far as the list knows. */
export interface ImportOffer {
  /** Billets that live only on this device. */
  readonly count: number;
  /** Free places in the account; null while its list is not there. */
  readonly free: number | null;
  /** The account is known and has room for the whole import. */
  readonly fits: boolean;
}

/** Null when this device holds no billets. */
export function importOffer(
  localCount: number,
  rows: AccountRows,
  max: number = MAX_ACCOUNT_BILLETS,
): ImportOffer | null {
  if (localCount === 0) return null;
  const free = typeof rows === 'string' ? null : Math.max(0, max - rows.length);
  const batch = Math.min(localCount, MAX_IMPORT_DOCUMENTS);
  return { count: localCount, free, fits: free !== null && batch <= free };
}

/** One import request: the documents and the device billets they come from. */
export interface ImportBatch {
  readonly localIds: readonly string[];
  readonly documents: BilletDocument[];
}

/**
 * What one import sends: this device's readable billets, oldest first - the account lists the
 * imported billets by id, newest first, so the device's newest stays on top - and no more than one
 * request takes. A billet whose document cannot be read stays on the device.
 */
export function importBatch(
  entries: readonly LocalBilletEntry[],
  load: (localId: string) => BilletDocument | null,
): ImportBatch {
  const localIds: string[] = [];
  const documents: BilletDocument[] = [];
  for (const { localId } of [...entries].reverse()) {
    if (documents.length === MAX_IMPORT_DOCUMENTS) break;
    const document = load(localId);
    if (!document) continue;
    localIds.push(localId);
    documents.push(document);
  }
  return { localIds, documents };
}
