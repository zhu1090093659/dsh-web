/**
 * Semantic adapter (issue #506, contract section 6, L2 compat adapter).
 *
 * One merged MutationObserver that stamps the semantic-attribute enumeration
 * (contracts/semantic-attrs-v1.md) onto the official shell DOM and onto
 * plugin roots that already expose stable anchors. This is explicitly a
 * COMPAT adapter — not a permanent public contract:
 *  - official areas migrate to first-party attributes when the upstream
 *    theme seam lands (then these rules are re-evaluated for deletion);
 *  - third-party plugin areas stay here long-term (plugins that opt in
 *    output the attributes themselves and the adapter becomes a no-op).
 *
 * Properties:
 *  - merged: a single observer handles every rule;
 *  - idempotent: re-tagging an already-correct element is a no-op, so React
 *    re-renders simply get re-stamped when their nodes are re-added;
 *  - fail-closed diagnostics: rules that match nothing and selectors the
 *    engine rejects are reported, never thrown into the page;
 *  - the adapter never REMOVES attributes it did not set; disposal only
 *    disconnects the observer (stamping is cosmetic and scopes itself under
 *    html[data-dsh-skin] consumers).
 * @module @linxin666/dsh-client-ui-skin-center/runtime/semantic-adapter
 */

export type SemanticAttr = 'data-dsh-surface' | 'data-dsh-part' | 'data-dsh-plugin'

export interface SemanticRule {
  /** CSS selector matched against added/existing elements. */
  selector: string
  /** Attribute(s) applied on match. */
  attrs: readonly (readonly [SemanticAttr, string])[]
  /** Why this rule exists / what it anchors (audit trail). */
  note: string
}

/**
 * The v1 rule table. Single ownership: only the skin-center edits this.
 * Anchors verified against @deepseek-ai rc.7 (see docs/archive survey).
 */
export const SEMANTIC_RULES_V1: readonly SemanticRule[] = [
  // ---- surfaces (official shell) ----
  { selector: '[data-slot="root"]', attrs: [['data-dsh-surface', 'root']], note: 'ui-renderer root outlet' },
  { selector: '[data-slot="sidebar"]', attrs: [['data-dsh-surface', 'sidebar']], note: 'layout sidebar outlet' },
  { selector: '[data-slot="conversation"]', attrs: [['data-dsh-surface', 'conversation']], note: 'layout conversation outlet' },
  { selector: '[data-slot="conversation.session.header"]', attrs: [['data-dsh-surface', 'session-header']], note: 'conversation header outlet' },
  { selector: '[data-slot="conversation.composer"]', attrs: [['data-dsh-surface', 'composer']], note: 'composer chain outlet' },
  { selector: '[data-slot="details"]', attrs: [['data-dsh-surface', 'details']], note: 'layout details outlet' },
  { selector: '[data-shell-overlay]', attrs: [['data-dsh-surface', 'overlay']], note: 'frame overlay attribute' },
  { selector: '[data-slot="shell.overlay"]', attrs: [['data-dsh-surface', 'overlay']], note: 'shell overlay outlet' },
  {
    selector: '[role="dialog"]:has([data-slot="settings.section"])',
    attrs: [['data-dsh-surface', 'settings']],
    note: 'settings dialog (composite: dialog containing the section outlet)',
  },
  // ---- shell parts ----
  { selector: '[data-chat-flow-kind]', attrs: [['data-dsh-part', 'message-row']], note: 'chat flow item' },
  { selector: '[data-streaming]', attrs: [['data-dsh-part', 'message-body']], note: 'assistant markdown root' },
  { selector: '[data-conversation-scroll]', attrs: [['data-dsh-part', 'scrollport']], note: 'conversation scrollport' },
  { selector: 'textarea[data-phase]', attrs: [['data-dsh-part', 'composer-input']], note: 'composer textarea' },
  { selector: '[data-decoration="chip"]', attrs: [['data-dsh-part', 'composer-chip']], note: 'composer reference chip' },
  { selector: '[data-queue-dock]', attrs: [['data-dsh-part', 'queue-dock']], note: 'queued turns dock' },
  { selector: '[data-turn-tail]', attrs: [['data-dsh-part', 'turn-tail']], note: 'turn tail row' },
  { selector: '[data-side]', attrs: [['data-dsh-part', 'resize-handle']], note: 'column resize handle' },
  {
    selector: 'button[class*="newSession"]',
    attrs: [['data-dsh-part', 'new-session']],
    note: 'sidebar new-session action (compat seam shields skins from localized labels)',
  },
  // ---- plugin roots (plugins without stable anchors opt in via AGENTS.md) ----
  {
    selector: '[data-dsh-taskboard-view], [data-dsh-taskboard-board], [data-dsh-taskboard-entry]',
    attrs: [['data-dsh-plugin', 'task-board']],
    note: 'task-board panel/board/sidebar entry',
  },
  {
    selector: '[data-dsh-ssh-view], [data-dsh-ssh-entry]',
    attrs: [['data-dsh-plugin', 'ssh']],
    note: 'ssh panel/sidebar entry',
  },
  {
    selector: '[data-gitgraph-chip-anchor], [data-gitgraph-dialog]',
    attrs: [['data-dsh-plugin', 'git-graph']],
    note: 'git-graph chip/dialog',
  },
  {
    selector: '[data-dsh-pet-root]',
    attrs: [['data-dsh-plugin', 'pet']],
    note: 'pet global root',
  },
  // ---- family parts ----
  {
    selector: '[data-dsh-taskboard-entry], [data-dsh-ssh-entry]',
    attrs: [['data-dsh-part', 'sidebar-entry']],
    note: 'shared injected sidebar entry rows',
  },
]

