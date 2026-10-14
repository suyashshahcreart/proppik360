// ============================================================
// FileDropzone — modern drag-and-drop file uploader
//
// Same external contract as the previous MediaUploader: pass a
// collection + either (entityType + entityId) for the entity-scoped
// upload endpoints, or a custom uploadFn for direct library uploads.
// ============================================================
import { useState, useRef, useCallback } from 'react'
import { UploadCloud, ImageIcon, Loader2, AlertCircle, X } from 'lucide-react'
import type { Media, MediaCollection, MediaEntityType } from '@/types'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'

/** Common shape shared by MediaListItem and MediaUploadResult — both extend Media + url. */
export type UploadedMedia = Media & { url: string }

interface FileDropzoneProps {
  collection: MediaCollection
  entityType?: MediaEntityType
  entityId?: string
  accept?: string
  maxBytes?: number
  currentUrl?: string | null
  label?: string
  disabled?: boolean
  compact?: boolean
  onUploaded?: (result: UploadedMedia) => void
  /** Override the default upload function (e.g. for direct library uploads) */
  uploadFn?: (file: File, onProgress: (pct: number) => void) => Promise<UploadedMedia>
}

export function FileDropzone({
  collection,
  entityType,
  entityId,
  accept = 'image/*',
  maxBytes,
  currentUrl,
  label,
  disabled = false,
  compact = false,
  onUploaded,
  uploadFn,
}: FileDropzoneProps) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl ?? null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isImage = accept.includes('image')
  const maxMb = maxBytes ? maxBytes / (1024 * 1024) : null

  const handleFile = useCallback(
    async (file: File) => {
      if (maxBytes && file.size > maxBytes) {
        setError(`File must be ${maxMb} MB or less`)
        return
      }

      setError(null)
      setUploading(true)
      setProgress(0)

      const objectUrl = URL.createObjectURL(file)
      setPreviewUrl(objectUrl)

      try {
        let result: UploadedMedia

        if (uploadFn) {
          result = await uploadFn(file, setProgress)
        } else if (entityType && entityId) {
          result =
            entityType === 'customer'
              ? await api.customers.uploadMedia(entityId, collection, file, setProgress)
              : await api.tours.uploadMedia(entityId, collection, file, setProgress)
        } else {
          result = await api.media.upload(
            file,
            { collection, entity_type: entityType, entity_id: entityId },
            setProgress,
          )
        }

        setPreviewUrl(result.url)
        onUploaded?.(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
        setPreviewUrl(currentUrl ?? null)
      } finally {
        setUploading(false)
        setProgress(0)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [collection, currentUrl, entityId, entityType, maxBytes, maxMb, onUploaded, uploadFn],
  )

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (disabled || uploading) return
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="flex flex-col gap-2">
      {label && <p className="text-sm font-medium text-foreground">{label}</p>}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled && !uploading) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !disabled && !uploading && inputRef.current?.click()}
        className={cn(
          'relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-secondary/30 text-center transition-colors',
          compact ? 'p-3' : 'p-6',
          dragOver && 'border-primary bg-accent',
          (disabled || uploading) && 'cursor-not-allowed opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={disabled || uploading}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />

        {isImage && previewUrl ? (
          <div className="relative">
            <img
              src={previewUrl}
              alt={label ?? 'Preview'}
              className={cn('rounded-md border border-border object-cover', compact ? 'h-16 w-16' : 'h-28 w-auto max-w-56')}
            />
            {!uploading && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setPreviewUrl(null)
                }}
                className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            {uploading ? (
              <Loader2 className="size-5 animate-spin text-primary" />
            ) : isImage ? (
              <ImageIcon className="size-5" />
            ) : (
              <UploadCloud className="size-5" />
            )}
            <p className="text-xs">
              {uploading ? `Uploading… ${progress}%` : (
                <>
                  <span className="font-medium text-foreground">Click to upload</span> or drag and drop
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {uploading && <Progress value={progress} className="h-1" />}

      {error && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          {error}
        </p>
      )}

      {maxMb && !error && (
        <p className="text-xs text-muted-foreground">
          Max {maxMb} MB — {accept.replace('image/*', 'JPEG, PNG, WebP, GIF')}
        </p>
      )}
    </div>
  )
}
