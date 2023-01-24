import fetch from 'node-fetch'
import type { Response } from 'node-fetch'
import 'dotenv/config'

import { CSOD_API_HOST, SYNC_API_TOKEN } from './env'
import logger from './logger'
import getCSODToken from './getCSODToken'
import { sleep } from './datetime'

export type FetchResponse = {
  ok: boolean
  body: unknown
  code?: number
  response?: Response
}

type ApiMethod = 'GET' | 'POST' | undefined

export const syncToEndpoint = async <T>(
  uri: string,
  payload: unknown,
  method: ApiMethod = 'POST'
) => {
  const headers = { 'Auth-Token': SYNC_API_TOKEN }
  return await apiFetch<T>(uri, headers, payload, method)
}

export const fetchFromCSOD = async <T>(
  uripath: string,
  method: ApiMethod,
  payload?: unknown,
  token: string | null = null
) => {
  token = token ?? (await getCSODToken())
  const uri = `${CSOD_API_HOST}${uripath}`
  const headers = { Authorization: token }
  logger.log(' --> Fetching from CSOD', { uri, headers })
  return await apiFetch<T>(uri, headers, payload, method)
}

export type ODataResponse<T> = {
  '@odata.count'?: number
  value: T[]
  '@odata.nextLink'?: string
}

export const paginatedFetchFromCSOD = async <T>(
  uripath: string,
  collection?: T[],
  token?: string
): Promise<T[]> => {
  token = token ?? (await getCSODToken())
  const uri = collection ? uripath : `${CSOD_API_HOST}${uripath}`
  const headers = { Authorization: token }
  collection ??= []
  logger.log(' --> Recursive fetching from CSOD', { uri, collection })
  const [response, fetchError] = await apiFetch<ODataResponse<T>>(
    uri,
    headers,
    null,
    'GET'
  )

  if (fetchError) {
    logger.error('paginatedFetchFromCSOD', { fetchError })
    return collection
  }

  collection = [...collection, ...response['value']]
  const nextLink = response['@odata.nextLink']

  if (!nextLink) {
    logger.log('paginatedFetchFromCSOD - FETCHED ALL', {
      uri,
      collection,
      response,
    })

    return collection
  }

  return await paginatedFetchFromCSOD<T>(nextLink, collection, token)
}

const apiFetch = async <T>(
  uri: string,
  headers: Record<string, string>,
  payload: unknown,
  method: ApiMethod = 'POST',
  delay = 0
): Promise<[T, null] | [null, FetchResponse]> => {
  await sleep(delay)
  try {
    const response = await fetch(uri, {
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      method,
      body: payload ? JSON.stringify(payload) : undefined,
    })
    const body = (await response.json()) as T
    const code = response.status
    const statusText = response.statusText

    const tooManyRequests = code === 429
    if (tooManyRequests) {
      if (delay <= 60) {
        logger.warn(`apiFetch - 429 too many requests (Delay: ${delay})`, {
          body,
          delay,
          uri,
        })
        return apiFetch(uri, headers, payload, method, delay + 15)
      } else {
        logger.error('apiFetch - 429 Gave up', { body, uri })
        return [
          null,
          { ok: false, code: 0, body: { message: '429 - Gave up' } },
        ]
      }
    }

    const ok = code === 200
    if (!ok) {
      logger.error('apiFetch - BAD RESPONSE', { body, code, statusText, uri })
      return [null, { ok: true, code, body, response }]
    }
    return [body, null]
  } catch (error) {
    logger.error('apiFetch - XXX Fetching', { error, uri })
    return [
      null,
      { ok: false, code: 0, body: { message: 'fetch throwed up', error } },
    ]
  }
}
