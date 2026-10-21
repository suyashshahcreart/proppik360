import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useTheme } from '@/components/providers/ThemeProvider'

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      richColors
      closeButton
      expand={false}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg',
          title: 'group-[.toast]:font-medium',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-secondary group-[.toast]:text-secondary-foreground',
          // Semantic surfaces (also reinforced by richColors)
          success:
            '!border-success/30 !bg-success-subtle !text-success [&_[data-icon]]:!text-success',
          error:
            '!border-destructive/30 !bg-destructive-subtle !text-destructive [&_[data-icon]]:!text-destructive',
          warning:
            '!border-warning/30 !bg-warning-subtle !text-warning [&_[data-icon]]:!text-warning',
          info: '!border-info/30 !bg-info-subtle !text-info [&_[data-icon]]:!text-info',
          loading: 'group-[.toaster]:bg-card group-[.toaster]:text-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
