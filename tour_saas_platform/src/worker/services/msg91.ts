// ============================================================
// MSG91 OTP sender — secrets from env, config from settings table
// ============================================================
import { getSetting } from './settings'
import { resolveMsg91TemplateId } from './msg91-templates'
import type { Env } from '../types'

export interface Msg91SendResult {
  ok: boolean
  requestId?: string
  mock?: boolean
  error?: string
}

function normalizeMobile(countryCode: string, mobile: string): string {
  const digits = mobile.replace(/\D/g, '')
  const cc = countryCode.replace(/\D/g, '') || '91'
  if (digits.startsWith(cc)) return digits
  return `${cc}${digits}`
}

/**
 * Send OTP via MSG91 Flow. When msg91_mock_mode=1 or no auth key, logs OTP and returns mock.
 * Template resolved from msg91_templates JSON (tour_access_otp → login_otp → legacy field).
 */
export async function sendMsg91Otp(
  env: Env,
  opts: {
    countryCode: string
    mobile: string
    otp: string
    /** Override template key; default tour_access_otp */
    templateKey?: string
  },
): Promise<Msg91SendResult> {
  const enabled = (await getSetting(env.DB, 'sms_msg91_enabled', '0')) === '1'
  const mockMode = (await getSetting(env.DB, 'msg91_mock_mode', '0')) === '1'
  const senderId = (await getSetting(env.DB, 'msg91_sender_id', '')) ?? ''
  const authKey = env.MSG91_AUTH_KEY?.trim() || ''
  const timeoutMs = Math.max(
    1000,
    Number((await getSetting(env.DB, 'msg91_timeout_ms', '30000')) || 30000),
  )

  const resolved = await resolveMsg91TemplateId(env.DB, opts.templateKey ?? 'tour_access_otp')
  const templateId = resolved?.templateId ?? ''

  const to = normalizeMobile(opts.countryCode, opts.mobile)

  if (!enabled || mockMode || !authKey) {
    console.log(
      `[msg91] mock OTP to=${to} otp=${opts.otp} template=${resolved?.key ?? 'none'} enabled=${enabled} mock=${mockMode} hasKey=${Boolean(authKey)}`,
    )
    return { ok: true, mock: true, requestId: `mock-${Date.now()}` }
  }

  if (!templateId) {
    return {
      ok: false,
      error:
        'No MSG91 template configured. Add tour_access_otp (or login_otp) under Settings → SMS → Manage Templates.',
    }
  }

  // MSG91 Flow API — https://control.msg91.com/api/v5/flow/
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: authKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        template_id: templateId,
        short_url: '0',
        recipients: [
          {
            mobiles: to,
            OTP: opts.otp,
            otp: opts.otp,
          },
        ],
        ...(senderId ? { sender: senderId } : {}),
      }),
    })
    const text = await res.text()
    let json: { type?: string; message?: string; request_id?: string } = {}
    try {
      json = JSON.parse(text) as typeof json
    } catch {
      /* ignore */
    }
    if (!res.ok || json.type === 'error') {
      console.error('[msg91] send failed', res.status, text.slice(0, 300))
      return { ok: false, error: json.message || `MSG91 HTTP ${res.status}` }
    }
    return { ok: true, requestId: json.request_id || json.message }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[msg91] exception', message)
    return {
      ok: false,
      error: message.includes('abort') ? `MSG91 timeout after ${timeoutMs}ms` : message,
    }
  } finally {
    clearTimeout(timer)
  }
}
