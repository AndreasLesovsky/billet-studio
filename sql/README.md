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
4. `seed_models.sql` – Modell-Katalog, von `tools/asset-pipeline` generiert (idempotent, erneut einspielbar).

In phpMyAdmin: `db_billet_studio` auswählen → „Importieren“ → Datei wählen. Per Konsole:

```bash
mysql -u root -p db_billet_studio < sql/schema.sql
mysql -u root -p db_billet_studio < sql/seed_roles.sql
mysql -u root -p db_billet_studio < sql/seed_models.sql
```

Eine neue Datenbank braucht keine Migrationen: `schema.sql` und die Seeds enthalten sie schon.

`schema.sql` nennt absichtlich keine Datenbank, damit die Integrationstests (Testcontainers) dieselbe Datei in ihre Wegwerf-DB laden können.

## Root-Admin

Der Root-Admin wird **nicht** per SQL angelegt. Das Backend erzeugt ihn beim Start aus `ROOT_EMAIL`, `ROOT_PASSWORD` (und optional `ROOT_NAME`) in `.env.local` bzw. `.env.production` und markiert ihn mit `is_protected = 1`. Er kann über die Benutzerverwaltung weder gesperrt noch gelöscht werden.

## Zeitstempel

Alle `DATETIME`-Spalten enthalten UTC und werden ausschließlich von der Anwendung geschrieben. Es gibt keine Zeit-`DEFAULT`s in der Datenbank.

## Migrationen (bestehende Datenbank)

Schemaänderungen kommen als eigene Datei nach `sql/migrations/<YYYY-MM-DD>_<name>.sql` (z. B. `sql/migrations/2026-10-01_billet_og_image.sql`) und werden im selben Commit in `schema.sql` nachgezogen, damit eine frische Installation immer nur `schema.sql` + Seeds braucht. Bestehende Datenbanken spielen nur die neuen Migrationen ein, in Datumsreihenfolge. Der Kopf jeder Datei sagt, wofür sie ist, ob sie vor dem Start eines neuen Backends laufen muss und was nur unter MariaDB geht.

| Datei | Inhalt | Wann |
|---|---|---|
| `2026-09-25_model-defaults-cake-globe-champagne.sql` | Katalog: Standardwerte für Torte und Schneekugel, neu gebaute Champagnerflasche (Dateigröße) | Datenbank mit Katalog vor dem 25.09.2026 |
| `2026-09-26_billet_theme_column.sql` | neue Spalte `tbl_billets.theme` (Farbfelder in „Meine Billets“), befüllt aus den vorhandenen Billets | **vor** dem Start eines Backends ab P8; ohne die Spalte schlägt jede Billet-Anfrage fehl |

Beide lassen sich gefahrlos mehrmals einspielen.

Dasselbe gilt für Änderungen am Modell-Katalog (`tbl_models`, z. B. neue Standardwerte einer Szene oder eine neu gebaute GLB): `seed_models.sql` wird für frische Datenbanken aktualisiert, und zusätzlich gibt es eine kleine datierte Migration mit genau den geänderten Zeilen (`UPDATE`/`INSERT`), damit eine bestehende DB nie die ganze Seed-Datei neu braucht.
