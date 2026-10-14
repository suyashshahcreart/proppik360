# R2 Multipart Upload Flow

This document explains how large ZIP files are uploaded directly from the
browser to Cloudflare R2, without passing through the Worker.

---

## Why multipart upload?

A 2.85 GB ZIP file cannot be uploaded in a single HTTP request:

- Browsers have memory limits — loading 3 GB into memory is impractical.
- HTTP connections can time out or drop during a large upload.
- If the upload fails, you would have to restart from the beginning.

Multipart upload solves these problems:
- The file is split into small parts (10 MB each by default).
- Parts are uploaded in parallel (3 at a time by default).
- If one part fails, only that part is retried.
- R2 assembles all parts into the final file when you call Complete.

---

## Why direct browser-to-R2 upload?

The Worker must NOT receive the ZIP file bytes because:
- Workers have a 128 MB memory limit (much less than 3 GB).
- Passing a 3 GB file through the Worker would be extremely slow and expensive.
- Cloudflare would reject or time out such a large request through the Worker.

Instead, we use this architecture:

```
Browser
  │
  ├─→ Worker: POST /api/tours (create tour)
  │       ↓ D1: INSERT tour
  │
  ├─→ Worker: POST /api/tours/:id/upload/initiate
  │       ↓ R2 S3 API: CreateMultipartUpload
  │       ↓ D1: UPDATE tour (status=uploading, uploadId)
  │       ← Returns: uploadId, partSizeBytes, totalParts
  │
  │   (Repeat for each part, concurrency=3):
  ├─→ Worker: POST /api/tours/:id/upload/part-url { partNumber, uploadId }
  │       ↓ Signs presigned URL with aws4fetch (1 hour expiry)
  │       ← Returns: presignedUrl
  │
  ├─→ R2 directly: PUT presignedUrl + part bytes
  │       ← R2 returns: ETag header
  │
  ├─→ Worker: POST /api/tours/:id/upload/complete { uploadId, parts }
  │       ↓ R2 S3 API: CompleteMultipartUpload
  │       ↓ D1: UPDATE tour (status=uploaded)
  │       ← Returns: { success: true }
  │
  └─ Done. tour.status = 'uploaded'
```

**Key point:** The Worker only handles authentication, authorization, and metadata.
It never receives the ZIP file bytes.

---

## Detailed flow with code

### 1. Create tour

```typescript
// Browser calls:
POST /api/tours
{ "name": "Building A — Ground Floor" }

// Worker:
// - Validates name
// - Generates tourId = crypto.randomUUID()
// - Inserts into D1: status='draft'
// - Returns tour object
```

### 2. Initiate multipart upload

```typescript
// Browser calls:
POST /api/tours/{tourId}/upload/initiate
{ "filename": "building-a.zip", "fileSize": 3062345728 }

// Worker:
// - Verifies session + tour ownership
// - Validates filename (.zip required)
// - Validates fileSize (≤ 10 GB)
// - Computes: totalParts = Math.ceil(fileSize / partSizeBytes)
// - Calls R2 S3 API: POST /{bucket}/{key}?uploads
// - Parses UploadId from XML response
// - Stores uploadId + r2Key in D1
// - Sets tour status = 'uploading'

// Returns:
{
  "uploadId": "abc123...",
  "r2Key": "tours/tourId/original.zip",
  "partSizeBytes": 10485760,   // 10 MiB
  "totalParts": 292
}
```

### 3. Get presigned URL for each part

```typescript
// Browser calls (for part 1, 2, 3, ... totalParts):
POST /api/tours/{tourId}/upload/part-url
{ "partNumber": 1, "uploadId": "abc123..." }

// Worker:
// - Verifies session + ownership
// - Verifies uploadId matches D1 record (security check)
// - Builds URL: https://{accountId}.r2.cloudflarestorage.com/{bucket}/{key}
//               ?partNumber=1&uploadId=abc123&X-Amz-Expires=3600
// - Signs URL with aws4fetch (query string signing, not header)
// - Returns presigned URL (valid for 1 hour)
```

### 4. Browser uploads part directly to R2

