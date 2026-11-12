/**
 * The `ui_present` model tool: the agent hands one self-contained page to the
 * clients paired with this host, and the user's first action comes back as that
 * same tool call's result (protocol §35).
 *
 * The tool owns its own vocabulary and nothing else. The page is the argument,
 * the cards are the hub's claims, and the result is one sentence plus the
 * presentation payload the desktop renders from (`meta.ui`, §35.10) — the phone
 * still reads `ui.request` and `ui.list`, so this payload is never its second
 * source of truth.
 *
 * Both caps are enforced here, on the originating side (§35.2): an oversized page
 * is refused `invalid-args` before a frame is written and without a
 * presentation payload, because a refusal on the client would leave the agent
 * waiting for a card that never comes.
 * @module dsh-remote-bridge/host/ui-tools
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { UiPresentReply } from '../core/hub.ts'
import { UI_HTML_MAX_BYTES, uiHtmlFits, uiKey } from '../core/ui.ts'
import type { JsonValue, UiCardView, UiState } from '../core/ui.ts'

/**
 * The one thing this tool needs from the hub.
 *
 * Structural on purpose, and the seam a suite drives: the tool decides nothing
 * about delivery, deadlines or the grace window, so a test can hand it any host
 * that presents a page.
 */
export interface UiToolHost {
  /** Present one page and wait for the user's first action (§35.2). */
  present(card: UiCardView, signal?: AbortSignal): Promise<UiPresentReply>
}

/** The card as the desktop renders it from a tool result (§35.10). */
export interface UiPresentationMeta {
  /** {@link uiKey}: the same `"<sessionId>/<callId>"` a `ui.list` row carries. */
  readonly key: string
  readonly title?: string
  /** The whole page, byte for byte the document that crossed as `html`. */
  readonly html: string
  readonly height?: number
  readonly state: UiState
}

/**
 * What the model is told before it writes a single page.
 *
 * Every clause here is one of §35.2's or §35.7's rules restated where the model
 * can act on it: the page is a whole document, it cannot navigate, its external
 * subresources are `https:`, its only way back is the named message channel, and
 * the two caps are the host's. The blocking lifetime is stated last, because it is
 * what a model most often assumes wrong: one action ends this call.
 */
export const UI_PRESENT_DESCRIPTION = [
  'Present one whole self-contained HTML page to the clients paired with this host, and wait for the user to act inside it.',
  "The call blocks until the user's FIRST action arrives; that action ({type, payload?}) is this call's result, and the card then stops accepting actions — present again if the page should keep taking them.",
  'Write a complete document starting with <!doctype html> and keep it within 256 KiB of UTF-8. Inline the CSS, the scripts and every image you can (data:), because external subresources must be https:; http:, ws: and file: are refused.',
  'The page cannot navigate: no top-level navigation, no window.open, no target=_blank, no cross-document jump. A link that leaves the card is dead by construction.',
  'Report an action with webkit.messageHandlers.dshui.postMessage({type, payload}) on iOS and postMessage({type, payload}) on desktop. type is your own name for the action (for example "submit", "choose" or "run"); payload is optional JSON within 8 KiB.',
  'Answers "unavailable" when no paired client announced the capability, and "invalid-args" when the page is over the cap — in both cases no frame is sent and nothing is shown.',
].join(' ')

/**
 * The canonical result body, as the output schema declares it.
 *
 * Three shapes and no more: the action that settled the card, the release of a
 * card that did reach a screen, and a refusal that never got that far. Only the
 * first two carry the card identity, which is what decides whether a presentation
 * payload rides the result (§35.10).
 */
export type UiPresentValue =
  | {
      readonly ok: true
      readonly key: string
      readonly delivered: number
      readonly type: string
      readonly payload?: JsonValue
    }
  | {
      readonly ok: false
      readonly reason: 'timeout' | 'cancelled'
      readonly key: string
      readonly delivered: number
    }
  | { readonly ok: false; readonly reason: 'unavailable' | 'invalid-args' }

/** The canonical result body: one sentence, never the page itself. */
function describe(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'ui_present finished'
  const record = value as { ok?: unknown; reason?: unknown; type?: unknown; delivered?: unknown }
  if (record.ok === true) {
    const delivered = typeof record.delivered === 'number' ? record.delivered : 0
    const type = typeof record.type === 'string' ? record.type : 'an action'
    return `presented to ${delivered} paired client(s); settled by the operator with "${type}"`
  }
  const reason = typeof record.reason === 'string' ? record.reason : 'unknown'
  if (reason === 'timeout' || reason === 'cancelled') {
    const delivered = typeof record.delivered === 'number' ? record.delivered : 0
    return `presented to ${delivered} paired client(s); the card was released without an action (${reason})`
  }
  return `ui_present was refused: ${reason}`
}

