import type { Signal } from '@angular/core';

import { frontendUrl } from '../../../core/environments/environment';
import { apiErrorCode } from '../../../core/utils/api-error';

/** What a billet's sharing looks like from outside: BilletSummaryDto / BilletDetailDto fields. */
export interface ShareFacts {
  readonly published: boolean;
  readonly hasUnpublishedChanges: boolean;
  /** Minted on the first publish and kept on unpublish, so publishing again restores the link. */
  readonly shareToken: string | null;
}

export const NOT_SHARED: ShareFacts = {
  published: false,
  hasUnpublishedChanges: false,
  shareToken: null,
};

/** The share facts of a summary or detail DTO (or the facts themselves). */
export function shareFactsOf({
  published,
  hasUnpublishedChanges,
  shareToken,
}: ShareFacts): ShareFacts {
  return { published, hasUnpublishedChanges, shareToken };
}

/**
 * A billet the share dialog works on: the list's card or the editor's open billet. Its facts
 * follow the actions, which reject with the reason (an ApiError, or a ShareFailure).
 */
export interface ShareTarget {
  readonly title: Signal<string>;
  readonly facts: Signal<ShareFacts>;
  /** Publishes the billet as its owner sees it now (the editor saves first). */
  publish(): Promise<void>;
  unpublish(): Promise<void>;
}

/** A publish that could not start; `code` is shown as MESSAGES.ERROR.<code>. */
export class ShareFailure extends Error {
  constructor(
    readonly code: 'BILLET_NOT_SAVED' | 'BILLET_NOT_FOUND' | 'BILLET_MODIFIED_ELSEWHERE',
  ) {
    super(code);
    this.name = 'ShareFailure';
  }
}

/** The MESSAGES.ERROR code the dialog shows for a failed action. */
export function shareFailureCode(error: unknown): string {
  if (error instanceof ShareFailure) return error.code;
  return apiErrorCode(error) ?? 'UNKNOWN_ERROR';
}

/**
 * private: nothing is published (Publish is the dialog's action). published: the link shows the
 * current draft. changed: the draft has moved on since ("Publish changes").
 */
export type ShareView = 'private' | 'published' | 'changed';

export interface ShareState {
  readonly view: ShareView;
  /** The link recipients open; null while nothing is published. */
  readonly link: string | null;
  /** Unpublished after an earlier publish: publishing again brings the old link back. */
  readonly reshare: boolean;
}

/** The share link, built by the frontend (docs/api-contract.md). */
function shareLink(token: string, origin: string = frontendUrl): string {
  return `${origin.replace(/\/+$/, '')}/b/${encodeURIComponent(token)}`;
}

export function shareStateOf(facts: ShareFacts, origin: string = frontendUrl): ShareState {
  const { published, hasUnpublishedChanges, shareToken } = facts;
  if (!published || shareToken === null) {
    return { view: 'private', link: null, reshare: shareToken !== null };
  }
  return {
    view: hasUnpublishedChanges ? 'changed' : 'published',
    link: shareLink(shareToken, origin),
    reshare: false,
  };
}

export interface PublishBadge {
  readonly key: string;
  readonly icon: string;
  readonly className: string;
}

const BADGES: Readonly<Record<Exclude<ShareView, 'private'>, PublishBadge>> = {
  published: { key: 'SHARE.BADGE_PUBLISHED', icon: 'bi-globe2', className: 'ui-badge--success' },
  changed: { key: 'SHARE.BADGE_CHANGED', icon: 'bi-pencil-square', className: 'ui-badge--warning' },
};

/** The one badge a billet's publish state gets; none while it is private. */
export function publishBadgeOf(facts: ShareFacts): PublishBadge | null {
  const { view } = shareStateOf(facts);
  return view === 'private' ? null : BADGES[view];
}
