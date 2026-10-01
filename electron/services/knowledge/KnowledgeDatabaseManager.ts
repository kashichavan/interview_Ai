// electron/services/knowledge/KnowledgeDatabaseManager.ts

import type Database from 'better-sqlite3';

export class KnowledgeDatabaseManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initializeSchema();
  }

  public initializeSchema(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          source_uri TEXT,
          file_name TEXT,
          raw_text TEXT,
          structured_data TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_documents_type ON knowledge_documents(type);
      `);
    } catch (err) {
      console.error('[KnowledgeDatabaseManager] Error initializing schema:', err);
    }
  }

  public saveDocument(doc: {
    type: string;
    source_uri?: string;
    file_name?: string;
    raw_text?: string;
    structured_data: any;
  }): number {
    const now = new Date().toISOString();
    const strData = typeof doc.structured_data === 'string'
      ? doc.structured_data
      : JSON.stringify(doc.structured_data || {});

    // First, remove older documents of the same type (only 1 active resume/JD)
    try {
      this.db.prepare('DELETE FROM knowledge_documents WHERE type = ?').run(doc.type);
    } catch { /* ignore */ }

    const stmt = this.db.prepare(`
      INSERT INTO knowledge_documents (type, source_uri, file_name, raw_text, structured_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      doc.type,
      doc.source_uri || null,
      doc.file_name || null,
      doc.raw_text || null,
      strData,
      now,
      now
    );
    return Number(result.lastInsertRowid);
  }

  public getActiveDocument(type: string): any {
    try {
      const row: any = this.db.prepare(
        'SELECT * FROM knowledge_documents WHERE type = ? ORDER BY id DESC LIMIT 1'
      ).get(type);

      if (!row) return null;

      let structured: any = null;
      if (row.structured_data) {
        try {
          structured = JSON.parse(row.structured_data);
        } catch {
          structured = null;
        }
      }

      return {
        id: row.id,
        type: row.type,
        source_uri: row.source_uri,
        file_name: row.file_name,
        raw_text: row.raw_text,
        structured_data: structured,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    } catch (err) {
      console.error(`[KnowledgeDatabaseManager] Error fetching active document for ${type}:`, err);
      return null;
    }
  }

  public deleteDocuments(type: string): void {
    try {
      this.db.prepare('DELETE FROM knowledge_documents WHERE type = ?').run(type);
    } catch (err) {
      console.error(`[KnowledgeDatabaseManager] Error deleting documents for ${type}:`, err);
    }
  }

  public getAllDocuments(): any[] {
    try {
      const rows: any[] = this.db.prepare('SELECT * FROM knowledge_documents ORDER BY id DESC').all();
      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        source_uri: row.source_uri,
        file_name: row.file_name,
        raw_text: row.raw_text,
        structured_data: row.structured_data ? JSON.parse(row.structured_data) : null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
    } catch {
      return [];
    }
  }

  public close(): void {
    // Shared db handle is closed by DatabaseManager
  }
}
