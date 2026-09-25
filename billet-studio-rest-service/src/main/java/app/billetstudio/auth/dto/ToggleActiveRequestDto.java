package app.billetstudio.auth.dto;

import app.billetstudio.auth.enums.DeactivationReason;

/**
 * Optional body of the admin active toggle. The reason rides along with the switch rather than being editable
 * on its own, so a reason can never exist without the deactivation that produced it. Body and reason are both
 * optional: activating sends nothing, and locking without stating a reason is allowed.
 */
public record ToggleActiveRequestDto(DeactivationReason reason) {
}