export interface SemanticAdapterDiagnostics {
  /** Rules whose selector the engine rejects (dropped, never retried). */
  invalidRules: string[]
  /** Rules that matched zero elements in the latest full pass. */
  unmatchedRules: string[]
  /** Total attributes stamped since start. */
  stamped: number
}

export interface SemanticAdapter {
  start(): void
  stop(): void
  diagnostics(): SemanticAdapterDiagnostics
  readonly running: boolean
}

interface LiveRule {
  rule: SemanticRule
  /** False once the engine rejected the selector. */
  usable: boolean
  /** Elements matched in the latest full pass. */
  matchedInPass: number
}

export function createSemanticAdapter(doc: Document): SemanticAdapter {
  const rules: LiveRule[] = SEMANTIC_RULES_V1.map((rule) => ({ rule, usable: true, matchedInPass: 0 }))
  let observer: MutationObserver | null = null
  let stamped = 0
  let running = false

  const applyRule = (live: LiveRule, el: Element): void => {
    if (!live.usable) return
    let hit = false
    try {
      hit = el.matches(live.rule.selector)
    } catch {
      live.usable = false
      return
    }
    if (!hit) return
    live.matchedInPass += 1
    for (const [name, value] of live.rule.attrs) {
      if (el.getAttribute(name) !== value) {
        el.setAttribute(name, value)
        stamped += 1
      }
    }
  }

  const applyToTree = (rootEl: Element): void => {
    for (const live of rules) {
      if (!live.usable) continue
      applyRule(live, rootEl)
      let matches: Element[] = []
      try {
        matches = Array.from(rootEl.querySelectorAll(live.rule.selector))
      } catch {
        live.usable = false
        continue
      }
      for (const el of matches) applyRule(live, el)
    }
  }

  const fullPass = (): void => {
    for (const live of rules) live.matchedInPass = 0
    if (doc.documentElement) applyToTree(doc.documentElement)
  }

  return {
    get running() {
      return running
    },

    start() {
      if (running) return
      running = true
      fullPass()
      observer = new doc.defaultView!.MutationObserver((records) => {
        try {
          for (const record of records) {
            for (const node of Array.from(record.addedNodes)) {
              if (node.nodeType === 1) applyToTree(node as Element)
            }
          }
        } catch {
          // Fail-closed: a tagging error must never break the host page.
        }
      })
      observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
    },

    stop() {
      running = false
      observer?.disconnect()
      observer = null
    },

    diagnostics() {
      return {
        invalidRules: rules.filter((r) => !r.usable).map((r) => r.rule.selector),
        unmatchedRules: rules.filter((r) => r.usable && r.matchedInPass === 0).map((r) => r.rule.selector),
        stamped,
      }
    },
  }
}
