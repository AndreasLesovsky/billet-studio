package app.billetstudio.billet.dto;

import java.util.List;

public record BilletImportResponse(List<BilletSummaryDto> billets) {
}
