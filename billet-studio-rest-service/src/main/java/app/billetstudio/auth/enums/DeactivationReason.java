package app.billetstudio.auth.enums;

import java.util.Arrays;
import java.util.List;

/**
 * Why an account is currently inactive. One column holds both sets because they are DISJOINT: the stored
 * value alone says whether the user left or an admin locked the account, so nothing has to derive that from
 * deletionScheduledAt. There is deliberately no admin "other" - the field is optional, and a shared OTHER
 * would be the one value that no longer reveals which side it came from.
 *
 * Each entry names its actor, and both entry points validate against it: a user cannot claim FRAUD, an
 * admin cannot claim TOO_COMPLICATED.
 */
public enum DeactivationReason {

    // Chosen by the user when deactivating their own account.
    NOT_NEEDED_ANYMORE(Actor.USER), PRIVACY_CONCERNS(Actor.USER), TOO_COMPLICATED(Actor.USER), OTHER_SERVICE(
        Actor.USER), OTHER(Actor.USER),

    // Chosen by an admin when locking an account.
    SPAM(Actor.ADMIN), FRAUD(Actor.ADMIN), TERMS_VIOLATION(Actor.ADMIN), ABUSE(Actor.ADMIN), SECURITY_RISK(
        Actor.ADMIN);

    public enum Actor {
        USER, ADMIN
    }

    private final Actor actor;

    DeactivationReason(Actor actor) {
        this.actor = actor;
    }

    public Actor getActor() { return actor; }

    public boolean isChosenBy(Actor candidate) {
        return actor == candidate;
    }

    /** The values one side may choose. Null stays allowed everywhere - the reason is optional. */
    public static List<DeactivationReason> of(Actor actor) {
        return Arrays.stream(values()).filter(r -> r.isChosenBy(actor)).toList();
    }
}
