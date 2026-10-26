import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'
import type { Env } from '../worker/types'
import { openSqliteD1, type SqliteD1Database } from './sqlite-d1'
import { createS3R2Bucket } from './r2-bucket'

loadDotenv({ path: resolve(process.cwd(), '.env'), quiet: true })

export const DEFAULT_SQLITE_PATH = resolve(
  process.env.SQLITE_PATH || 'D:/Extra/proppik360/data/platform.sqlite',
)

let sqliteHandle: SqliteD1Database | null = null

export function getSqliteHandle(): SqliteD1Database {
  if (!sqliteHandle) {
    sqliteHandle = openSqliteD1(DEFAULT_SQLITE_PATH)
  }
  return sqliteHandle
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

/** Build Worker Env bindings from process.env (Node / VPS). */
export function createRuntimeEnv(): Env {
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY')

  const r2Config = {
    accountId: process.env.R2_ACCOUNT_ID ?? '92dbc57b592c572a4914b960cac80c7b',
    bucketName: process.env.R2_BUCKET_NAME ?? 'proppik360',
    accessKeyId,
    secretAccessKey,
  }

  const adminBucketName = process.env.R2_ADMIN_BUCKET_NAME?.trim() || undefined
  const adminBucket = adminBucketName
    ? createS3R2Bucket({
        accountId: r2Config.accountId,
        bucketName: adminBucketName,
        accessKeyId,
        secretAccessKey,
      })
    : undefined

  return {
    DB: getSqliteHandle(),
    TOUR_BUCKET: createS3R2Bucket(r2Config),
    ADMIN_BUCKET: adminBucket,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    ENVIRONMENT: (process.env.ENVIRONMENT as Env['ENVIRONMENT']) ?? 'development',
    APP_URL: process.env.APP_URL ?? 'http://127.0.0.1:8787',
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    R2_ACCOUNT_ID: r2Config.accountId,
    R2_BUCKET_NAME: r2Config.bucketName,
    R2_ADMIN_BUCKET_NAME: adminBucketName,
    R2_ADMIN_PUBLIC_DOMAIN: process.env.R2_ADMIN_PUBLIC_DOMAIN?.trim() || undefined,
    PART_SIZE_BYTES: process.env.PART_SIZE_BYTES ?? '26214400',
    UPLOAD_CONCURRENCY: process.env.UPLOAD_CONCURRENCY ?? '8',
    MAX_RETRIES: process.env.MAX_RETRIES ?? '3',
    PROCESSOR_SECRET: process.env.PROCESSOR_SECRET ?? 'dev-processor-secret-change-in-production',
    PROCESSOR_WEBHOOK_URL: process.env.PROCESSOR_WEBHOOK_URL ?? 'http://127.0.0.1:9000/jobs',
    PROCESSOR_INGEST_URL: process.env.PROCESSOR_INGEST_URL,
    R2_PUBLIC_DOMAIN:
      process.env.R2_PUBLIC_DOMAIN ?? 'pub-97f4aa1642a4429982a8583c0cf894c0.r2.dev',
    MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY || undefined,
    TOUR_ADMIN_API_KEY: process.env.TOUR_ADMIN_API_KEY || undefined,
    TOUR_ADMIN_CORS_ORIGINS: process.env.TOUR_ADMIN_CORS_ORIGINS?.trim() || undefined,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN?.trim() || undefined,
    CLOUDFLARE_ZONE_ID: process.env.CLOUDFLARE_ZONE_ID?.trim() || undefined,
    CLOUDFLARE_ADMIN_ZONE_ID: process.env.CLOUDFLARE_ADMIN_ZONE_ID?.trim() || undefined,
  }
}
