import fetch from 'node-fetch'
import 'dotenv/config'
import { sub, formatISO, subDays, parseISO } from 'date-fns'
import { pick, mapToObj } from 'remeda'

import { color } from 'console-log-colors'
import { isFunctionDeclaration } from 'typescript'

const CSOD_API_HOST = process.env.CSOD_API_HOST
const CLIENT_ID = process.env.CSOD_API_CLIENT_ID
const CLIENT_SECRET = process.env.CSOD_API_CLIENT_SECRET
const JOB_CODES = process.env.JOB_CODES
const SYNC_API_TOKEN = ''

const displayDate = (str: string | null) =>
  str &&
  formatISO(parseISO(str), {
    format: 'extended',
    representation: 'date',
  })

console.log({ launch: displayDate('2023-01-23T18:17:19+0000') })

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

export const nowInteger = () => Date.now()
export const nowISO = () => formatISO(new Date())

export const daysAgo = (days: number) => subDays(new Date(), days)
export const daysAgoISO = (days: number) => formatISO(daysAgo(days))

export const yesterday = () => subDays(new Date(), 1)
export const isLessThaDayAgo = (iso?: string) => {
  if (!iso) return false
  return new Date(iso) > yesterday()
}

const getOauthToken = async () =>
  fetch(`${CSOD_API_HOST}/oauth2/token`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      grantType: 'client_credentials',
      scope: 'all',
    }),
  })

const fetchAPIToken = async () => {
  const tokenResponse = await getOauthToken()
  const { token_type, access_token } =
    (await tokenResponse.json()) as TokenResponse
  return `${token_type} ${access_token}`
}

const apiToken = (() => {
  let token: string
  let expiration: Date

  return {
    async get() {
      const now = new Date()
      if (!token || !expiration || now > expiration) {
        token = await fetchAPIToken()
        expiration = new Date()
        expiration.setSeconds(expiration.getSeconds() + 15)
      }
      return token
    },
  }
})()

const getCSODToken = apiToken.get

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
      return [null, { ok: true, code, body }]
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

export interface CSODTranscript {
  reg_num: number
  user_lo_status_id: number
  user_lo_score?: number
  user_lo_create_dt: string
  user_lo_reg_dt: string
  user_lo_start_dt?: string
  user_lo_comp_dt?: string
  user_lo_last_access_dt?: string
  user_lo_minutes_participated: number
  user_lo_num_attempts?: number
  user_lo_assignor_id: number
  user_lo_assignor_ref: string
  user_lo_assignor: string
  user_lo_comment?: string
  user_lo_min_due_date: string
  is_removed: boolean
  user_lo_removed_reason_id?: number
  user_lo_removed_comments?: string
  user_lo_removed_dt?: string
  completed_sco: number
  archived: boolean
  user_lo_assigned_comments: string
  user_lo_assigned_dt: string
  training_purpose?: string
  training_purpose_category?: string
  user_lo_last_action_dt: string
  user_lo_pct_complete: number
  exemptor_id?: number
  exempt_comment?: string
  approver_exempt_comment?: string
  exempt_dt?: string
  exempt_reason_id?: number
  exempt_approver_reason_id?: number
  exempt_reason?: string
  exempt_approver_reason?: string
  is_assigned: boolean
  is_suggested: boolean
  is_required: boolean
  is_latest_reg_num: number
  is_archive: 0
  user_lo_pass: boolean
  user_lo_cancellation_reason_id?: number
  user_lo_cancellation_reason?: string
  user_lo_withdrawal_reason_id?: number
  user_lo_withdrawal_reason?: string
  user_lo_from_training_plan: string
  user_lo_available_dt?: string
  user_lo_training_link_expiration_date?: string
  user_lo_timezone_code?: string
  user_lo_withdrawal_date?: string
  transcript_badge_id: number
  transcript_badge_points: number
  transcript_training_points: number
  transc_user_id: number
  transc_object_id: string
  user_lo_status_group_id: number
  is_latest_version_on_transcript: boolean
  user_lo_last_modified_dt: string
  _last_touched_dt_utc: string
  is_express_class: boolean
  user_lo_equivalent_object_id?: number
  user_lo_equivalency_type?: string
  user_lo_delivery_method_id: number
  is_standalone: boolean
  user_lo_remover_id: null
}

export const fetchUserTranscript = async (
  userId: number,
  afterDate: string = '2022-12-15'
): Promise<CSODTranscript[]> => {
  const filters = [
    'is_archive eq 0',
    `transc_user_id eq ${userId}`,
    `user_lo_assigned_dt ge ${formatISO(new Date(afterDate))}`,
  ]

  const queryVars = ['$count=true', `$filter=${filters.join(' and ')}`]
  const query = encodeURI(queryVars.join('&'))
  const apiUrl = `/x/odata/api/views/vw_rpt_transcript?${query}`

  return await paginatedFetchFromCSOD<CSODTranscript>(apiUrl)
}

interface LoggableObject {
  inactiveJobCodes: string[]
  activeUsers: UserDetails[]
  inactiveUsers: UserDetails[]
}
const LOGGABLES: LoggableObject = {
  inactiveJobCodes: [],
  activeUsers: [],
  inactiveUsers: [],
}

export const sleep = (sec: number) => {
  console.log(`sleeping ${sec} seconds`)
  return new Promise((resolve) => setTimeout(resolve, sec * 1000))
}

interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
}

const tokenPayload = JSON.stringify({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  grantType: 'client_credentials',
  scope: 'all',
})

const getAPIToken = async () => {
  const tokenResponse = await getOauthToken()
  const { token_type, access_token } =
    (await tokenResponse.json()) as TokenResponse
  return `${token_type} ${access_token}`
}

const getAllUsers = async (token: string) => {
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user`
  let allUsers: any[] = []
  while (1) {
    const usersResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    const userPayload: any = await usersResp.json()
    const users: any[] = userPayload.value
    allUsers = [...allUsers, ...users]
    if (users.length < 1000) {
      break
    } else {
      apiUrl = userPayload['@odata.nextLink']
    }
  }
  return allUsers
}

const getUsersByFilter = async (token: string, filter: string) => {
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user?${filter}`
  console.log(apiUrl)
  let allUsers: any[] = []
  while (1) {
    const usersResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    console.log({ API_RESPONSE: pick(usersResp, ['status', 'statusText']) })
    const userPayload: any = await usersResp.json()
    const users: any[] = userPayload.value
    allUsers = [...allUsers, ...users]
    if (users.length < 1000) {
      break
    } else {
      apiUrl = userPayload['@odata.nextLink']
    }
  }
  return allUsers
}
const getUsersBySesa = async (token: string, sesa: string) => {
  const filter = `$filter=user_ref eq '${sesa}'`
  return await getUsersByFilter(token, filter)
}
const getUsersByEmail = async (token: string, email: string) => {
  const filter = `$filter=user_email eq '${email}'`
  return await getUsersByFilter(token, filter)
}

