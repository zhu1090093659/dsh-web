/**
 * The exact `args` layout of every DSH Remote endpoint this package may call.
 *
 * A descriptor declares one parameter name per wire key, and the gateway
 * asserts the argument object is EXACTLY that set — one extra or one missing
 * key throws `gateway/arguments-invalid`. The asymmetry is real and belongs to
 * the endpoint owners, so it is tabulated here instead of guessed at the call
 * site:
 *
 *   - `session/list` is the only endpoint whose single parameter is named
 *     `_request` (the underscore is part of the wire name);
 *   - four endpoints take NO parameters at all and must be called with `{}`;
 *   - every other endpoint names its single parameter `request`.
 * @module dsh-remote-bridge/core/wire
 */

import type { InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway'

/**
 * The peer every gateway request names: derived from the public
 * `InvokeRemoteRequest` type so this package needs no direct dependency on
 * `@deepseek-ai/dsh-typert-protocol` for the shape.
 */
export type GatewayPeer = InvokeRemoteRequest['peer']

/** One Remote call after the carrier has decoded its envelope. */
export interface GatewayInvokeRequest {
  readonly namespace: string
  readonly method: string
  readonly args: Readonly<Record<string, unknown>>
  /**
   * The caller this call speaks for. The bridge mints this peer in-process
   * (`core/owner-peer.ts`) and attaches it to every gateway call itself; no
   * field of a client frame is ever read into it.
   */
  readonly peer: GatewayPeer
  readonly signal?: AbortSignal
}

/**
 * The subset of `ctx.typertGateway` this package consumes. Structural on
 * purpose: the live service also carries the wire-stream adapter and the
 * forwarded-event registry, none of which the bridge uses, so a test fake only
 * has to implement what is called.
 */
export interface BridgeGateway {
  invoke(request: GatewayInvokeRequest): Promise<unknown>
  stream(request: GatewayInvokeRequest): Promise<AsyncIterable<unknown>>
}

/**
 * Durable identity of one ordinary Session or one direct subagent child.
 *
 * `session/follow` and `session/page` take this instead of a bare id, and the
 * harness refuses a delegated child addressed as an ordinary session with
 * `session/agent-busy` — "subagent Sessions require their durable parent
 * address" — so the bridge must send the child's own kind for those sessions.
 */
export type SessionAddress = {
  readonly kind: 'session'
  readonly sessionId: string
} | {
  readonly kind: 'subagent'
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly mode: SubagentMode
}

/** How long a delegated child may be continued; `unknown` is checked against nothing. */
export type SubagentMode = 'one-shot' | 'continuable' | 'unknown'

/** The durable address of one ordinary session. */
export function sessionAddress(sessionId: string): SessionAddress {
  return { kind: 'session', sessionId }
}

/**
 * The durable address of one delegated child.
 *
 * The mode is always `unknown`: the bridge has no reliable way to read a
 * child's mode before the call, and the harness accepts `unknown` for every
 * child while checking a claimed mode against the descriptor.
 */
export function subagentAddress(parentSessionId: string, childSessionId: string): SessionAddress {
  return { kind: 'subagent', parentSessionId, childSessionId, mode: 'unknown' }
}

/** The failure code the harness raises for a child addressed as an ordinary session. */
export const CODE_SUBAGENT_ADDRESS_REQUIRED = 'session/agent-busy'

/**
 * The failure the harness raises when a session address names a session this host
 * does not have. `session/page` answers it, `session/projections` answers
 * `null` for the same fact, and a caller that needs one name for "no such
 * session" folds both into its own code rather than letting one fact cross as two
 * different failures.
 */
export const CODE_HOST_SESSION_NOT_FOUND = 'session/not-found'

/**
 * One endpoint's declared argument names: the name of its single parameter, the
 * empty declaration of a parameterless endpoint, or the exact names of an
 * endpoint that takes several.
 */
export type WireName = 'request' | '_request' | 'none' | { readonly names: readonly string[] }

/** One endpoint's declared wire layout. */
export interface WireRow {
  readonly namespace: string
  readonly method: string
  readonly wire: WireName
}

/**
 * Every endpoint of the frozen mapping table, in the order the parent card
 * lists them. Rows whose endpoint no method of protocol v1 exposes yet
 * (`pluginInventory/list`, `pluginManager/listPlugins`) stay in the table: they
 * are the layout a future method must not get wrong, and the table is the
 * single place it is written.
 */
export const WIRE_TABLE: readonly WireRow[] = [
  { namespace: 'session', method: 'list', wire: '_request' },
  { namespace: 'session', method: 'create', wire: 'request' },
  { namespace: 'session', method: 'fork', wire: 'request' },
  { namespace: 'session', method: 'page', wire: 'request' },
  { namespace: 'session', method: 'follow', wire: 'request' },
  { namespace: 'session', method: 'prompt', wire: 'request' },
  { namespace: 'session', method: 'cancel', wire: 'request' },
  { namespace: 'session', method: 'attachment', wire: 'request' },
  { namespace: 'session', method: 'projections', wire: 'request' },
  { namespace: 'session', method: 'modelCatalog', wire: 'none' },
  { namespace: 'session', method: 'selectModel', wire: 'request' },
  { namespace: 'session', method: 'rename', wire: 'request' },
  { namespace: 'workspace', method: 'pinSession', wire: 'request' },
  { namespace: 'workspace', method: 'unpinSession', wire: 'request' },
  { namespace: 'workspace', method: 'archiveSession', wire: 'request' },
  { namespace: 'workspace', method: 'unarchiveSession', wire: 'request' },
  { namespace: 'agentPresets', method: 'list', wire: 'none' },
  { namespace: 'commands', method: 'list', wire: { names: ['agentId'] } },
  { namespace: 'commands', method: 'execute', wire: { names: ['agentId', 'line', 'submittedAttachments'] } },
  { namespace: 'skills', method: 'list', wire: 'request' },
  { namespace: 'userQuestions', method: 'answer', wire: { names: ['agentId', 'callId', 'answer'] } },
  { namespace: 'userQuestions', method: 'attachWait', wire: { names: ['agentId', 'callId'] } },
  { namespace: 'pluginInventory', method: 'list', wire: 'none' },
  { namespace: 'pluginManager', method: 'listPlugins', wire: 'none' },
]

/** @returns the declared row for an endpoint, or undefined when it is not tabulated. */
export function wireRowFor(namespace: string, method: string): WireRow | undefined {
  return WIRE_TABLE.find(row => row.namespace === namespace && row.method === method)
}

/**
 * Build the `args` object for one endpoint.
 *
 * An untabulated endpoint falls back to `{ request }`: that is the layout of
 * every tabulated endpoint but a few, and a wrong guess fails loudly at the
 * gateway with `arguments-invalid` rather than silently invoking the wrong
 * shape. A multi-parameter endpoint carries one key per declared name, and a
 * name the caller left out stays out — the gateway refuses it by name, which is
 * the failure a caller should see.
 * @param namespace - Remote namespace.
 * @param method - Service method name.
 * @param request - the endpoint's request payload.
 * @returns the exact named-argument object.
 */
export function wireArgs(namespace: string, method: string, request: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const wire = wireRowFor(namespace, method)?.wire ?? 'request'
  if (wire === 'none') return {}
  if (typeof wire === 'object') {
    const named: Record<string, unknown> = {}
    for (const name of wire.names) if (Object.hasOwn(request, name)) named[name] = request[name]
    return named
  }
  return { [wire]: request }
}
