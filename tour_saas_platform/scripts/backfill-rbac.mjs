/** Ensure users.role column is linked to user_roles (admin → role_admin). */
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const dbPath = resolve(process.env.SQLITE_PATH || 'D:/Extra/proppik360/data/platform.sqlite')
const db = new DatabaseSync(dbPath)

db.prepare(
  `INSERT OR IGNORE INTO user_roles (user_id, role_id)
   SELECT id, 'role_admin' FROM users WHERE role = 'admin'`,
).run()

db.prepare(
  `INSERT OR IGNORE INTO user_roles (user_id, role_id)
   SELECT id, 'role_user' FROM users WHERE role = 'user'`,
).run()

const count = db
  .prepare(`SELECT COUNT(*) AS n FROM user_roles`)
  .get().n

console.log(`RBAC backfill done. user_roles rows: ${count}`)