const filterUsers = async (token: string, filter: string) => {
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user?${filter}`
  console.log(apiUrl)
  let allUsers: any[] = []
  while (1) {
    const usersResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    console.log({ ...pick(usersResp, ['status', 'statusText']) })
    const userPayload: any = await usersResp.json()
    const users: any[] = userPayload.value
    allUsers = [...allUsers, ...users]
    if (users.length < 1000) {
      break
    } else {
      apiUrl = userPayload['@odata.nextLink']
    }
  }
  return allUsers
}

const getUsersByPagination = async (
  token: string,
  pageNo: number,
  top: number
) => {
  if (pageNo < 0) {
    return null
  }
  pageNo = pageNo === 0 ? pageNo : pageNo - 1
  const apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user?$top=${top}&$pageNo=${pageNo}&$count=true`
  console.log(apiUrl)
  const usersResp = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    method: 'GET',
  })
  const userPayload: any = await usersResp.json()
  return {
    pageNo,
    users: userPayload['value'],
    total: userPayload['@odata.count'],
  }
}
interface UserDetails {
  user_id: number
  user_ref: string
  user_status_id: number
  user_name_first: string
  user_name_last: string
  user_email: string
  user_mgr_email: string
  user_mgr_ref: string
  user_mgr_name_first: string
  user_mgr_name_last: string
  user_mgr_id: number
  user_employment_status_id: number
  user_deactivation_dt: string
  user_activation_dt: string
  user_termination_dt: string
  user_termination_reason_id: number
  user_termination_type: string
  user_type: string
  ou_id?: number
  ou_title?: string
  job_code?: string
  updated_at?: string
}

const fakeUser = (user_id: number, err: Error | unknown): UserDetails => {
  const fake = {
    user_status_id: 999,
    user_ref: 'blank',
    user_id,
    user_activation_dt: 'null',
    user_deactivation_dt: 'null',
    user_email: '',
    user_employment_status_id: 0,
    user_mgr_email: '',
    user_mgr_id: 0,
    user_mgr_name_first: '',
    user_mgr_name_last: '',
    user_mgr_ref: 'oof',
    user_name_first: 'blanky',
    user_name_last: 'Blankenson',
    user_termination_dt: 'today',
    user_termination_reason_id: 1,
    user_termination_type: 'fraud',
    user_type: 'non-existant',
  }
  console.log(`FAKE USER GENERATED`, { fake, err })
  return fake
}

const getUserInfoById = async (
  token: string,
  userId: number
): Promise<UserDetails> => {
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user?$filter=user_id eq ${userId}`
  console.log(apiUrl)
  const userResp = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    method: 'GET',
  })
  try {
    const code = userResp.status
    const statusText = userResp.statusText

    if (code === 200) {
      const user: any = await userResp.json()
      return user.value[0]
    }
    if (code === 429) {
      console.error('429 TOO MANY REQUESTS')
      await sleep(60)
      return await getUserInfoById(token, userId)
    }
    await sleep(20)
    return fakeUser(userId, { code, statusText })
  } catch (err) {
    return fakeUser(userId, err)
  }
}

interface OrgUnits {
  ou_id: number
  title: string
  ref: string
}

interface OrgUnitsResponse {
  value: OrgUnits[]
}
const getOUForRef = async (
  token: string,
  ref: string = 'S'
): Promise<OrgUnitsResponse> => {
  const filter = `type_id eq 4 and startswith(ref,'${ref}') and active eq true`
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_ou?$count=true&$filter=${filter}`
  console.log(apiUrl)
  try {
    const ouResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    const ou = (await ouResp.json()) as OrgUnitsResponse
    return ou
  } catch (err) {
    console.error({ err })
    return { value: [] }
  }
}

const getOUForJobCodes = async (
  token: string,
  codes: string[]
): Promise<OrgUnitsResponse> => {
  const filter = `type_id eq 4 and ref in (${codes
    .map((c) => `'${c}'`)
    .join(',')}) and active eq true`
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_ou?$count=true&$filter=${filter}`
  console.log(apiUrl)
  try {
    const ouResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    console.log({ ouResp })
    const ou = (await ouResp.json()) as OrgUnitsResponse
    return ou
  } catch (err) {
    console.error({ err })
    return { value: [] }
  }
}

const getOUidByJobCode = async (
  token: string,
  jobCode: string
): Promise<OrgUnits> => {
  const filter = `type_id eq 4 and ref eq '${jobCode}' and active eq true`
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_ou?$count=true&$filter=${filter}`
  console.log(apiUrl)
  try {
    const ouResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    console.log({ ouResp })
    const ou = (await ouResp.json()) as OrgUnitsResponse
    if (ou.value.length === 0) {
      console.error(`JOBCODE ${jobCode} is not active`)
      LOGGABLES.inactiveJobCodes.push(jobCode)
    }
    return ou.value[0]
  } catch (err) {
    console.error({ err })
    return { ou_id: 0, title: 'Not found', ref: jobCode }
  }
}

const getOUByID = async (
  token: string,
  id: string | number
): Promise<OrgUnitsResponse> => {
  const filter = `type_id eq 4 and ou_id eq ${id}`
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_ou?$count=true&$filter=${filter}`
  // console.log(apiUrl)
  try {
    const ouResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    const ou = (await ouResp.json()) as OrgUnitsResponse
    return ou
  } catch (err) {
    console.error({ err })
    return { value: [] }
  }
}

const getAllOUs = async (token: string): Promise<OrgUnitsResponse> => {
  const filter = `startswith(ref,'HTF8')`
  const search = ``
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_ou?$count=true&$filter=${filter}`
  console.log(apiUrl)
  try {
    const ouResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    console.log({ ouResp })
    const ou = (await ouResp.json()) as OrgUnitsResponse
    return ou
  } catch (err) {
    console.error({ err })
    return { value: [] }
  }
}

interface UserByOU {
  user_id: number
  ou_id: number
  status_id: number | null
}
interface UserByOUResponse {
  value: UserByOU[]
}
const getUsersByOUid = async (
  token: string,
  ou_id: string | number
): Promise<UserByOU[]> => {
  const filter = `ou_id eq ${ou_id}`
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user_ou?$count=true&$filter=${filter}`
  console.log(apiUrl)
  let allUsers: any[] = []
  while (1) {
    const ouResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    const userPayload = (await ouResp.json()) as UserByOUResponse
    const users = userPayload.value
    allUsers = [...allUsers, ...users]
    if (users.length < 1000) {
      break
    } else {
      apiUrl = userPayload['@odata.nextLink']
    }
  }
  return allUsers
}
const getOUFromUser = async (
  token: string,
  user_id: string | number
): Promise<UserByOUResponse> => {
  const filter = `user_id eq ${user_id}`
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user_ou?$count=true&$filter=${filter}`
  console.log(apiUrl)
  const ouResp = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    method: 'GET',
  })
  const users = (await ouResp.json()) as UserByOUResponse
  return users
}

