import { useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { FileDropzone } from '@/components/media/FileDropzone'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface TourThumbnailButtonProps {
  tourId: string
  tourName?: string | null
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  onUploaded?: () => void
}

export function TourThumbnailButton({
  tourId,
  tourName,
  variant = 'outline',
  size = 'sm',
  onUploaded,
}: TourThumbnailButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        <ImageIcon className="size-4" />
        Tour Thumbnail
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tour Thumbnail</DialogTitle>
            <DialogDescription>
              Upload a thumbnail image
              {tourName ? (
                <>
                  {' '}
                  for <strong>{tourName}</strong>
                </>
              ) : null}
              . Replaces any existing thumbnail.
            </DialogDescription>
          </DialogHeader>
          <FileDropzone
            collection="tour_thumbnail"
            entityType="tour"
            entityId={tourId}
            accept="image/*"
            maxBytes={5 * 1024 * 1024}
            onUploaded={() => {
              setOpen(false)
              onUploaded?.()
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
