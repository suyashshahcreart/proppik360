import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface Msg91TemplateRow {
  key: string
  template_id: string
}

const SUGGESTED_KEYS = ['login_otp', 'tour_access_otp', 'registration_otp'] as const

interface Msg91TemplatesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: Msg91TemplateRow[]
  onSave: (rows: Msg91TemplateRow[]) => void | Promise<void>
  readOnly?: boolean
}

export function Msg91TemplatesDialog({
  open,
  onOpenChange,
  value,
  onSave,
  readOnly = false,
}: Msg91TemplatesDialogProps) {
  const [rows, setRows] = useState<Msg91TemplateRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setRows(value.length > 0 ? value.map((r) => ({ ...r })) : [{ key: 'tour_access_otp', template_id: '' }])
      setError(null)
    }
  }, [open, value])

  const addRow = () => {
    const used = new Set(rows.map((r) => r.key))
    const suggested = SUGGESTED_KEYS.find((k) => !used.has(k))
    setRows((r) => [...r, { key: suggested ?? '', template_id: '' }])
  }

  const removeRow = (index: number) => {
    setRows((r) => r.filter((_, i) => i !== index))
  }

  const updateRow = (index: number, patch: Partial<Msg91TemplateRow>) => {
    setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const handleSave = async () => {
    const cleaned = rows
      .map((r) => ({ key: r.key.trim(), template_id: r.template_id.trim() }))
      .filter((r) => r.key.length > 0)

    const keys = cleaned.map((r) => r.key)
    if (new Set(keys).size !== keys.length) {
      setError('Duplicate template keys are not allowed')
      return
    }
    for (const r of cleaned) {
      if (!/^[a-z][a-z0-9_]*$/.test(r.key)) {
        setError(`Invalid key "${r.key}" — use snake_case (e.g. tour_access_otp)`)
        return
      }
      if (!r.template_id) {
        setError(`Template ID is required for "${r.key}"`)
        return
      }
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(cleaned)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message || 'Could not save templates')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>MSG91 Templates Management</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Manage your MSG91 Flow template IDs. Tour-admin OTP uses{' '}
          <code className="text-xs">tour_access_otp</code> (falls back to{' '}
          <code className="text-xs">login_otp</code>).
        </p>
        <div className="rounded-md border border-info/30 bg-info-subtle/40 px-3 py-2 text-xs text-muted-foreground">
          Templates are saved in platform settings. Auth key stays in server <code>.env</code>.
        </div>

        {!readOnly && (
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={addRow}>
              <Plus className="size-4" />
              Add Template
            </Button>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="max-h-[50vh] overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template Key</TableHead>
                <TableHead>Template ID</TableHead>
                {!readOnly && <TableHead className="w-16 text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={readOnly ? 2 : 3} className="text-center text-muted-foreground">
                    No templates yet
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Input
                        value={row.key}
                        disabled={readOnly}
                        placeholder="tour_access_otp"
                        onChange={(e) => updateRow(index, { key: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.template_id}
                        disabled={readOnly}
                        placeholder="MSG91 Flow template id"
                        className="font-mono text-xs"
                        onChange={(e) => updateRow(index, { template_id: e.target.value })}
                      />
                    </TableCell>
                    {!readOnly && (
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => removeRow(index)}
                          aria-label="Delete template"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save Templates'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
