// ============================================================
// Notify the Go processor to start (or resume) a tour job.
//
// Retries with exponential backoff. Callers should pass the
// request's ExecutionContext so Cloudflare keeps the Worker
// alive via waitUntil while retries run after the response.
// ============================================================
import type { Env } from '../types'

const MAX_ATTEMPTS = 4
const BASE_DELAY_MS = 500

const HEALTH_MAX_ATTEMPTS = 3
const HEALTH_TIMEOUT_MS = 5000
const HEALTH_RETRY_DELAY_MS = 300

export interface NotifyResult {
  ok: boolean
  attempts: number
  error?: string
}

export interface ProcessorHealthResult {
  online: boolean
  latencyMs: number | null
  error?: string
  attempts: number
  checkedAt: string
  healthUrl: string | null
}

/**
 * Prefer 127.0.0.1 over localhost — on Windows, workerd and other runtimes
 * can resolve localhost differently than the Go process binding.
 */
export function normalizeProcessorWebhookUrl(webhookUrl: string): string {
  try {
    const url = new URL(webhookUrl)
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1'
    }
    return url.toString()
  } catch {
    return webhookUrl.replace(/\/\/localhost\b/i, '//127.0.0.1')
  }
}

/**
 * Derive the processor /health URL from PROCESSOR_WEBHOOK_URL (/jobs).
 */
export function processorHealthUrl(webhookUrl: string): string {
  const normalized = normalizeProcessorWebhookUrl(webhookUrl)
  try {
    const url = new URL(normalized)
    url.pathname = url.pathname.replace(/\/jobs\/?$/, '/health')
    if (!url.pathname.endsWith('/health')) {
      url.pathname = '/health'
    }
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return normalized.replace(/\/jobs\/?$/, '/health')
  }
}

function describeProbeError(
  e: unknown,
  healthUrl: string,
  timeoutMs: number,
  timedOut: boolean,
): string {
  let host = healthUrl
  try {
    host = new URL(healthUrl).host
  } catch {
    // keep raw URL
  }

  if (timedOut) {
    return `Timed out after ${timeoutMs}ms reaching ${host}`
  }

  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()

  if (lower.includes('abort') || lower.includes('timeout')) {
    return `Timed out after ${timeoutMs}ms reaching ${host}`
  }
  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return `Connection refused at ${host} — is tour_processor running?`
  }
  if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
    return `Host not found (${host}) — check PROCESSOR_WEBHOOK_URL`
  }
  if (lower.includes('network') || lower.includes('connect')) {
    return `Network error reaching ${host}: ${msg}`
  }

  return msg || `Failed to reach ${host}`
}

async function probeProcessorHealthOnce(
  healthUrl: string,
  timeoutMs: number,
): Promise<Pick<ProcessorHealthResult, 'online' | 'latencyMs' | 'error'>> {
  const started = Date.now()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    })
    const latencyMs = Date.now() - started
    if (!res.ok) {
      return { online: false, latencyMs, error: `HTTP ${res.status} from ${healthUrl}` }
    }
    return { online: true, latencyMs }
  } catch (e) {
    return {
      online: false,
      latencyMs: Date.now() - started,
      error: describeProbeError(e, healthUrl, timeoutMs, timedOut),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe the Go processor liveness endpoint with retries and a longer timeout.
 */
export async function checkProcessorHealth(
  env: Env,
  options?: {
    attempts?: number
    timeoutMs?: number
    retryDelayMs?: number
  },
): Promise<ProcessorHealthResult> {
  const checkedAt = new Date().toISOString()
  const webhookUrl = env.PROCESSOR_WEBHOOK_URL
  if (!webhookUrl) {
    return {
      online: false,
      latencyMs: null,
      error: 'PROCESSOR_WEBHOOK_URL not configured',
      attempts: 0,
      checkedAt,
      healthUrl: null,
    }
  }

  const healthUrl = processorHealthUrl(webhookUrl)
  const attempts = options?.attempts ?? HEALTH_MAX_ATTEMPTS
  const timeoutMs = options?.timeoutMs ?? HEALTH_TIMEOUT_MS
  const retryDelayMs = options?.retryDelayMs ?? HEALTH_RETRY_DELAY_MS

  let lastResult: Pick<ProcessorHealthResult, 'online' | 'latencyMs' | 'error'> = {
    online: false,
    latencyMs: null,
    error: 'Health probe did not run',
  }
  let attemptsUsed = 0

  for (let attempt = 1; attempt <= attempts; attempt++) {
    attemptsUsed = attempt
    lastResult = await probeProcessorHealthOnce(healthUrl, timeoutMs)
    if (lastResult.online) {
      return {
        ...lastResult,
        attempts: attemptsUsed,
        checkedAt,
        healthUrl,
      }
    }
    if (attempt < attempts) {
      await sleep(retryDelayMs)
    }
  }

  return {
    ...lastResult,
    attempts: attemptsUsed,
    checkedAt,
    healthUrl,
  }
}

/**
 * POST { tourId } to PROCESSOR_WEBHOOK_URL with retries.
 */
export async function notifyProcessor(
  env: Env,
  tourId: string,
  phase?: string,
): Promise<NotifyResult> {
  const webhookUrl = env.PROCESSOR_WEBHOOK_URL
    ? normalizeProcessorWebhookUrl(env.PROCESSOR_WEBHOOK_URL)
    : ''
  if (!webhookUrl) {
    console.warn('[processor] PROCESSOR_WEBHOOK_URL not set — cannot notify')
    return { ok: false, attempts: 0, error: 'PROCESSOR_WEBHOOK_URL not set' }
  }

  let lastError = 'unknown'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Processor-Secret': env.PROCESSOR_SECRET,
        },
        body: JSON.stringify({
        tourId,
        ...(phase ? { phase } : {}),
      }),
      })

      if (res.ok || res.status === 202) {
        if (attempt > 1) {
          console.log(`[processor] notify ok tour=${tourId} after ${attempt} attempts`)
        }
        return { ok: true, attempts: attempt }
      }

      const body = await res.text().catch(() => '')
      lastError = `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      console.warn(`[processor] notify attempt ${attempt}/${MAX_ATTEMPTS} tour=${tourId}: ${lastError}`)
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      console.warn(`[processor] notify attempt ${attempt}/${MAX_ATTEMPTS} tour=${tourId}: ${lastError}`)
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
      await sleep(delay)
    }
  }

  console.error(`[processor] notify failed tour=${tourId} after ${MAX_ATTEMPTS} attempts: ${lastError}`)
  return { ok: false, attempts: MAX_ATTEMPTS, error: lastError }
}

/**
 * Schedule notifyProcessor on the request's waitUntil so the Worker
 * response can return immediately without killing retries.
 */
export function notifyProcessorInBackground(
  env: Env,
  tourId: string,
  executionCtx: ExecutionContext | undefined,
): void {
  const task = notifyProcessor(env, tourId)
  if (executionCtx?.waitUntil) {
    executionCtx.waitUntil(task)
  } else {
    // Local/tests without waitUntil — still fire-and-forget
    void task
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
