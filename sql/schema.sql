-- ============================================================
-- billet-studio - full schema (fresh create)
-- Target database: db_billet_studio (utf8mb4 / utf8mb4_unicode_ci)
-- Compatible with: MariaDB 10.4+ and MySQL 8.0.16+ (CHECK constraints are enforced by both)
--
-- How to run (manually, the schema is never created by the application - ddl-auto: none):
--   1. CREATE DATABASE db_billet_studio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   2. select db_billet_studio and import this file (phpMyAdmin), or
--      mysql -u root -p db_billet_studio < sql/schema.sql
--   3. seed_roles.sql, then seed_models.sql (see sql/README.md)
-- The file names no database on purpose, so the integration tests can load it into a container DB.
--
-- Time: every DATETIME holds UTC and is written by the application (hibernate.jdbc.time_zone = UTC,
-- entities stamp created_at/updated_at themselves). No column has a clock DEFAULT: the database
-- server may run in another zone, and a second writer with its own clock is exactly what this rules
-- out. DATETIME instead of TIMESTAMP: no session-timezone conversion, no 2038 limit.
--
-- Constraint names are table-prefixed because MySQL scopes CHECK and FOREIGN KEY names to the
-- whole database, not to the table.
-- Later changes never edit this file alone: they go to sql/migrations/<YYYY-MM-DD>_<name>.sql and
-- are folded in here in the same commit.
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- Roles. IDs are fixed (seed_roles.sql): 1 = ROLE_USER, 2 = ROLE_ADMIN.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tbl_roles` (
  `id`          BIGINT UNSIGNED NOT NULL,
  `name`        VARCHAR(50)     NOT NULL,
  `description` VARCHAR(200)    NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_roles_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Users
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tbl_users` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`                  VARCHAR(100)    NOT NULL,
  `email`                 VARCHAR(150)    NOT NULL,
  `preferred_language`    VARCHAR(5)      NOT NULL DEFAULT 'de' COMMENT 'UI and mail language',
  `avatar_url`            VARCHAR(500)    NULL DEFAULT NULL,
  `password_hash`         VARCHAR(255)    NOT NULL,
  `role_id`               BIGINT UNSIGNED NOT NULL COMMENT 'No DEFAULT: the application always names the role',
  `reset_token_hash`      CHAR(64)        NULL DEFAULT NULL COMMENT 'SHA-256 hash of the reset token; the raw value is never stored',
  `reset_token_expiry`    DATETIME        NULL DEFAULT NULL COMMENT 'Token expires after this timestamp',
  `active`                TINYINT(1)      NOT NULL DEFAULT 1 COMMENT 'Soft-delete flag, false when user deactivated their account',
  `deactivated_at`        DATETIME        NULL DEFAULT NULL COMMENT 'Timestamp when user deactivated (auto-reactivated on next login)',
  `deletion_scheduled_at` DATETIME        NULL DEFAULT NULL COMMENT 'Hard-delete date (deactivated_at + 30 days), cleared on login',
  `deactivation_reason`   VARCHAR(50)     NULL DEFAULT NULL COMMENT 'Reason selected at deactivation (enum), kept for stats after delete',
  `is_protected`          TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'Root / break-glass admin; only RootUserBootstrap sets it, destructive admin paths refuse the row',
  `created_at`            DATETIME        NOT NULL,
  `updated_at`            DATETIME        NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_email` (`email`),
  UNIQUE KEY `uk_users_reset_token_hash` (`reset_token_hash`),
  KEY `idx_users_role` (`role_id`),
  KEY `idx_users_deletion_scheduled` (`deletion_scheduled_at`),
  KEY `idx_users_active` (`active`),
  CONSTRAINT `chk_users_preferred_language` CHECK (`preferred_language` IN ('de', 'en')),
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `tbl_roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Auth sessions (refresh tokens), 1:1 from CommerceX. The row IS the session: while it exists and
-- neither deadline has passed, its refresh token can mint access tokens; delete it and the session
-- is over.
-- - token_hash stores SHA-256 of the raw token, NEVER the token (a dump must not hand out live
--   sessions). UNIQUE because it is the lookup key on every refresh.
-- - idle_expires_at moves forward on every refresh; absolute_expires_at is written once at login
--   and never touched again.
-- - No rotation columns: the refresh token is not single-use, so several tabs can refresh at once.
-- - No ip / user_agent: personal data with no reader today.
-- - user_id CASCADE: a deleted account must take its sessions with it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tbl_auth_sessions` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT UNSIGNED NOT NULL,
  `token_hash`          CHAR(64)        NOT NULL COMMENT 'SHA-256 of the refresh token; the raw value is never stored',
  `idle_expires_at`     DATETIME        NOT NULL COMMENT 'Moved forward on every refresh',
  `absolute_expires_at` DATETIME        NOT NULL COMMENT 'Written at login, never extended',
  `created_at`          DATETIME        NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_sessions_token_hash` (`token_hash`),
  KEY `idx_auth_sessions_user` (`user_id`),
  KEY `idx_auth_sessions_expiry` (`idle_expires_at`, `absolute_expires_at`),
  CONSTRAINT `fk_auth_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `tbl_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 3D model catalog. Rows are generated by tools/asset-pipeline (seed_models.sql).
-- Paths are RELATIVE to app.models.base-url, so moving the files (Angular public/models today,
-- backend file system later) is a config change, never an UPDATE.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tbl_models` (
  `id`                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `slug`              VARCHAR(60)       NOT NULL COMMENT 'Stable key stored inside billet documents - never rename',
  `name_de`           VARCHAR(100)      NOT NULL,
  `name_en`           VARCHAR(100)      NOT NULL,
  `occasion`          VARCHAR(30)       NOT NULL COMMENT 'Library grouping key, e.g. birthday, christmas',
  `file_path`         VARCHAR(255)      NOT NULL COMMENT 'GLB path relative to app.models.base-url, e.g. models/<slug>.v1.glb',
  `preview_path`      VARCHAR(255)      NOT NULL COMMENT 'WebP thumbnail path relative to app.models.base-url',
  `file_size_bytes`   INT UNSIGNED      NOT NULL,
  `fit_size`          DECIMAL(4,2)      NOT NULL DEFAULT 1.60 COMMENT 'Default scene: the model is scaled so its largest bounding-box edge has this length',
  `y_offset`          DECIMAL(4,2)      NOT NULL DEFAULT -0.08,
  `exposure`          DECIMAL(4,2)      NOT NULL DEFAULT 0.60,
  `camera_distance`   DECIMAL(4,2)      NOT NULL DEFAULT 2.80,
  `camera_height`     DECIMAL(4,2)      NOT NULL DEFAULT 0.10,
  `auto_rotate_speed` DECIMAL(4,2)      NOT NULL DEFAULT 0.45,
  `credit`            VARCHAR(255)      NULL DEFAULT NULL COMMENT 'Attribution (e.g. Sketchfab author + licence), read from the GLB asset.extras by the pipeline',
  `position`          SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Sort order in the library',
  `active`            TINYINT(1)        NOT NULL DEFAULT 1 COMMENT 'Inactive models are hidden from the library but still resolve for existing billets',
  `created_at`        DATETIME          NOT NULL,
  `updated_at`        DATETIME          NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_models_slug` (`slug`),
  UNIQUE KEY `uk_models_file_path` (`file_path`),
  KEY `idx_models_active_position` (`active`, `position`),
  CONSTRAINT `chk_models_file_path_relative` CHECK (`file_path` NOT LIKE '/%' AND `file_path` NOT LIKE '%..%'),
  CONSTRAINT `chk_models_preview_path_relative` CHECK (`preview_path` NOT LIKE '/%' AND `preview_path` NOT LIKE '%..%'),
  CONSTRAINT `chk_models_fit_size` CHECK (`fit_size` > 0 AND `fit_size` <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Billets. `document` is the working draft (autosave writes here); `published_document` is the
-- snapshot the public link /b/{share_token} serves, so autosave never changes what recipients see.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tbl_billets` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`            BIGINT UNSIGNED NOT NULL,
  `title`              VARCHAR(120)    NOT NULL COMMENT 'Copy of document.title for list queries',
  `model_slug`         VARCHAR(60)     NULL DEFAULT NULL COMMENT 'Copy of document.scene.modelSlug for list queries; no FK, a retired model must not block a billet',
  `document`           LONGTEXT        NOT NULL COMMENT 'Draft billet document (JSON), current schemaVersion only',
  `published_document` LONGTEXT        NULL DEFAULT NULL COMMENT 'Snapshot served by the public link; NULL = not published',
  `share_token`        CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL COMMENT 'Created on first publish, kept on unpublish so a republish restores the same link',
  `published_at`       DATETIME        NULL DEFAULT NULL,
  `version`            BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Optimistic lock (JPA @Version)',
  `created_at`         DATETIME        NOT NULL,
  `updated_at`         DATETIME        NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_billets_share_token` (`share_token`),
  KEY `idx_billets_user_updated` (`user_id`, `updated_at`),
  KEY `idx_billets_model_slug` (`model_slug`),
  CONSTRAINT `chk_billets_document_json` CHECK (JSON_VALID(`document`)),
  CONSTRAINT `chk_billets_published_document_json` CHECK (`published_document` IS NULL OR JSON_VALID(`published_document`)),
  CONSTRAINT `chk_billets_published_pair` CHECK ((`published_document` IS NULL) = (`published_at` IS NULL)),
  CONSTRAINT `chk_billets_published_has_token` CHECK (`published_at` IS NULL OR `share_token` IS NOT NULL),
  CONSTRAINT `fk_billets_user` FOREIGN KEY (`user_id`) REFERENCES `tbl_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
