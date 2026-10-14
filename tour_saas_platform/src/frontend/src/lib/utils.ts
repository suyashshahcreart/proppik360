import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Public tour id for URLs, uploads, and display (6-digit tour_id). */
export function tourPublicId(tour: { tour_id?: string; id?: number | string }): string {
  if (tour.tour_id) return tour.tour_id
  return String(tour.id ?? '')
}
