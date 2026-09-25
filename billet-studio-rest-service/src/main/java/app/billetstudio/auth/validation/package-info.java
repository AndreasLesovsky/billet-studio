/**
 * The single source of each user-field rule, shared by every write path. {@code @NullMarked}: null inputs are
 * declared {@code @Nullable} and simply fail the rule.
 */
@NullMarked
package app.billetstudio.auth.validation;

import org.jspecify.annotations.NullMarked;
