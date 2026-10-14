import { useCallback, useEffect, useState } from 'react'

/** Card-level fullscreen overlay (CSS), distinct from browser Fullscreen API. */
export function useCardFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  const enter = useCallback(() => setIsFullscreen(true), [])
  const exit = useCallback(() => setIsFullscreen(false), [])
  const toggle = useCallback(() => setIsFullscreen((v) => !v), [])

  useEffect(() => {
    if (!isFullscreen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setIsFullscreen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [isFullscreen])

  return { isFullscreen, enter, exit, toggle }
}
