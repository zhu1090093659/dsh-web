import { memo } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.composer.dock).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Props supplied by the session-scoped composer dock. */
export interface TpsLineProps {
  useProjection: UseProjection
}

/** Format throughput with one decimal below 100 tok/s. */
export function formatTokensPerSecond(value: number): string {
  return String(value < 100 ? Math.round(value * 10) / 10 : Math.round(value))
}

const STYLE = {
  boxSizing: 'border-box',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: '12px',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: '20px',
  margin: '0 auto',
  maxWidth: 'var(--dsh-chat-content-width)',
  overflow: 'hidden',
  padding: '0 var(--dsh-composer-side-clearance)',
  textAlign: 'center',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%',
} as const

/** Second composer-status line for active or latest response throughput. */
export const TpsLine = memo(function TpsLine({ useProjection }: TpsLineProps) {
  const rate = useProjection('liveTokenUsage')?.tokensPerSecond
  if (rate === undefined) return null
  return <div style={STYLE}>TPS {formatTokensPerSecond(rate)} tok/s</div>
})

/**
 * Composer-dock entry: adapts the session-scoped `conversation.composer.dock`
 * runtime share to the TPS line. The dock is the shipped stats-line seat, and
 * its standard kit supplies `useProjection` (the fifth framework hook seat),
 * which reads the host's `liveTokenUsage` projection. Registering here makes
 * the live TPS row actually mount — previously the TpsLine was only exported
 * and never mounted on rc.6 (issue #56).
 */
export const TpsLineDockEntry = memo(function TpsLineDockEntry(props: PropsRuntime<'conversation.composer.dock'>) {
  return <TpsLine useProjection={props.useProjection} />
})
