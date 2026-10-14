import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const tourId = process.argv[2] ?? '000002'
const dbPath = resolve(process.env.SQLITE_PATH || 'D:/Extra/proppik360/data/platform.sqlite')
const db = new DatabaseSync(dbPath)
const now = new Date().toISOString()

const r = db
  .prepare(
    `UPDATE tours
        SET status = 'processing',
            processing_started_at = COALESCE(processing_started_at, ?)
      WHERE tour_id = ?
        AND status IN ('ingesting', 'uploading')`,
  )
  .run(now, tourId)

const row = db
  .prepare(`SELECT tour_id, status, processing_stage FROM tours WHERE tour_id = ?`)
  .get(tourId)

console.log('healed rows:', r.changes)
console.log(row)