const getOUStatus = async (token: string): Promise<any> => {
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user_ou_status`
  console.log(apiUrl)
  const ouResp = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    method: 'GET',
  })
  const body = await ouResp.json()
  return body
}
const getOUType = async (token: string): Promise<any> => {
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_ou_type`
  console.log(apiUrl)
  const ouResp = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    method: 'GET',
  })
  const body = await ouResp.json()
  return body
}

const getLanguages = async (token: string): Promise<{ value: any[] }> => {
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_language`
  const langResp = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    method: 'GET',
  })
  const languages = (await langResp.json()) as { value: any[] }
  return languages
}

interface TranscriptItem {
  __type: string
  CompletionDate: string
  DueDate: string | null
  LastAccessDate: string | null
  LaunchUrl: string
  LoId: string
  LoProviderId: string
  LoType?: string | null
  ProviderName: string
  RegistrationDate: string
  Score: string
  Status: string
  Subjects: any[]
  Title: string
  TotalTime: string
  TrainingHours: string
  EndDateTime: string
  Parts: any[]
  StartDateTime: string
}

// const transcriptSearch = async (token: string, user: string) => {
//   const loid = `LOID=7e1fa25c-0273-412e-a22e-62a10d15d35d`
//   const query = `UserId=${user}`
//   let apiUrl = `${CSOD_API_HOST}/LOTranscript/TranscriptSearch?${query}`
//   console.log(apiUrl)
//   const transcriptResp = await fetch(apiUrl, {
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: token,
//     },
//     method: 'GET',
//   })
//   console.log({ transcriptResp })
//   const transcript = await transcriptResp.json()
//   console.log({ transcript, thing: JSON.stringify(transcript) })
// }

const transcriptSearch = async (token: string, from: number) => {
  const perPage = 50
  let pageNo = 1
  let transcriptsMax = 100
  const start = sub(new Date(), { days: from })
  const now = new Date()
  const weekAgo = formatISO(sub(new Date(), { days: 77 }))
  const filters = [
    `is_assigned eq true`,
    `is_archive eq 0`,
    `user_lo_last_action_dt ge ${weekAgo}`, // last_touched
    `user_lo_min_due_date ne null`,
  ]
  const queryVars = [`count=true`, `$filter=${filters.join(' and ')}`]
  const query = `${encodeURI(queryVars.join('&'))}`
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_transcript?${query}`
  let transcripts: any[] = []
  while (apiUrl) {
    console.log({ pageNo, apiUrl })
    const apiResponse = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    const payload: any = await apiResponse.json()
    if (payload.error) {
      return [{ ...payload, apiUrl }]
    }
    transcriptsMax = payload['@odata.count']
    console.log('Transcript Search Payload', {
      pageNo,
      transcriptsMax,
      apiUrl,
      payload,
    })
    try {
      const trans: any[] = payload.value
      transcripts = [...transcripts, ...trans]
      console.log({ firstTranscript: trans[0] })
      apiUrl = payload['@odata.nextLink']
      pageNo++
    } catch (err) {
      console.error({ err })
    }
    console.log('sleeping')
    await sleep(1)
  }
  return transcripts
}

interface TrainingItem {
  ObjectId: string
  Type: string
  Title: string
  Provider: string
  Descr: string
  DeepLinkURL: string
  Subjects: any[]
  AvailableLanguages: any[]
  Recommendations: any[]
  EventNumber: string
  Objectives: string
  Duration: string
  PriceCurrency: string
  PriceAmount: number
  Sessions: any[]
  Fields: any[]
  SectionDetails?: any[]
  LoDetails?: any[]
}
interface LODetailsData {
  trainingItem: TrainingItem
  Result: string
  Reason: string | null
}
interface DataResults {
  data?: LODetailsData[]
}

const learningObjectSearch = async (token: string, loid: string) => {
  let pageNo = 1
  let coursesMax = 100
  const filters = [`lo_object_id eq ${loid}`]
  const queryVars = [
    `count=true`,
    `$filter=${filters.join(' and ')}`,
    // `top=${perPage}`,
    // `skip=${(pageNo - 1) * perPage}`,
  ]
  const query = `${encodeURI(queryVars.join('&'))}`
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_training?${query}`
  let courses: any[] = []
  while (apiUrl) {
    console.log({ pageNo, apiUrl })
    const apiResponse = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    try {
      const payload: any = await apiResponse.json()
      if (payload.error) {
        return [{ ...payload, apiUrl }]
      }
      coursesMax = payload['@odata.count']
      console.log('Learning Object Search Payload', {
        pageNo,
        coursesMax,
        apiUrl,
        payload,
      })
      try {
        const trans: any[] = payload.value
        courses = [...courses, ...trans]
        console.log({ firstLO: trans[0] })
        apiUrl = payload['@odata.nextLink']
        pageNo++
      } catch (err) {
        console.error({ err })
      }
    } catch (err) {
      console.log({ apiResponse, apiUrl })
      return [{ apiResponse, apiUrl }]
    }
  }
  return courses
}

const getLODetails = async (
  token: string,
  loid?: string
): Promise<TrainingItem | { error: { code?: string; message: string } }> => {
  const query = loid ? `ObjectID=${loid}` : ''
  let apiUrl = `${CSOD_API_HOST}/LO/GetDetails?${query}`
  console.log(apiUrl)
  const loDetailsResp = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    method: 'GET',
  })
  // console.log({ loDetailsResp })
  const loDetails = (await loDetailsResp.json()) as DataResults
  if (!loDetails.data) {
    console.error({ loDetailsResp, loDetails })
  }
  const LO = loDetails.data
    ? loDetails.data[0].trainingItem
    : { error: { message: 'No Training Item Found' } }
  // console.log({
  //   loDetails,
  //   trainingItem: loDetails.data[0].trainingItem,
  //   Fields,
  //   Subjects,
  //   Sessions,
  //   SectionDetails,
  //   LoDetails,
  // })
  return LO
}
const getEnrollmentCustomFields = async (
  token: string,
  loid?: string
): Promise<TrainingItem | { error: { code?: string; message: string } }> => {
  const filters = [`transc_cf_object_id eq ${loid}`]
  const queryVars = [
    `count=true`,
    `$filter=${filters.join(' and ')}`,
    // `top=${perPage}`,
    // `skip=${(pageNo - 1) * perPage}`,
  ]
  const query = `${encodeURI(queryVars.join('&'))}`
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_transcript?${query}`
  console.log(apiUrl)
  const loDetailsResp = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    method: 'GET',
  })
  // console.log({ loDetailsResp })
  const loDetails = (await loDetailsResp.json()) as DataResults
  const LO = loDetails.data
    ? loDetails.data[0].trainingItem
    : { error: { message: 'No Training Item Found' } }
  // console.log({
  //   loDetails,
  //   trainingItem: loDetails.data[0].trainingItem,
  //   Fields,
  //   Subjects,
  //   Sessions,
  //   SectionDetails,
  //   LoDetails,
  // })
  return LO
}

