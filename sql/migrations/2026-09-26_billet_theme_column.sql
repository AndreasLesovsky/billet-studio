-- ============================================================
-- 2026-09-26 · tbl_billets.theme: the billet's theme id for the list
-- Target: db_billet_studio (after schema.sql, seed_roles.sql, seed_models.sql)
--
-- Only needed on databases created before this change; sql/schema.sql already has the column for
-- fresh databases. Run it BEFORE starting a backend built from this change: that backend reads and
-- writes the column, and fails on every billet request while it is missing.
--
-- 1. adds `theme` (a copy of document.theme, like `title` and `model_slug`), from which
--    "My billets" draws each card's colour swatches (GET /v1/billets, BilletSummaryDto.theme)
-- 2. fills it for the billets that exist already, from their draft document
--
-- Safe to run more than once: the column is added only if it is missing, and the backfill touches
-- only rows whose theme is still NULL (run it again after an older backend wrote more billets).
-- It changes neither `version` nor `updated_at`, so open editors keep their draft version.
--
-- MariaDB-only: ADD COLUMN IF NOT EXISTS. On MySQL 8 drop the "IF NOT EXISTS" and run step 1 once.
-- The backfill (JSON_EXTRACT / JSON_UNQUOTE / JSON_TYPE) runs on MariaDB 10.4+ and MySQL 8.
-- ============================================================

ALTER TABLE `tbl_billets`
  ADD COLUMN IF NOT EXISTS `theme` VARCHAR(40) NULL DEFAULT NULL
    COMMENT 'Copy of document.theme (theme id) for the list''s colour swatches; NULL = unknown, the list shows none'
    AFTER `title`;

-- A document without a string theme (not written by this application) keeps NULL: the list shows
-- no swatches for it.
UPDATE `tbl_billets`
SET `theme` = JSON_UNQUOTE(JSON_EXTRACT(`document`, '$.theme'))
WHERE `theme` IS NULL
  AND JSON_TYPE(JSON_EXTRACT(`document`, '$.theme')) = 'STRING'
  AND CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(`document`, '$.theme'))) BETWEEN 1 AND 40;
