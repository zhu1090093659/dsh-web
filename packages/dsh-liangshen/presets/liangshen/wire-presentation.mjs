/**
 * Per-session wire presentation shared by the sibling tool-catalog and
 * minimal-prompt rows. The Host's assembly waterfall carries sections only;
 * tool-catalog owns the configured mode plus runtime probe and publishes it
 * before calling the next assembly listener.
 */

const presentationByAgent = new WeakMap()
const presentationBySession = new WeakMap()

/** Publish or retract the effective native/ptc transport for one agent scope. */
export function publishWirePresentation(agent, presentation) {
  if (agent === undefined || agent === null || (typeof agent !== 'object' && typeof agent !== 'function')) return
  const session = agent.session
  const sessionKey = session !== null && (typeof session === 'object' || typeof session === 'function') ? session : undefined
  if (presentation === undefined) {
    presentationByAgent.delete(agent)
    if (sessionKey !== undefined) presentationBySession.delete(sessionKey)
    return
  }
  presentationByAgent.set(agent, presentation)
  if (sessionKey !== undefined) presentationBySession.set(sessionKey, presentation)
}

/** Read the transport published for this scope, or undefined when unavailable. */
export function wirePresentationFor(agent) {
  if (agent === undefined || agent === null || (typeof agent !== 'object' && typeof agent !== 'function')) return undefined
  const direct = presentationByAgent.get(agent)
  if (direct !== undefined) return direct
  const session = agent.session
  if (session === null || (typeof session !== 'object' && typeof session !== 'function')) return undefined
  return presentationBySession.get(session)
}
