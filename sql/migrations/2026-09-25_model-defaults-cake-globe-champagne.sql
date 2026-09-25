-- ============================================================
-- 2026-09-25 · Model catalog: tuned scene defaults and a rebuilt GLB
-- Target: db_billet_studio (after schema.sql, seed_roles.sql, seed_models.sql)
--
-- Only needed on databases seeded before these changes; sql/seed_models.sql already contains
-- the same values for fresh databases. Safe to run more than once.
--
-- - birthday-cake: larger and brighter default framing (was fit 1.60 / exposure 0.60)
-- - snow-globe: smaller and slightly higher so the 3D hint clears the wooden base
--   (was fit 1.45 / y_offset 0.00)
-- - champagne-bottle: GLB rebuilt with an opaque glass material (new file size)
-- ============================================================

UPDATE `tbl_models`
SET `fit_size` = 2.00, `exposure` = 0.85, `updated_at` = UTC_TIMESTAMP()
WHERE `slug` = 'birthday-cake';

UPDATE `tbl_models`
SET `fit_size` = 1.35, `y_offset` = 0.07, `updated_at` = UTC_TIMESTAMP()
WHERE `slug` = 'snow-globe';

UPDATE `tbl_models`
SET `file_size_bytes` = 1967408, `updated_at` = UTC_TIMESTAMP()
WHERE `slug` = 'champagne-bottle';
