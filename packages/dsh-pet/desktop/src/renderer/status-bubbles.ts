import type { PetInteraction, PetSnapshot } from '../shared/desktop-api.ts'

export const MAX_DESKTOP_STATUS_BUBBLES = 3

export interface DesktopStatusBubble {
  id: string
  text: string
  kind: 'status' | 'whisper' | PetInteraction | 'error'
}

/** Keep active task copy visible without expanding the draggable pet window. */
export function desktopStatusBubbles(
  snapshot: PetSnapshot | null | undefined,
  feedback?: { text: string; kind: PetInteraction | 'error' },
): DesktopStatusBubble[] {
  if (feedback !== undefined) {
    return [{ id: 'feedback', text: feedback.text, kind: feedback.kind }]
  }
  const whisper = snapshot?.whisper
  const sessions = snapshot?.sessions ?? []
  if (sessions.length > 0) {
    const visible = sessions.slice(0, MAX_DESKTOP_STATUS_BUBBLES).map((session, index) => ({
      id: session.sessionId,
      text: index === 0 && whisper !== undefined ? whisper : session.bubble,
      kind: index === 0 && whisper !== undefined ? 'whisper' as const : 'status' as const,
    }))
    if (sessions.length > MAX_DESKTOP_STATUS_BUBBLES) {
      visible.push({
        id: 'more',
        text: `另有 ${String(sessions.length - MAX_DESKTOP_STATUS_BUBBLES)} 个会话进行中`,
        kind: 'status',
      })
    }
    return visible
  }
  if (whisper !== undefined) return [{ id: 'whisper', text: whisper, kind: 'whisper' }]
  return snapshot?.bubble === undefined
    ? []
    : [{ id: 'status', text: snapshot.bubble, kind: 'status' }]
}