/**
 * The presentation payload a transcript-rendering client reads (§35.10).
 *
 * Present exactly when the page really reached the wire — which is the same fact
 * as the result carrying a `key` — so a refused or oversized call leaves no card
 * for the desktop to draw. `state` is the card's ending, and a blocking
 * presentation only ever ends one way: it is settled by the time this call
 * returns, so the shape's `open` is what a host that answers before its first
 * event would publish, which §35.3 rules out here.
 * @param args - the arguments the model sent.
 * @param value - the canonical result body.
 * @returns the `meta` object, or `{}` when no card crossed.
 */
function presentationOf(args: { html: string; title?: string; height?: number }, value: unknown): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null) return {}
  const key = (value as { key?: unknown }).key
  if (typeof key !== 'string') return {}
  const ui: UiPresentationMeta = {
    key,
    ...(args.title === undefined ? {} : { title: args.title }),
    html: args.html,
    ...(args.height === undefined ? {} : { height: args.height }),
    state: 'settled',
  }
  return { ui: { ...ui } }
}

/**
 * Build the one card tool.
 * @param host - the hub, as this tool needs it.
 * @returns a registry-ready definition for `ctx.tools.register`.
 */
export function createUiPresentTool(host: UiToolHost): ToolDefinition {
  return defineTool({
    name: 'ui_present',
    description: UI_PRESENT_DESCRIPTION,
    parameters: {
      html: {
        type: 'string',
        required: true,
        description: `The whole page as one document, starting with <!doctype html>. At most ${UI_HTML_MAX_BYTES} bytes of UTF-8; inline what you can, external subresources are https: only.`,
      },
      title: {
        type: 'string',
        description: 'One header line for the card. Omit it and the header shows the state alone.',
      },
      height: {
        type: 'integer',
        description: 'Your suggested initial height in points. The client still measures the page and its own measurement wins.',
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: true },
              key: { type: 'string', required: true, description: 'The card identity: "<sessionId>/<callId>".' },
              delivered: { type: 'integer', required: true, description: 'How many paired connections took the page.' },
              type: { type: 'string', required: true, description: 'The action name the page reported.' },
              payload: { type: 'json', description: 'The action payload, carried verbatim, within 8 KiB.' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: false },
              reason: { type: 'string', required: true, enum: ['timeout', 'cancelled'] },
              key: { type: 'string', required: true, description: 'The card that was presented and then released.' },
              delivered: { type: 'integer', required: true, description: 'How many paired connections took the page.' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', const: false },
              reason: { type: 'string', required: true, enum: ['unavailable', 'invalid-args'] },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: describe(value) }],
      presentationMeta: (args, value) => presentationOf(args, value),
    },
    async execute(args, exec): Promise<UiPresentValue> {
      // The cap is checked before anything is announced: a page over it is refused
      // as invalid-args with no frame, no card and no presentation payload.
      if (!uiHtmlFits(args.html)) return { ok: false, reason: 'invalid-args' }
      const sessionId = exec.agent?.id
      // A presentation needs a session to hang the card on, and the caller supplies
      // it: without one this bridge cannot name the card, so nothing is presented.
      if (sessionId === undefined) return { ok: false, reason: 'unavailable' }
      const key = uiKey(String(sessionId), String(exec.callId))
      const reply: UiPresentReply = await host.present({
        sessionId: String(sessionId),
        callId: String(exec.callId),
        html: args.html,
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.height === undefined ? {} : { height: args.height }),
      }, exec.signal)
      if (reply.ok) {
        return {
          ok: true,
          key,
          delivered: reply.delivered,
          type: reply.type,
          ...(reply.payload === undefined ? {} : { payload: reply.payload }),
        }
      }
      // A card that reached a screen carries its identity into the result even when
      // the wait ended in a refusal: the desktop's row must be able to say the page
      // is over (§35.10). A call that never got that far carries no key at all.
      switch (reply.reason) {
        case 'timeout':
        case 'cancelled':
          return { ok: false, reason: reply.reason, key, delivered: reply.delivered }
        case 'invalid-args':
          return { ok: false, reason: 'invalid-args' }
        default:
          return { ok: false, reason: 'unavailable' }
      }
    },
  })
}