const globalSearch = async (token: string) => {
  const query = `FirstName=timothy`
  let apiUrl = `${CSOD_API_HOST}/Catalog/GlobalSearch?${query}`
  console.log(apiUrl)
  const searchResp = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    method: 'GET',
  })
  console.log({ searchResp })
  const search = (await searchResp.json()) as DataResults
  console.log({ search, thing: search.data ? search.data[0] : null })
}

const getAssignedTrainings = async (token: string, user: string) => {
  const query = `UserId=${user}`
  let apiUrl = `${CSOD_API_HOST}/TranscriptAndTask/Assigned?${query}`
  console.log(apiUrl)
  try {
    const assignedResp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    console.log({ assignedResp })
    const assigned = await assignedResp.json()
    console.log({ assigned, thing: JSON.stringify(assigned) })
    return assigned
  } catch (err) {
    return {}
  }
}

interface TranscriptData {
  data: {
    InprogressSummaryUrl: string
    Transcripts: TranscriptItem[]
    TranscriptsSummaryUrl: string
  }[]
}

const getJson = async <T>(
  token: string,
  apiUrl: string
): Promise<[T | null, Error | null]> => {
  try {
    const apiResponse = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      method: 'GET',
    })
    const data = (await apiResponse.json()) as T
    if (apiResponse.status !== 200) {
      throw { message: 'Fetch failed', apiUrl, data }
    }
    return [data, null]
  } catch (fetchError) {
    return [null, fetchError]
  }
}

const getTranscripts = async (
  token: string,
  user: string
): Promise<[TranscriptItem[], { status: string; error: unknown } | null]> => {
  let page = 1
  let transcripts: TranscriptItem[] = []
  try {
    while (page) {
      const query = `PageNumber=${page}&UserId=${user}&Language=en-US`
      let apiUrl = `${CSOD_API_HOST}/TranscriptAndTask/Transcript?${query}`
      console.log(apiUrl)
      const [transcriptData, transcriptError] = await getJson<TranscriptData>(
        token,
        apiUrl
      )
      if (transcriptData === null) {
        throw transcriptError
      }
      console.debug({ transcriptData, data: transcriptData.data })
      if (transcriptData?.data[0]?.Transcripts.length > 0) {
        transcripts = [...transcripts, ...transcriptData?.data[0]?.Transcripts]
      } else {
        break
      }
      page++
    }
    console.log('All transcripts', { transcripts })
  } catch (err) {
    console.error({ message: 'getTranscripts failed', err, user })
    return [[], err.data]
  }
  return [transcripts, null]
}

const formatEnr = (enrollment: { enr: TranscriptItem; lo: TrainingItem }) => {
  const { Title, Descr, Type, Duration, DeepLinkURL, Provider } = enrollment.lo
  const { LoId, DueDate, CompletionDate, Status, LaunchUrl } = enrollment.enr
  const output = {
    id: LoId,
    enrollment_type: Type,
    due_date: DueDate,
    completion_date: CompletionDate,
    status: Status,
    data: {
      id: LoId,
      title: Title,
      deep_link_url: `https://schneider-electric-pilot.csod.com/samldefault.aspx?ouid=5&returnurl=%252fDeepLink%252fProcessRedirect.aspx%253fmodule%253dlodetails%2526lo%253d${LoId}`,
      launch_url: `https://schneider-electric-pilot.csod.com/samldefault.aspx?ouid=5&returnurl=%252fDeepLink%252fProcessRedirect.aspx%253fmodule%253dloRegisterAndLaunch%2526lo%253d${LoId}`,
      duration: Duration,
      provider: Provider,
      course_type: Type,
      description: Descr,
      data: '',
    },
  }
  return output
}
interface Enrollment {
  __type?: string
  CompletionDate: string | null
  DueDate: string | null
  LastAccessDate: string | null
  LaunchUrl?: string
  LoId: string
  LoProviderId: string
  LoType: string
  ProviderName: string
  RegistrationDate: string
  Score: string
  Status: string | 'Completed' | 'Registered' | 'In Progress'
  Subjects?: string[]
  Title: string
  TotalTime: string | null
  TrainingHours: string | null
  EndDateTime?: string | null
  Parts?: any[]
  StartDateTime?: string
  LearningObjects?: any[]
}

interface EnrollmentImport {
  course_id: string
  due_date: string | null
  last_accessed_at: string | null
  completion_date: string | null
  status: string
  enrollment_type: string
  data: any
}

const formatEnrollmentImport = (enrollment: Enrollment): EnrollmentImport => ({
  course_id: enrollment.LoId,
  due_date: enrollment.DueDate,
  last_accessed_at: enrollment.LastAccessDate,
  completion_date: enrollment.CompletionDate,
  status: enrollment.Status,
  enrollment_type: enrollment.LoType,
  data: enrollment,
})

