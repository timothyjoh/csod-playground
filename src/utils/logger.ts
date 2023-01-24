/* eslint-disable @typescript-eslint/no-explicit-any */
import { mapToObj } from 'remeda'

const safeStringify = (obj: unknown) => {
  let cache: unknown[] = []

  const replacer = (_: string, value: any) => {
    if (value instanceof Error) {
      const newValue = Object.getOwnPropertyNames(value).reduce(
        (obj, propName) => {
          obj[propName] = value[propName as keyof typeof value]
          return obj
        },
        { name: value.name } as Record<string, unknown>
      )
      return newValue
    } else if (typeof value === 'object' && value !== null) {
      return cache.includes(value)
        ? '[CIRCULAR REFERENCE]'
        : cache.push(value) && value
    } else if (value === undefined) {
      return '_UNDEFINED_'
    } else {
      return value
    }
  }

  const retVal = JSON.stringify(obj, replacer, 2)
  cache = []
  return retVal
}

const methods = ['info', 'log', 'warn', 'error'] as const

const stringifyArgs = (args: any[]) => args.map(safeStringify)

const logger = mapToObj(methods, (method) => [
  method,
  (...args: any[]): void => console[method](...stringifyArgs(args)),
])

export default logger
