import { useCallback, useEffect, useState } from 'react'

function isFullscreenSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    document.fullscreenEnabled !== false
  )
}

export function useFullscreen() {
  const [isSupported] = useState(isFullscreenSupported)
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  )

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = useCallback(async () => {
    if (!isSupported || typeof document === 'undefined') return

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // Fullscreen may be blocked by the browser
    }
  }, [isSupported])

  return { isSupported, isFullscreen, toggle }
}
