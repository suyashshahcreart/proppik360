import { useEffect, useMemo, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export const SELECT_OTHER = '__other__'

interface SelectWithOtherProps {
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  triggerClassName?: string
  disabled?: boolean
}

export function SelectWithOther({
  value,
  onValueChange,
  options,
  placeholder,
  triggerClassName,
  disabled,
}: SelectWithOtherProps) {
  const presetValues = useMemo(() => new Set(options.map((option) => option.value)), [options])
  const [extraOptions, setExtraOptions] = useState<Array<{ value: string; label: string }>>([])
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherDraft, setOtherDraft] = useState('')

  useEffect(() => {
    if (!value || presetValues.has(value)) return
    setExtraOptions((current) =>
      current.some((option) => option.value === value)
        ? current
        : [...current, { value, label: value }],
    )
  }, [value, presetValues])

  const mergedOptions = useMemo(() => {
    const seen = new Set<string>()
    const merged: Array<{ value: string; label: string }> = []
    for (const option of [...options, ...extraOptions]) {
      if (seen.has(option.value)) continue
      seen.add(option.value)
      merged.push(option)
    }
    return merged
  }, [options, extraOptions])

  const selectValue = otherOpen ? SELECT_OTHER : value || undefined

  function handleSelectChange(next: string) {
    if (next === SELECT_OTHER) {
      setOtherOpen(true)
      setOtherDraft('')
      return
    }
    setOtherOpen(false)
    onValueChange(next)
  }

  function commitOther() {
    const trimmed = otherDraft.trim()
    if (!trimmed) return
    setExtraOptions((current) =>
      current.some((option) => option.value === trimmed)
        ? current
        : [...current, { value: trimmed, label: trimmed }],
    )
    setOtherOpen(false)
    onValueChange(trimmed)
    setOtherDraft('')
  }

  return (
    <div className="w-full">
      <Select value={selectValue} onValueChange={handleSelectChange} disabled={disabled}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {mergedOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          <SelectItem value={SELECT_OTHER}>Other…</SelectItem>
        </SelectContent>
      </Select>
      {otherOpen && (
        <div className="mt-1.5 flex gap-1.5">
          <Input
            className="h-8 text-sm"
            value={otherDraft}
            onChange={(event) => setOtherDraft(event.target.value)}
            placeholder="Enter value…"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitOther()
              }
            }}
          />
          <Button type="button" size="sm" variant="secondary" onClick={commitOther}>
            Add
          </Button>
        </div>
      )}
    </div>
  )
}
