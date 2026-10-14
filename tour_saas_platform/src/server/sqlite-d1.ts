/**
 * D1Database-compatible wrapper around better-sqlite3 for Node (no Wrangler).
 */
import Database from 'better-sqlite3'
import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types'

class SqliteStatement implements D1PreparedStatement {
  private bound: unknown[] = []

  constructor(
    private readonly db: Database.Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.bound = values
    return this
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.bound) as T | undefined
    return row ?? null
  }

  runSync<T = unknown>(): D1Result<T> {
    const info = this.db.prepare(this.sql).run(...this.bound)
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid),
        duration: 0,
        served_by: 'sqlite',
        size_after: 0,
        rows_read: 0,
        rows_written: info.changes,
      },
    } as D1Result<T>
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.runSync<T>()
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const results = this.db.prepare(this.sql).all(...this.bound) as T[]
    return {
      success: true,
      results,
      meta: {
        changes: 0,
        last_row_id: 0,
        duration: 0,
        served_by: 'sqlite',
        size_after: 0,
        rows_read: results.length,
        rows_written: 0,
      },
    } as D1Result<T>
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return this.db.prepare(this.sql).raw().all(...this.bound) as T[]
  }
}

export class SqliteD1Database implements D1Database {
  constructor(private readonly db: Database.Database) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.db, query)
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const runBatch = this.db.transaction(() => {
      const out: D1Result<T>[] = []
      for (const stmt of statements) {
        out.push((stmt as SqliteStatement).runSync<T>())
      }
      return out
    })
    return runBatch()
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    this.db.exec(query)
    return { count: 0, duration: 0 }
  }

  /** Underlying SQLite handle (migrations, admin scripts). */
  native(): Database.Database {
    return this.db
  }
}

export function openSqliteD1(filePath: string): SqliteD1Database {
  const db = new Database(filePath)
  db.pragma('foreign_keys = ON')
  return new SqliteD1Database(db)
}
