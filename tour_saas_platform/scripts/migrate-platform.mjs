/**
 * Apply SQL migrations to the platform SQLite DB (no Wrangler).
 * Default path: D:/Extra/proppik360/data/platform.sqlite
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const migrationsDir = join(projectRoot, 'migrations')
const dbPath = resolve(process.env.SQLITE_PATH || 'D:/Extra/proppik360/data/platform.sqlite')

mkdirSync(dirname(dbPath), { recursive: true })

console.log(`Database: ${dbPath}`)
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON;')

db.exec(`
  CREATE TABLE IF NOT EXISTS d1_migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`)

const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

let applied = 0
let skipped = 0

for (const file of migrationFiles) {
  const existing = db.prepare('SELECT id FROM d1_migrations WHERE name = ?').get(file)
  if (existing) {
    console.log(`  skip ${file}`)
    skipped++
    continue
  }
  const sql = readFileSync(join(migrationsDir, file), 'utf-8')
  try {
    db.exec(sql)
    db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(file)
    console.log(`  ok   ${file}`)
    applied++
  } catch (err) {
    console.error(`  FAIL ${file}: ${err.message}`)
    process.exit(1)
  }
}

console.log(`Done. ${applied} applied, ${skipped} skipped.`)
