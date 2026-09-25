package app.billetstudio.shared.dto;

import java.util.List;
import java.util.function.Function;

import org.springframework.data.domain.Page;

/** One page of a server-side paged list; page is zero-based. */
public record PageDto<T>(List<T> rows, long totalRows, int page, int size) {

    public static <E, T> PageDto<T> of(Page<E> page, Function<E, T> mapper) {
        return new PageDto<>(page.getContent().stream().map(mapper).toList(), page.getTotalElements(),
            page.getNumber(), page.getSize());
    }
}
