import { useEffect, useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getLucideIcon, isImageUrl, parseCategoryIcon } from '@/lib/category-icons'
import { api } from '@/services/api'

const mediaUrlCache = new Map<string, string>()

interface CategoryIconProps {
  icon: string | null | undefined
  className?: string
  imgClassName?: string
  fallbackClassName?: string
}

function resolveMediaUrl(mediaId: string): Promise<string | null> {
  const cached = mediaUrlCache.get(mediaId)
  if (cached) return Promise.resolve(cached)

  return api.media
    .get(mediaId)
    .then((item) => {
      mediaUrlCache.set(mediaId, item.url)
      return item.url
    })
    .catch(() => null)
}

/** Renders a property category icon (lucide, URL, CSS class, or media library). */
export function CategoryIcon({
  icon,
  className,
  imgClassName,
  fallbackClassName,
}: CategoryIconProps) {
  const parsed = parseCategoryIcon(icon)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)

  useEffect(() => {
    if (parsed?.type !== 'media') {
      setMediaUrl(null)
      return
    }

    let cancelled = false
    void resolveMediaUrl(parsed.value).then((url) => {
      if (!cancelled) setMediaUrl(url)
    })

    return () => {
      cancelled = true
    }
  }, [parsed?.type, parsed?.value])

  if (!parsed) {
    return <ImageIcon className={cn('text-muted-foreground', fallbackClassName ?? className)} />
  }

  if (parsed.type === 'lucide') {
    const Lucide = getLucideIcon(parsed.value)
    if (!Lucide) {
      return <ImageIcon className={cn('text-muted-foreground', fallbackClassName ?? className)} />
    }
    return <Lucide className={className} />
  }

  if (parsed.type === 'url' || (parsed.type === 'media' && mediaUrl)) {
    const src = parsed.type === 'media' ? mediaUrl! : parsed.value
    return (
      <img
        src={src}
        alt=""
        className={cn('object-contain', imgClassName ?? className)}
      />
    )
  }

  if (parsed.type === 'media' && !mediaUrl) {
    return <ImageIcon className={cn('text-muted-foreground animate-pulse', fallbackClassName ?? className)} />
  }

  if (parsed.type === 'custom') {
    if (isImageUrl(parsed.value)) {
      return (
        <img
          src={parsed.value}
          alt=""
          className={cn('object-contain', imgClassName ?? className)}
        />
      )
    }
    return <i className={cn(parsed.value, className)} aria-hidden />
  }

  return <ImageIcon className={cn('text-muted-foreground', fallbackClassName ?? className)} />
}
