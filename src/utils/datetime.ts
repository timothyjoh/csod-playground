import { formatISO, subDays } from 'date-fns'

export const nowInteger = () => Date.now()
export const nowISO = () => formatISO(new Date())
export const sleep = (sec: number) => {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000))
}

export const daysAgo = (days: number) => subDays(new Date(), days)
export const daysAgoISO = (days: number) => formatISO(daysAgo(days))

export const yesterday = () => subDays(new Date(), 1)
export const isLessThaDayAgo = (iso?: string) => {
  if (!iso) return false
  return new Date(iso) > yesterday()
}

export const enrollmentStartDateIso = formatISO(new Date('2022-01-01'))
