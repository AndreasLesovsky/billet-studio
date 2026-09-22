-- ============================================================
-- billet-studio - role seed (run after schema.sql)
-- The IDs are fixed. Registration assigns ROLE_USER; the root admin that RootUserBootstrap creates
-- at startup from ROOT_EMAIL / ROOT_PASSWORD gets ROLE_ADMIN. Without these rows neither works.
-- Idempotent: re-running only refreshes name and description.
-- VALUES() instead of the row alias syntax because MariaDB 10.4 does not know the alias.
-- ============================================================

SET NAMES utf8mb4;

INSERT INTO `tbl_roles` (`id`, `name`, `description`) VALUES
  (1, 'ROLE_USER', 'Registered user: creates, edits and publishes own billets'),
  (2, 'ROLE_ADMIN', 'Administrator: user management')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`);
