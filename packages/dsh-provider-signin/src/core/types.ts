/**
 * Wire-safe types shared by the host relay routes and the browser card. Free
 * of node and cordis imports so the client bundle can consume them.
 * @module @linxin666/dsh-provider-signin/core/types
 */

/** One registered authorization flow as the card renders it. */
export interface FlowView {
  /** The credential record this flow writes, e.g. `llm-pi-ai/xai`. */
  key: string
  /** User-facing name of what is being authorized. */
  label: string
  /** The methods this flow offers, most preferred first. */
  methods: Array<{ id: string, label: string }>
  /** Whether an attempt for this key is running right now. */
  inFlight: boolean
}

/** The stored credential state for one flow key, secrets excluded. */
export interface RecordView {
  /** Whether a credential record exists at all. */
  configured: boolean
  /** `oauth` for a sign-in grant, `api-key` for a stored key. */
  kind?: 'api-key' | 'grant'
}

/** One relayed progress report. */
export interface AttemptNotice {
  /** Monotonic within the attempt; clients resume with `?since=<seq>`. */
  seq: number
  message: string
  url?: string
  code?: string
}

/** A question the flow is waiting on. */
export interface AttemptPending {
  id: string
  kind: 'text' | 'secret' | 'select'
  message: string
  placeholder?: string
  options?: Array<{ id: string, label: string, description?: string }>
}

/** Terminal state of one attempt. */
export type AttemptStatus = 'running' | 'authorized' | 'cancelled' | 'failed'

/** The client-visible snapshot of one attempt. */
export interface AttemptView {
  id: string
  key: string
  status: AttemptStatus
  /** Notices with `seq > since` (or all of them). */
  notices: AttemptNotice[]
  /** The question currently waiting for the human, if any. */
  pending?: AttemptPending
  /** The failure message when `status` is `failed`. */
  error?: string
}

/** Body of `POST /begin`. */
export interface BeginBody {
  key?: unknown
  method?: unknown
}

/** Body of `POST .../answer`. */
export interface AnswerBody {
  value?: unknown
}
