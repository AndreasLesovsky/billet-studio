import { DeactivationReason } from '../../../../core/models/models';
import { toAdminReason } from '../../admin-reason';

/**
 * The body of PATCH /v1/users/{id}/active when it locks. The reason is a select value, '' for none;
 * it is optional, so the form has no rules.
 */
export interface LockUserFormModel {
  reason: string;
}

export const EMPTY_MODEL: LockUserFormModel = { reason: '' };

export function toLockReason(m: LockUserFormModel): DeactivationReason | null {
  return toAdminReason(m.reason);
}
