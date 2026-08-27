// @vitest-environment node
// The Better Session section nests inside the perf settings card, so its
// contract is DOM-shape, not slot registration: one section owned by
// dsh-perf, copy keyed through the shared namespace with the bsm. prefix,
// and the action set flipping with the mount posture. renderToString covers
// that without a DOM; the fetch side effects stay out via the wired override.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { BetterSessionCard, type CardViewModel } from '../src/client/better-session-card.tsx'
import { dictionaries } from '../src/client/bs-locales.ts'

/** Identity translate that records the keys the section reads. */
function makeT(keys: string[]): (key: string, params?: Record<string, string | number>) => string {
  return (key, params) => {
    keys.push(key)
    let out = dictionaries.zh[key as keyof typeof dictionaries.zh] ?? key
    for (const [name, value] of Object.entries(params ?? {})) out = out.replaceAll(`{${name}}`, String(value))
    return out
  }
}

function makeWired(model: Partial<CardViewModel>) {
  return {
    model: {
      posture: 'inactive-by-default',
      statusError: undefined,
      busy: null,
      notice: null,
      confirmKind: null,
      status: undefined,
      ...model,
    } as CardViewModel,
    refresh: () => {},
    requestEnable: () => {},
    confirmEnable: async () => {},
    requestDisable: () => {},
    confirmDisable: async () => {},
    cancelConfirm: () => {},
  }
}

describe('BetterSessionCard nested section', () => {
  it('renders one dsh-perf-owned section with bsm.-prefixed copy and the enable action while inactive', () => {
    const keys: string[] = []
    const html = renderToString(
      <BetterSessionCard
        t={makeT(keys)}
        wired={makeWired({
          status: {
            mountState: 'inactive-by-default',
            aggregateArtifactSeen: true,
            legacyTotalSessions: 483,
            legacyProjects: [{ key: 'demo', sessions: 483, bytes: 1 }],
            storeExists: false,
          },
        })}
      />,
    )
    expect(html).toContain('data-dsh-plugin="dsh-perf"')
    expect(html).toContain('data-dsh-part="better-session"')
    expect(keys).toContain('bsm.settings.title')
    expect(keys).toContain('bsm.settings.sourcePrefix')
    expect(html).toContain('morlay/better-session')
    expect(html).toContain('共 483 个（跨 1 个项目）')
    // Inactive posture: enable offered, disable not.
    expect(html).toContain(dictionaries.zh['bsm.action.enable' as never] as string)
    expect(html).not.toContain(dictionaries.zh['bsm.action.disable' as never] as string)
    for (const key of keys) expect(key.startsWith('bsm.')).toBe(true)
  })

  it('flips to the disable action and shows store counts once enabled', () => {
    const html = renderToString(
      <BetterSessionCard
        t={makeT([])}
        wired={makeWired({
          posture: 'enabled-via-profile',
          status: {
            mountState: 'enabled-via-profile',
            aggregateArtifactSeen: true,
            legacyTotalSessions: 0,
            legacyProjects: [],
            storeExists: true,
            storeSessions: 490,
            storeEvents: 123456,
          },
        })}
      />,
    )
    expect(html).toContain('490 会话 / 123456 事件')
    expect(html).toContain(dictionaries.zh['bsm.action.disable' as never] as string)
    expect(html).not.toContain(dictionaries.zh['bsm.action.enable' as never] as string)
  })

  it('renders the confirm dialog while a switch is pending confirmation', () => {
    const html = renderToString(
      <BetterSessionCard t={makeT([])} wired={makeWired({ confirmKind: 'enable' })} />,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain(dictionaries.zh['bsm.warn.enableTitle' as never] as string)
    expect(html).toContain(dictionaries.zh['bsm.dialog.confirm' as never] as string)
  })
})
