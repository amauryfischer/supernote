import type { Database } from "better-sqlite3";

/** Create the FTS5 virtual table and associated triggers if they don't exist. */
export function installFts(db: Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
      entity_id UNINDEXED,
      title,
      body,
      tags,
      field_text,
      type_id UNINDEXED,
      tokenize = 'porter unicode61 remove_diacritics 2'
    );
  `);

  // Trigger: keep FTS in sync on entity insert
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS entity_fts_after_insert
    AFTER INSERT ON entity
    BEGIN
      INSERT INTO entity_fts(entity_id, title, body, tags, field_text, type_id)
      VALUES (NEW.id, '', COALESCE(NEW.body, ''), '', '', NEW.typeId);
    END;
  `);

  // Trigger: keep FTS in sync on entity update
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS entity_fts_after_update
    AFTER UPDATE ON entity
    BEGIN
      UPDATE entity_fts
      SET body = COALESCE(NEW.body, ''), type_id = NEW.typeId
      WHERE entity_id = NEW.id;
    END;
  `);

  // Trigger: keep FTS in sync on entity delete
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS entity_fts_after_delete
    AFTER DELETE ON entity
    BEGIN
      DELETE FROM entity_fts WHERE entity_id = OLD.id;
    END;
  `);
}
