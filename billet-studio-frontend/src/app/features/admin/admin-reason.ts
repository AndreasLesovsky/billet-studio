import { ADMIN_DEACTIVATION_REASONS, DeactivationReason } from '../../core/models/models';

/**
 * A select value as an admin-actor reason. Anything else - '' for "no reason", or a reason the user
 * chose when deactivating themselves - is null: the backend accepts only the admin's own values here.
 */
export function toAdminReason(value: string | null): DeactivationReason | null {
  return ADMIN_DEACTIVATION_REASONS.find((reason) => reason === value) ?? null;
}
