import { paginatedFetchFromCSOD } from './utils/apiFetch'

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
  userId: number
): Promise<CSODTranscript[]> => {
  const filters = [
    'is_assigned eq true',
    'is_archive eq 0',
    'user_lo_min_due_date ne null',
    `transc_user_id eq ${userId}`,
  ]

  const queryVars = ['$count=true', `$filter=${filters.join(' and ')}`]
  const query = encodeURI(queryVars.join('&'))
  const apiUrl = `/x/odata/api/views/vw_rpt_transcript?${query}`

  return await paginatedFetchFromCSOD<CSODTranscript>(apiUrl)
}
