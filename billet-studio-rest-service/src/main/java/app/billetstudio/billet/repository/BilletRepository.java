package app.billetstudio.billet.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import app.billetstudio.billet.entity.Billet;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface BilletRepository extends JpaRepository<Billet, Long> {

    /** Ownership is part of the lookup, so another user's id is simply not found. */
    Optional<Billet> findByIdAndUserId(Long id, Long userId);

    /** The same lookup, row-locked until commit. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT b FROM Billet b WHERE b.id = :id AND b.user.id = :userId")
    Optional<Billet> findOwnedForUpdate(@Param("id") Long id, @Param("userId") Long userId);

    long countByUserId(Long userId);

    /**
     * The user's list, newest first, without loading the two LONGTEXT documents. MD5 instead of comparing the columns:
     * their collation (utf8mb4_unicode_ci) calls "Mama" and "mama" equal, and a changed letter case is still an
     * unpublished change.
     */
    @Query("SELECT new app.billetstudio.billet.repository.BilletSummaryRow(b.id, b.title, b.modelSlug, "
        + "b.shareToken, b.publishedAt, b.createdAt, b.updatedAt, "
        + "CASE WHEN b.publishedDocument IS NULL THEN false "
        + "WHEN function('md5', b.document) = function('md5', b.publishedDocument) THEN false "
        + "ELSE true END) "
        + "FROM Billet b WHERE b.user.id = :userId ORDER BY b.updatedAt DESC, b.id DESC")
    List<BilletSummaryRow> findSummariesByUserId(@Param("userId") Long userId);

    /**
     * Public link: published, and only while the owner's account is active - an admin lock or a self-deactivation
     * (also while it awaits deletion) takes the shared pages offline with it, a reactivation brings them back.
     */
    @Query("SELECT b FROM Billet b WHERE b.shareToken = :shareToken AND b.publishedDocument IS NOT NULL "
        + "AND b.user.active = true")
    Optional<Billet> findPublishedByShareToken(@Param("shareToken") String shareToken);

    /**
     * A bulk statement on purpose: it leaves the draft version alone (the client gets no new one from a 204) and
     * cannot lose a race against an autosave.
     */
    @Modifying
    @Query("UPDATE Billet b SET b.publishedDocument = NULL, b.publishedAt = NULL, b.updatedAt = :now "
        + "WHERE b.id = :id AND b.user.id = :userId")
    int unpublish(@Param("id") Long id, @Param("userId") Long userId, @Param("now") Instant now);

    /** A bulk statement, so a delete is never refused because an autosave bumped the version meanwhile. */
    @Modifying
    @Query("DELETE FROM Billet b WHERE b.id = :id AND b.user.id = :userId")
    int deleteOwned(@Param("id") Long id, @Param("userId") Long userId);

    /**
     * Row lock on the owner, held until commit: serialises a user's creates, so two parallel requests cannot both
     * pass the per-user cap. No plain read may precede it in the transaction - InnoDB's REPEATABLE READ snapshot starts
     * at the first plain read, and the count after the lock has to see a billet a parallel request just committed.
     */
    @Query(value = "SELECT id FROM tbl_users WHERE id = :userId FOR UPDATE", nativeQuery = true)
    Long lockOwner(@Param("userId") Long userId);
}