const trans7 = [
  {
    __type: 'CurriculumTranscriptItem:www.CornerStoneOnDemand.com/Services',
    CompletionDate: null,
    DueDate: '2022-09-30T18:29:00+0000',
    LastAccessDate: null,
    LoId: 'b64e2f80-09ea-4e67-afbe-735e46695890',
    LoProviderId: '',
    LoType: 'Curriculum',
    ProviderName: 'Cross-Functional Academy',
    RegistrationDate: '2022-09-05T17:42:00+0000',
    Score: '',
    Status: 'Registered',
    Title: 'Trust at Schneider Electric',
    TotalTime: '0000:00:00',
    TrainingHours: '0010:30:00',
    CurriculumType: 'None',
  },
  {
    __type: 'CurriculumTranscriptItem:www.CornerStoneOnDemand.com/Services',
    CompletionDate: null,
    DueDate: '2022-09-30T18:29:00+0000',
    LastAccessDate: null,
    LoId: '6df136c3-6322-4cbe-aaa0-cf80c90c41f3',
    LoProviderId: '',
    LoType: 'Curriculum',
    ProviderName: 'Digital Learning Studio',
    RegistrationDate: '2022-09-05T13:35:00+0000',
    Score: '',
    Status: 'Registered',
    Title: 'Managing Security Vulnerabilities in Schneider Electric Products',
    TotalTime: '0000:00:00',
    TrainingHours: '0002:40:00',
    CurriculumType: 'None',
  },
  {
    __type: 'CurriculumTranscriptItem:www.CornerStoneOnDemand.com/Services',
    CompletionDate: null,
    DueDate: '2022-09-30T18:29:00+0000',
    LastAccessDate: null,
    LoId: 'f08f2326-aaad-42f1-8faa-acf1e9a2a299',
    LoProviderId: '',
    LoType: 'Curriculum',
    ProviderName: 'Schneider Digital Academy.',
    RegistrationDate: '2022-08-29T16:55:00+0000',
    Score: '',
    Status: 'In Progress',
    Title: 'Cybersecurity for Schneider Electric 2022',
    TotalTime: '0000:00:00',
    TrainingHours: '0009:55:00',
    CurriculumType: 'None',
  },
  {
    __type: 'CurriculumTranscriptItem:www.CornerStoneOnDemand.com/Services',
    CompletionDate: null,
    DueDate: '2022-09-30T18:29:00+0000',
    LastAccessDate: null,
    LoId: 'b1a02c3f-cb0b-45c0-b6df-7c9b009da163',
    LoProviderId: '',
    LoType: 'Curriculum',
    ProviderName: 'Global Human Resources',
    RegistrationDate: '2022-07-29T15:55:00+0000',
    Score: '',
    Status: 'Registered',
    Title: 'We All Have Mental Health',
    TotalTime: '0000:00:00',
    TrainingHours: '0000:30:00',
    CurriculumType: 'None',
  },
  {
    __type: 'CurriculumTranscriptItem:www.CornerStoneOnDemand.com/Services',
    CompletionDate: null,
    DueDate: '2022-09-30T18:29:00+0000',
    LastAccessDate: null,
    LoId: '6b66788f-9f09-4e74-afb3-50758f1e540c',
    LoProviderId: '',
    LoType: 'Curriculum',
    ProviderName: 'Digital Learning Studio',
    RegistrationDate: '2022-06-28T15:08:00+0000',
    Score: '',
    Status: 'Registered',
    Title: 'The Schneider Electric Story',
    TotalTime: '0000:00:00',
    TrainingHours: '0000:30:00',
    CurriculumType: 'None',
  },
  {
    CompletionDate: null,
    DueDate: '2022-12-31T18:29:00+0000',
    LastAccessDate: null,
    LoId: '4e9a3dd1-fea2-46d3-aae9-ed8c75c6bc50',
    LoProviderId: '',
    LoType: 'Read-Me',
    ProviderName: 'Digital Academy',
    RegistrationDate: '2022-04-14T11:37:00+0000',
    Score: '',
    Status: 'Registered',
    Title: 'Digital Boost 2.0: Check and Learn',
    TotalTime: '0000:00:00',
    TrainingHours: '0000:30:00',
  },
  {
    __type: 'SessionTranscriptItem:www.CornerStoneOnDemand.com/Services',
    CompletionDate: '2022-04-07T04:30:00+0000',
    DueDate: null,
    LastAccessDate: null,
    LoId: 'e6bc3dd5-c45f-4c35-a05a-d9c35c7a8a01',
    LoProviderId: '519829_欢迎参加SE百人大讲堂4月7日',
    LoType: 'Session',
    ProviderName: 'Cross-Functional Academy',
    RegistrationDate: '2022-04-08T02:29:00+0000',
    Score: '0',
    Status: 'Completed',
    Title: 'Ad Hoc Cross Functional',
    TotalTime: '0001:30:00',
    TrainingHours: '0001:30:00',
    EndDateTime: '2022-04-07T04:30:00+0000',
    StartDateTime: '2022-04-07T03:00:00+0000',
  },
]

