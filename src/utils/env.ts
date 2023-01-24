import 'dotenv/config'

// Manually configured ENVs
export const CSOD_API_CLIENT_ID: string = process.env.CSOD_API_CLIENT_ID || ''
export const CSOD_API_HOST: string = process.env.CSOD_API_HOST || ''
export const CSOD_API_CLIENT_SECRET: string =
  process.env.CSOD_API_CLIENT_SECRET || ''
export const CSOD_FACILITATOR_USER_ID: string =
  process.env.CSOD_FACILITATOR_USER_ID || ''
export const USER_SYNC_ENDPOINT = process.env.USER_SYNC_ENDPOINT || ''
export const COURSE_SYNC_ENDPOINT = process.env.COURSE_SYNC_ENDPOINT || ''
export const COMPLETED_ENROLLMENTS_ENDPOINT =
  process.env.COMPLETED_ENROLLMENTS_ENDPOINT || ''
export const SYNC_API_TOKEN = process.env.SYNC_API_TOKEN || ''
export const JOB_CODES = process.env.JOB_CODES || ''
export const USER_EMAILS = process.env.USER_EMAILS || ''
export const USER_SESA_IDS = process.env.USER_SESA_IDS || ''
export const CDK_DEFAULT_REGION =
  process.env.CDK_DEFAULT_REGION || 'eu-central-1'
export const TRANSCRIPT_FETCH_HORIZON_DAYS =
  process.env.TRANSCRIPT_FETCH_HORIZON_DAYS || ''
export const CONCURRENCY_DEFAULT = process.env.CONCURRENCY_DEFAULT || '5'
export const CONCURRENCY_HIGH = process.env.CONCURRENCY_DEFAULT || '10'

export const ENV_VARS = {
  CSOD_API_CLIENT_ID,
  CSOD_API_CLIENT_SECRET,
  CSOD_API_HOST,
  CSOD_FACILITATOR_USER_ID,
  USER_SYNC_ENDPOINT,
  COURSE_SYNC_ENDPOINT,
  COMPLETED_ENROLLMENTS_ENDPOINT,
  SYNC_API_TOKEN,
  JOB_CODES,
  USER_EMAILS,
  USER_SESA_IDS,
  CDK_DEFAULT_REGION,
  TRANSCRIPT_FETCH_HORIZON_DAYS,
  CONCURRENCY_DEFAULT,
  CONCURRENCY_HIGH,
}
export type IEnvironmentConfig = Readonly<typeof ENV_VARS>
