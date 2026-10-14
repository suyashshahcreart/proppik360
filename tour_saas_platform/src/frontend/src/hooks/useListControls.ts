import { useEffect, useMemo, useState } from 'react'

interface UseListControlsOptions<T> {
  items: T[]
  filterFn?: (item: T, query: string) => boolean
  defaultPageSize?: number
  pageSizeOptions?: number[]
}

export function useListControls<T>({
  items,
  filterFn,
  defaultPageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
}: UseListControlsOptions<T>) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query || !filterFn) return items
    return items.filter((item) => filterFn(item, query))
  }, [items, search, filterFn])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    setPage(1)
  }, [search, pageSize, total])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = total === 0 ? 0 : Math.min(page * pageSize, total)

  function handlePageSizeChange(next: number) {
    setPageSize(next)
    setPage(1)
  }

  return {
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    setPageSize: handlePageSizeChange,
    pageSizeOptions,
    filtered,
    paginated,
    total,
    totalPages,
    from,
    to,
  }
}
