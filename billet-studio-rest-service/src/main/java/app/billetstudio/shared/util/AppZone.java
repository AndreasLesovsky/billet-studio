package app.billetstudio.shared.util;

import java.time.ZoneId;

/**
 * The wall clock a reader of this app means by "the 22nd": Europe/Vienna, the home market (same zone as the
 * CommerceX ShopZone).
 *
 * Only for text a person reads outside the browser, such as the deletion date in a mail. Stored moments stay
 * {@code Instant} in UTC, schedulers run in UTC, and the API sends instants that the browser renders in the
 * reader's own zone.
 */
public final class AppZone {

    public static final ZoneId ZONE = ZoneId.of("Europe/Vienna");

    private AppZone() {
    }
}