```typescript
// Browser:
const chunk = file.slice(start, end)  // Slice the file — no full load into memory!

// PUT to presigned URL — this goes DIRECTLY to R2, not through the Worker
const response = await fetch(presignedUrl, {
  method: 'PUT',
  body: chunk,
  headers: { 'Content-Type': 'application/octet-stream' }
})

// R2 returns ETag in response header
const etag = response.headers.get('ETag')  // e.g. '"abc123..."'
```

### 5. Complete the multipart upload

```typescript
// Browser collects all ETags:
const parts = [
  { PartNumber: 1, ETag: '"etag1..."' },
  { PartNumber: 2, ETag: '"etag2..."' },
  // ... up to 292 parts
]

// Browser calls:
POST /api/tours/{tourId}/upload/complete
{ "uploadId": "abc123...", "parts": [...] }

// Worker:
// - Verifies session + ownership + uploadId
// - Sorts parts by PartNumber (required by R2/S3)
// - Sends XML to R2 S3 API: POST /{bucket}/{key}?uploadId=abc123
// - R2 assembles all parts into the final ZIP object
// - Worker updates D1: status='uploaded'
```

---

## Part size and count rules (R2/S3)

| Rule | Value |
|------|-------|
| Minimum part size | 5 MiB (except the last part) |
| Maximum part size | 5 GiB |
| Maximum number of parts | 10,000 |
| Default part size (this app) | 10 MiB |

With 10 MiB parts and a 2.85 GB file:
- Total parts: `Math.ceil(2850000000 / 10485760)` = **272 parts**

With a 10 GB file (maximum supported):
- Total parts: `Math.ceil(10737418240 / 10485760)` = **1024 parts** (well within the 10,000 limit)

---

## Concurrency and performance

The browser uploads up to 3 parts simultaneously (configurable via
`UPLOAD_CONCURRENCY` in wrangler.jsonc).

For a 2.85 GB file on a 100 Mbps connection:
- Each 10 MB part takes ~0.8 seconds
- With 3 parallel uploads: ~3.75 parts/second
- Estimated total time: 272 / 3.75 ≈ **73 seconds** (~1.2 minutes)

---

## Retry logic

If a part upload fails (network error, timeout, 5xx from R2):
- The browser retries with exponential backoff: 1 second, 2 seconds, 4 seconds
- Maximum retries: 3 (configurable via `MAX_RETRIES`)
- If all retries fail, the entire upload is aborted

---

## Aborting an upload

If the user clicks "Cancel Upload":
1. Browser calls: `POST /api/tours/{tourId}/upload/abort { uploadId }`
2. Worker calls R2 S3 API: `DELETE /{bucket}/{key}?uploadId=abc123`
3. R2 frees the storage reserved for uploaded parts
4. Worker updates D1: `status='failed'`

> **Note:** If an upload is abandoned without calling abort, R2 automatically
> cleans up incomplete uploads after 7 days.

---

## Security

| What | How |
|------|-----|
| R2 credentials | Stored as Worker secrets — never sent to the browser |
| Presigned URLs | Time-limited (1 hour), scoped to exact key + uploadId + partNumber |
| R2 key | Always generated server-side (`tours/{tourId}/original.zip`) |
| uploadId verification | Worker verifies client-provided uploadId matches D1 record |
| Ownership check | Every upload endpoint verifies the tour belongs to the logged-in user |

---

## Future: Go ZIP processor

After `status = 'uploaded'`, the next step is Go-based processing:

```
R2: tours/{tourId}/original.zip  (current end state)
        ↓
Cloudflare Queue (future — push tourId to queue)
        ↓
Go processing service (future)
        ↓
  1. Fetch original.zip from R2
  2. Extract ZIP (300,000 files)
  3. Validate 360° tour structure
  4. Write processed files to R2:
       tours/{tourId}/index.html
       tours/{tourId}/js/...
       tours/{tourId}/images/...
       tours/{tourId}/tiles/...
  5. Update D1: status='ready'
```

The code comment in `src/worker/routes/uploads.ts` (in the `complete` handler)
marks exactly where the Cloudflare Queue call should be added when the Go
processor is implemented.
