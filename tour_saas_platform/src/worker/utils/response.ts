// ============================================================
// Standard API response helpers
//
// All API endpoints return one of these two shapes:
//
//   Success: { "success": true,  "data": { ... } }
//   Error:   { "success": false, "error": { "code": "...", "message": "..." } }
// ============================================================

export function ok<T>(data: T) {
  return { success: true as const, data }
}

export function err(code: string, message: string, details?: Record<string, unknown>) {
  return {
    success: false as const,
    error: { code, message, ...(details ? { details } : {}) },
  }
}
