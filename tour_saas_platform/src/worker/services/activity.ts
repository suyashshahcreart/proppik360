// ============================================================
// Activity log service
//
// Lightweight audit trail for RBAC mutations.
// Mirrors BrokerX's Spatie activitylog pattern.
// ============================================================

export async function logActivity(
  db: D1Database,
  actorUserId: string | null,
  action: string,
  subjectType: string,
  subjectId: string | null,
  properties?: Record<string, unknown>,
): Promise<void> {
  try {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const propertiesJson = properties ? JSON.stringify(properties) : null

    await db
      .prepare(
        `INSERT INTO activity_logs
           (id, actor_user_id, action, subject_type, subject_id, properties_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, actorUserId, action, subjectType, subjectId, propertiesJson, now)
      .run()
  } catch (e) {
    // Activity log failures must never break the main operation
    console.error('[activity] Failed to log activity:', e)
  }
}
