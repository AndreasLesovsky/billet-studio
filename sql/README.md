# Datenbank (db_billet_studio)

Die Datenbank verwaltest du selbst. Das Backend legt nichts an (`ddl-auto: none`), und Claude liefert nur SQL-Dateien, führt aber nie SQL aus.

Ziel: MariaDB 10.4+ (XAMPP) oder MySQL 8.0.16+.

## Ersteinrichtung (Reihenfolge)

1. Datenbank anlegen:

   ```sql
   CREATE DATABASE db_billet_studio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. `schema.sql` – alle Tabellen (`tbl_roles`, `tbl_users`, `tbl_auth_sessions`, `tbl_models`, `tbl_billets`)
3. `seed_roles.sql` – Rollen `1 = ROLE_USER`, `2 = ROLE_ADMIN`
4. `seed_models.sql` – Modell-Katalog. Kommt in Phase P4 und wird von `tools/asset-pipeline` generiert (idempotent, erneut einspielbar).

In phpMyAdmin: `db_billet_studio` auswählen → „Importieren“ → Datei wählen. Per Konsole:

```bash
mysql -u root -p db_billet_studio < sql/schema.sql
mysql -u root -p db_billet_studio < sql/seed_roles.sql
```

`schema.sql` nennt absichtlich keine Datenbank, damit die Integrationstests (Testcontainers) dieselbe Datei in ihre Wegwerf-DB laden können.

## Root-Admin

Der Root-Admin wird **nicht** per SQL angelegt. Das Backend erzeugt ihn beim Start aus `ROOT_EMAIL`, `ROOT_PASSWORD` (und optional `ROOT_NAME`) in `.env.local` bzw. `.env.production` und markiert ihn mit `is_protected = 1`. Er kann über die Benutzerverwaltung weder gesperrt noch gelöscht werden.

## Zeitstempel

Alle `DATETIME`-Spalten enthalten UTC und werden ausschließlich von der Anwendung geschrieben. Es gibt keine Zeit-`DEFAULT`s in der Datenbank.

## Spätere Änderungen

Schemaänderungen kommen als eigene Datei nach `sql/migrations/<YYYY-MM-DD>_<name>.sql` (z. B. `sql/migrations/2026-10-01_billet_og_image.sql`) und werden im selben Commit in `schema.sql` nachgezogen, damit eine frische Installation immer nur `schema.sql` + Seeds braucht. Bestehende Datenbanken spielen nur die neuen Migrationen ein, in Datumsreihenfolge.

Dasselbe gilt für Änderungen am Modell-Katalog (`tbl_models`, z. B. neue Standardwerte einer Szene oder eine neu gebaute GLB): `seed_models.sql` wird für frische Datenbanken aktualisiert, und zusätzlich gibt es eine kleine datierte Migration mit genau den geänderten Zeilen (`UPDATE`/`INSERT`), damit eine bestehende DB nie die ganze Seed-Datei neu braucht.