const run = async () => {
  const token = await getAPIToken()
  console.log({ token }) // const allUsers = await getAllUsers(token)
  // console.log({allUsers})

  // const usersByPagination = await getUsersByPagination(token, 1, 10)
  // console.log({ usersByPagination })

  // const ou = await getAllOUs(token)
  // const ou_ids = ou.value.map((ou) => ou.ou_id)
  // console.log({
  //   ou,
  //   first: ou.value[0],
  //   refs: ou.value.map((ou) => ou.ou_id),
  //   codes: ou.value.map((ou) => ou.ref),
  // })

  // const ou2 = await getOUidByJobCode(token, 'CCCEMEA')
  // console.log({ ou2, first: ou2.value[0], val: ou2.value })
  // const ous = [ou2.value[0].ou_id]

  // for await (const ouid of ous) {
  //   const userGroup = await getUsersByOUid(token, ouid)
  //   console.log({ ouid, users: userGroup.value })
  //   console.log('______')
  // }

  // for await (const uid of ids) {
  //   let current = await getUserInfoById(token, uid)
  //   // if (current.user_status_id !== 1) continue
  //   const { user_name_first, user_ref, user_email, user_status_id } = current
  //   console.log({ user_name_first, user_ref, user_email, user_status_id })
  // }

  // const user662 = await getUserInfoById(token, 662)
  // console.log({ user662 })

  // GET LANGUAGES
  // const languages = await getLanguages(token)
  // console.log({ language: languages.value })

  // await globalSearch(token)
  // await transcriptSearch(token, "SESA33014")
  // await getAssignedTrainings(token, "SESA33014")
  // const trans = await getTranscripts(token, 'SESA23639')

  // const andy = await filterUsers(token, `$filter=user_name_last eq 'Scragg'`)
  // console.log({ andy })
  // let transcount = 0
  // console.time('getTranscript')
  // while (true) {
  //   console.log('================')
  //   const [trans, err] = await getTranscripts(token, 'SESI013174')
  //   console.log({ trans })
  //   transcount++
  //   if (err?.status === '429') {
  //     console.log('Rate Limit Exceeded', { transcount })
  //     break
  //   }
  //   await sleep(0.5)
  // }
  // console.timeEnd('getTranscript')

  // return

  // Finding users by email
  const FIND_USERS_CODES_BY_EMAIL = async () => {
    const theList = [
      'roger.borges@se.com',
      'aurelie.debeer@se.com',
      'christian.delvallee@se.com',
      'guney.erkolukisa@se.com',
      'philippe.reveilhac@se.com',
      'jean-marc.albarede@se.com',
      'nikolay.kosachev@se.com',
    ]
    const wanks: UserDetails[] = []
    for (const val of theList) {
      console.info(color.bgBlue.yellow('\n\n-------------\n\n'))
      const mll = await getUsersByEmail(token, val)
      let details = mll[0]
      console.log({ tester: val, details })
      const ous = await getOUFromUser(token, details.user_id)
      console.log('OUs for', val, { ous: ous.value.length })
      for (const job of ous.value) {
        const jobcode = await getOUByID(token, job.ou_id)
        if (jobcode.value && jobcode.value[0] && jobcode.value[0].ref) {
          console.log({
            jobcode: jobcode.value[0].ref,
            title: jobcode.value[0].title,
            status_id: job.status_id,
          })
          details = {
            ...details,
            job_code: jobcode.value[0].ref,
            ou_title: jobcode.value[0].title,
            ou_id: jobcode.value[0].ou_id,
            updated_at: '2022-10-19T12:00:00Z',
          }
          break
        }
      }
      wanks.push(details)
    }
    console.log({
      wanks: JSON.stringify(
        wanks.map((w) => ({
          userId: w.user_id,
          org_group: w.job_code,
          org_title: w.ou_title,
          ou_id: w.ou_id,
        }))
      ),
    })
    console.log({ NEW_JOB_CODES: wanks.map((w) => w.job_code) })
  }

  // await FIND_USERS_CODES_BY_EMAIL()
  // await sleep(10)

  const FIND_USERS_CODES_BY_SESA = async () => {
    const theList = [
      ['Vinod P', 'SESA397528'],
      ['Denver Akshay L', 'SESA554750'],
      ['Dechamma MM', 'SESA458786'],
      ['Sathiya Shalini', 'SESA397524'],
      ['Sharon Eileen Bagde J', 'SESA434812'],
      ['Samiksha Puri Goswami', 'SESA583383'],
      ['Vaishnavi M A', 'SESA541883'],
      ['Domagoj', 'SESA561569', 1214032],
      ['Mike Hicks', 'SESA115093', 52120],
      ['Navin', 'SESA239974', 109478],
      ['Katri', 'SESA339377', 194939],
      ['Tim Johnson', 'SESA689845'],
      ['Brittany Fortese ', 'SESA689844'],
      ['Cloé Marion Marche', 'SESA611391'],
      ['Smith Benjamin', 'SESA252921', 'Ben.Smith@se.com', 'production pilot'],
      ['Newman Ian', 'SESA463165', 'Ian.Newman@se.com', 'production pilot'],
      ['Test user', 'SESA585579'],
    ]
    const wanks: UserDetails[] = []
    for (const val of theList.map((l) => l[1] as string)) {
      console.info(color.bgBlue.yellow('\n\n-------------\n\n'))
      const mll = await getUsersBySesa(token, val)
      let details = mll[0]
      console.log({ tester: val, details })
      const ous = await getOUFromUser(token, details.user_id)
      console.log('OUs for', val, { ous: ous.value.length })
      for (const job of ous.value) {
        const jobcode = await getOUByID(token, job.ou_id)
        if (jobcode.value && jobcode.value[0] && jobcode.value[0].ref) {
          console.log({
            jobcode: jobcode.value[0].ref,
            title: jobcode.value[0].title,
            status_id: job.status_id,
          })
          details = {
            ...details,
            job_code: jobcode.value[0].ref,
            ou_title: jobcode.value[0].title,
            ou_id: jobcode.value[0].ou_id,
            updated_at: '2022-10-19T12:00:00Z',
          }
          break
        }
      }
      wanks.push(details)
    }
    console.log({
      launchTeam: JSON.stringify(
        wanks.map((w) => ({
          userId: w.user_id,
          org_group: w.job_code,
          org_title: w.ou_title,
          ou_id: w.ou_id,
        }))
      ),
    })
    console.log({ NEW_JOB_CODES: wanks.map((w) => w.job_code) })
  }

  // await FIND_USERS_CODES_BY_SESA()
  // await sleep(10)
  // return

  const COUNT_ALL_JOBCODES = async () => {
    const codes = JOB_CODES?.split(',') ?? ['SFB6']
    const ous: OrgUnits[] = []
    for (const code of codes) {
      const ou = await getOUidByJobCode(token, code)
      ou && ous.push(ou)
    }
    console.log({ ous, count: ous.length })

    let allUsers: UserByOU[] = []
    let counts = {}
    for await (let [i, ou] of ous.entries()) {
      const userGroup = await getUsersByOUid(token, ou.ou_id)
      console.log({ ref: ou.ref, users: userGroup })
      console.log('______')
      let activeCount = 0
      let inactiveCount = 0
      // for await (let [idx, user] of userGroup.entries()) {
      //   const userDetails = await getUserInfoById(token, user.user_id)
      //   if (userDetails.user_status_id === 1) {
      //     LOGGABLES.activeUsers.push(userDetails)
      //     activeCount++
      //   } else {
      //     LOGGABLES.inactiveUsers.push(userDetails)
      //     inactiveCount++
      //   }
      //   console.log({
      //     progress: `OU #${i + 1} of ${ous.length}, User #${idx + 1} out of ${
      //       userGroup.length
      //     }`,
      //     active: LOGGABLES.activeUsers.length,
      //     inactive: LOGGABLES.inactiveUsers.length,
      //   })
      // }
      allUsers = [...allUsers, ...userGroup]
      counts = {
        ...counts,
        [`count:${ou.ref}`]: {
          total: userGroup.length,
          // active: activeCount,
          // inactive: inactiveCount,
        },
      }
    }
    console.log({
      count: allUsers.length,
      codes: ous.map(({ ref }) => ref).join(','),
      counts,
      inactiveCount: LOGGABLES.inactiveJobCodes.length,
      activeCount: LOGGABLES.activeUsers.length,
    })
  }

  // await COUNT_ALL_JOBCODES()
  // return

  const LATEST_TRANSCRIPT_CHANGES = async () => {
    const transsearched = await transcriptSearch(token, 200)
    console.log({ count: transsearched.length })
    for (const enrollment of transsearched) {
      const lo = await learningObjectSearch(token, enrollment.transc_object_id)
      enrollment.learning_object_data = lo[0]
    }
    transsearched.forEach((t) =>
      console.log({
        t,
        lo: t.learning_object_data,
      })
    )
  }

  // await LATEST_TRANSCRIPT_CHANGES()
  // return

  // const trans2 = await getTranscripts(token, 'SESA34400')
  // console.log({ trans2, size: trans2.length })

  const uat_sesa = [
    ['Vinod P', 'SESA397528'],
    ['Denver Akshay L', 'SESA554750'],
    ['Dechamma MM', 'SESA458786'],
    ['Sathiya Shalini', 'SESA397524'],
    ['Sharon Eileen Bagde J', 'SESA434812'],
    ['Samiksha Puri Goswami', 'SESA583383'],
    ['Vaishnavi M A', 'SESA541883'],
    ['Domagoj', 'SESA561569', 1214032],
    ['Mike Hicks', 'SESA115093', 52120],
    ['Navin', 'SESA239974', 109478],
    ['Katri', 'SESA339377', 194939],
    ['Tim Johnson', 'SESA689845'],
    ['Brittany Fortese ', 'SESA689844'],
    ['Cloé Marion Marche', 'SESA611391'],
    ['Smith Benjamin', 'SESA252921', 'Ben.Smith@se.com', 'production pilot'],
    ['Newman Ian', 'SESA463165', 'Ian.Newman@se.com', 'production pilot'],
    ['Test user', 'SESA585579'],
  ]

  const pilot_sesa = [
    ['SUKHU	Adrian', 'SESA34936'],
    ['PRIMMER	Chris', 'SESA9334'],
    ['NIVEN	David', 'SESA138133'],
    ['GARDNER	Michael', 'SESA256313'],
    ['JOSHI	Varad', 'SESA33965'],
    ['CHOPRA	BHISHAM', 'SESA74717'],
    ['Joshi	Yatin', 'SESA111485'],
    ['Deshpande	Manish', 'SESA138151'],
    ['Joshi	Ashish kumar', 'SESA140344'],
    ['S	Natarajan', 'SESA141167'],
    ['Shah	Jatin Manesh', 'SESA152630'],
    ['Bavishi	Hemal', 'SESA189484'],
    ['SEN	Amit', 'SESA184722'],
    ['IYER	Shyam', 'SESA184409'],
    ['Kumar	Vinay', 'SESA201842'],
    ['PATIL	Sachin Subhash', 'SESA285938'],
    ['Tiwari	Sudhir', 'SESA288382'],
    ['Masood	Faisal', 'SESA334386'],
    ['MURKEWAR	Asmita', 'SESA341083'],
    ['Singh	Siddhant', 'SESA344502'],
    ['SIVAGANGADHAR	Nandam', 'SESA345207'],
    ['DHANANJAYAN	S', 'SESA376893'],
    ['G	Karuna', 'SESA377967'],
    ['PK	SATHYA', 'SESA380718'],
    ['Kumar N	Santosh', 'SESA398950'],
    ['BHARDWAJ	Shashank', 'SESA407975'],
    ['Ashok	Vishnu', 'SESA429273'],
    ['RAINA	Umesh', 'SESA430105'],
    ['Vij	Naveen', 'SESA434712'],
    ['Joy V	Minu', 'SESA458081'],
    ['Pal	Ankita', 'SESA481261'],
    ['Dasgupta	Soumitra', 'SESA494402'],
    ['Raghav	Jayant', 'SESA498588'],
    ['Mistry	Tanvi', 'SESA505356'],
    ['Jain	Shruti', 'SESA514334'],
    ['Tripathi	Harsh Vardhan', 'SESA514744'],
    ['Ghosh	Sneha', 'SESA523159'],
    ['Mishra	Priyanka', 'SESA540236'],
    ['Biyani	Sumit Ashok', 'SESA586833'],
    ['Sydney	Nikita', 'SESA605323'],
    ['Khadake	Dhanashree', 'SESA618979'],
    ['V	Shanmuga Prabhu', 'SESA640210'],
    ['Sengar	Vishwajeet Singh', 'SESA644073'],
    ['Dey	Banani', 'SESA646809'],
    ['Khushboo	Anushree', 'SESA675642'],
    ['Thakur	Madhumita', 'SESA678668'],
    ['Datta	Baishakhi', 'SESA679825'],
    ['Palanethra	Pratheek', 'SESA690561'],
    ['Patil	Amar Keshav', 'SESA43441'],
    ['Joshi	Pratik', 'SESA64159'],
    ['Brown	Andrew', 'SESA3359'],
    ['Mannick	Anthony', 'SESA13628'],
    ['Kana	Pankaj', 'SESA38505'],
    ['Wood	Andrew', 'SESA14962'],
    ['Forfar	Garry', 'SESA92532'],
    ['Wassell	Lewis', 'SESA104474'],
    ['Smith	Benjamin', 'SESA252921'],
    ['Smith	Adrian', 'SESA344508'],
    ['Kirotar	Philip', 'SESA390696'],
    ['Wheeler	James', 'SESA433506'],
    ['Newman	Ian', 'SESA463165'],
    ['McKean	Matthew', 'SESA468869'],
    ['Mbayela	Takalani', 'SESA496469'],
    ['Waters	Andrew', 'SESA515807'],
    ['Woodward	Maximilian', 'SESA517152'],
    ['Hobbs	Maisie', 'SESA618738'],
    ['Makkieh	Ahmad', 'SESA650237'],
    ['Farrier	James', 'SESA668498'],
  ]

  const pilot_sesa_2 = [
    ['LEANDRO BERSAN VIGHI', 'SESA290405'],
    ['Chris Smith', 'SESA592343'],
    ['Jennifer Swem', 'SESA276888'],
    ['Jeri Radford', 'SESA580475'],
    ['Rocky', 'SESA234744'],
    ['Paula', 'SESA314483'],
    ['Patrick', 'SESA342620'],
    ['Renee', 'SESA50460'],
    ['John Bell', 'SESA684155'],
    ['Andrew Scragg', 'SESA34400'],
    [' SUKHU	Adrian', 'SESA34936	'],
    ['PRIMMER	Chris', 'SESA9334	 '],
    ['NIVEN	David', 'SESA138133'],
    ['GARDNER	Michael', 'SESA256313'],
    [' JOSHI	Varad', 'SESA33965	'],
    [' CHOPRA	BHISHAM', 'SESA74717	'],
    ['Joshi	Yatin', 'SESA111485'],
    ['Deshpande	Manish', 'SESA138151'],
    ['Joshi	Ashish kumar', 'SESA140344'],
    ['S	Natarajan', 'SESA141167'],
    ['Shah	Jatin Manesh', 'SESA152630'],
    ['Bavishi	Hemal', 'SESA189484'],
    ['SEN	Amit', 'SESA184722'],
    ['IYER	Shyam', 'SESA184409'],
    ['Kumar	Vinay', 'SESA201842'],
    ['PATIL	Sachin Subhash', 'SESA285938'],
    ['Tiwari	Sudhir', 'SESA288382'],
    ['Masood	Faisal', 'SESA334386'],
    ['MURKEWAR	Asmita', 'SESA341083'],
    ['Singh	Siddhant', 'SESA344502'],
    ['SIVAGANGADHAR	Nandam', 'SESA345207'],
    ['DHANANJAYAN	S', 'SESA376893'],
    ['G	Karuna', 'SESA377967'],
    ['PK	SATHYA', 'SESA380718'],
    ['Kumar N	Santosh', 'SESA398950'],
    ['BHARDWAJ	Shashank', 'SESA407975'],
    ['Ashok	Vishnu', 'SESA429273'],
    ['RAINA	Umesh', 'SESA430105'],
    ['Vij	Naveen', 'SESA434712'],
    ['Joy V	Minu', 'SESA458081'],
    ['Pal	Ankita', 'SESA481261'],
    ['Dasgupta	Soumitra', 'SESA494402'],
    ['Raghav	Jayant', 'SESA498588'],
    ['Mistry	Tanvi', 'SESA505356'],
    ['Jain	Shruti', 'SESA514334'],
    ['Tripathi	Harsh Vardhan', 'SESA514744'],
    ['Ghosh	Sneha', 'SESA523159'],
    ['Mishra	Priyanka', 'SESA540236'],
    ['Biyani	Sumit Ashok', 'SESA586833'],
    ['Sydney	Nikita', 'SESA605323'],
    ['Khadake	Dhanashree', 'SESA618979'],
    ['V	Shanmuga Prabhu', 'SESA640210'],
    ['Sengar	Vishwajeet Singh', 'SESA644073'],
    ['Dey	Banani', 'SESA646809'],
    ['Khushboo	Anushree', 'SESA675642'],
    ['Thakur	Madhumita', 'SESA678668'],
    ['Datta	Baishakhi', 'SESA679825'],
    ['Palanethra	Pratheek', 'SESA690561'],
    [' Patil	Amar Keshav', 'SESA43441'],
    [' Joshi	Pratik', 'SESA64159'],
    ['Brown	Andrew', 'SESA3359'],
    [' Mannick	Anthony', 'SESA13628'],
    [' Wood	Andrew', 'SESA14962'],
    [' Forfar	Garry', 'SESA92532'],
    ['Wassell	Lewis', 'SESA104474'],
    ['Smith	Benjamin', 'SESA252921'],
    ['Smith	Adrian', 'SESA344508'],
    ['Kirotar	Philip', 'SESA390696'],
    ['Wheeler	James', 'SESA433506'],
    ['Newman	Ian', 'SESA463165'],
    ['McKean	Matthew', 'SESA468869'],
    ['Mbayela	Takalani', 'SESA496469'],
    ['Waters	Andrew', 'SESA515807'],
    ['Woodward	Maximilian', 'SESA517152'],
    ['Hobbs	Maisie', 'SESA618738'],
    ['Makkieh	Ahmad', 'SESA650237'],
    ['Farrier	James', 'SESA668498'],
  ]

  const check_sesa = [
    ['a', 'SESA693843'],
    ['a', 'SESA585467'],
    ['a', 'SESA468869'],
    ['a', 'SESA587523'],
    ['a', 'SESA344508'],
  ]
  const GET_STATUSES_AND_TYPE = async () => {
    const status = await getOUStatus(token)
    console.log({ ou_statuses: status.value })

    const ouTypes = await getOUType(token)
    console.log({ ou_types: ouTypes.value })
  }
  // await GET_STATUSES_AND_TYPE()

  const GET_CODES_FOR_SHORTLIST = async () => {
    const bitches: UserDetails[] = []
    for (const sesa of uat_sesa) {
      const mll = await getUsersBySesa(token, `${sesa[1]}`)
      let dude = mll[0]
      console.log({ tester: sesa[0], dude })
      const ous = await getOUFromUser(token, dude.user_id)
      console.log('OUs for', sesa[0], { ous: ous.value.length })
      for (const job of ous.value) {
        const jobcode = await getOUByID(token, job.ou_id)
        if (jobcode.value && jobcode.value[0] && jobcode.value[0].ref) {
          console.log({
            jobcode: jobcode.value[0].ref,
            title: jobcode.value[0].title,
            status_id: job.status_id,
          })
          dude = {
            ...dude,
            job_code: jobcode.value[0].ref,
            ou_title: jobcode.value[0].title,
            ou_id: jobcode.value[0].ou_id,
            updated_at: '2022-10-19T12:00:00Z',
          }
          break
        }
      }
      bitches.push(dude)
    }

    const emails = bitches.map((m) => m.user_email)
    const ids = bitches.map((m) => m.user_id)
    const manager_emails = bitches.map((m) => m.user_mgr_email)
    const manager_sesa = bitches.map((m) => m.user_mgr_ref)
    const manager_id = bitches.map((m) => m.user_mgr_id)
    const manager_array = bitches.map((m) => [
      `${m.user_mgr_name_first} ${m.user_mgr_name_last}`,
      m.user_mgr_ref,
      m.user_mgr_id,
    ])
    const manager_by_job_code = bitches.map((m) => ({
      userId: m.user_mgr_id,
      job_code: m.job_code,
      ou_id: m.ou_id,
      ou_title: m.ou_title,
      updated_at: m.updated_at,
    }))
    const user_by_job_code = bitches.map((m) => ({
      email: m.user_email,
      userId: m.user_id,
      job_code: m.job_code,
      ou_id: m.ou_id,
      ou_title: m.ou_title,
      updated_at: m.updated_at,
    }))
    console.log({ user_by_job_code })
    console.log({ manager_sesa, manager_id })
    console.log({ ids })
  }
  // await GET_CODES_FOR_SHORTLIST()
  // return
  // const uat_users = await getUsersBySesa(token, 'SESA239974')
  // console.log({ uat_users })

  // const uatFilter = `$filter=user_ref eq 'SESA339377'`
  // const peeps = await filterUsers(token, uatFilter)

  // console.log({ peeps })

  // console.log({ ouResp, map: ouResp.value.map((ou) => ou) })
  const GET_TRANSCRIPT_LO_DEETS = async () => {
    const [trans] = await getTranscripts(token, 'SESA115093')

    const results = await Promise.all(
      trans.map(async (enr): Promise<{ enr: TranscriptItem }> => {
        return { enr }
      })
    )
    // console.log('______')
    // console.log('______')
    // console.log('______')
    // console.log('______')
    // console.log('______')
    // console.log('[')
    // for (const enrollment of results) {
    //   console.log({ enrollment })
    //   console.log(',')
    // }
    return Object.fromEntries(
      results.map((e) => [
        e.enr.LoId,
        { title: e.enr.Title, reg_dt: e.enr.RegistrationDate },
      ])
    )
  }

  const mike_lo = await GET_TRANSCRIPT_LO_DEETS()
  const mikehicks = await fetchUserTranscript(52120, '2022-12-15')
  console.log({ mikehicks: mikehicks.map((e) => e.transc_object_id) })

  mikehicks.forEach((enr) => {
    console.log({ Course: mike_lo[enr.transc_object_id], enr })
  })
  const found: string[] = []
  const notFound: string[] = []
  console.info(color.bgRed('===================\n\n'))
  // await sleep(20)

  Object.keys(mike_lo).forEach((lo) => {
    const enr = mikehicks.find((r) => r.transc_object_id === lo)
    const record = mike_lo[lo]
    const listItem = `${lo} - ${displayDate(record.reg_dt)} -- ${record.title}`
    if (enr) {
      found.push(listItem)
      console.log({ title: record.title, enr })
    } else {
      notFound.push(listItem)
    }
  })
  console.log({ found, notFound })
  // return

  // const LO = await getLODetails(token)
  // console.log({ LO })
  // const LO = await getLODetails(token, '3f6f98a2-cbb0-4e6f-a9ef-bc52b9fba8a0')
  // console.warn({ LO })
  // console.log(trans7.map(formatEnrollmentImport))
}

run()
