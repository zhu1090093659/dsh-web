/**
 * Provider disable/enable: the archive store parsing, the op builders, and
 * the two-phase orchestration (stash -> unset on disable, restore -> clear on
 * enable) with revision fencing and failure branches.
 */

import { describe, expect, it } from 'vitest'
import type { RemoteResult, SettingsDescribeValue, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  buildRestoreProviderOp,
  buildStashOp,
  buildUnsetProviderOp,
  buildUnstashOp,
  CAPS_ENTRY_IDS,
  hasNonUserProfile,
  hasProfileAt,
  readDisabledStore,
  resolveArchiveEntry,
} from '../src/core/provider-toggle.ts'
import { disableProvider, enableProvider, type ToggleOutcome } from '../src/client/provider-toggle.ts'
import type { SettingsNamespaceFace } from '../src/client/settings-face.ts'
import type { PathOp } from '../src/core/capabilities.ts'

/** The profile entry id this deployment mounts the plugin under (the aggregate's row). */
const CAPS_ENTRY_ID = CAPS_ENTRY_IDS[1]

/** One served settings form as the archive resolution reads it. */
function form(ns: string, schema: unknown = {}): { ns: string, schema: unknown } {
  return { ns, schema }
}

/**
 * The archive form schema as the Host serves it: the plugin's Config projected
 * to its volatile fields, which is a single open-typed `disabled` field.
 */
const ARCHIVE_SCHEMA = { type: 'object', meta: { default: {} }, dict: { disabled: { type: 'any', meta: { default: {} } } } }

describe('archive store', () => {
  it('parses stash entries and skips malformed ones', () => {
    const value = {
      disabled: {
        acme: { profile: { apiKeyEnv: 'ACME_KEY' }, displayName: 'ACME' },
        junk: 'not-an-object',
        noProfile: { displayName: 'x' },
      },
    }
    const store = readDisabledStore(value)
    expect(store['acme']).toEqual({ profile: { apiKeyEnv: 'ACME_KEY' }, displayName: 'ACME' })
    expect(store['junk']).toBeUndefined()
    expect(store['noProfile']).toBeUndefined()
  })

  it('tolerates missing or malformed sections', () => {
    expect(readDisabledStore(undefined)).toEqual({})
    expect(readDisabledStore({})).toEqual({})
    expect(readDisabledStore({ disabled: 'junk' })).toEqual({})
  })

  it('checks one layer for a provider profile', () => {
    const user = { providers: { acme: { apiKeyEnv: 'ACME_KEY' } } }
    expect(hasProfileAt(user, 'acme')).toBe(true)
    expect(hasProfileAt(user, 'other')).toBe(false)
    expect(hasProfileAt(undefined, 'acme')).toBe(false)
    expect(hasProfileAt({ providers: { acme: 'junk' } }, 'acme')).toBe(false)
  })

  it('detects a profile another layer owns', () => {
    const user = { providers: { acme: { apiKeyEnv: 'USER' } } }
    const base = { providers: { acme: { apiKeyEnv: 'BASE' } } }
    expect(hasNonUserProfile({ user, base, value: base }, 'acme')).toBe(true)
    expect(hasNonUserProfile({ user, base: { providers: {} }, value: user }, 'acme')).toBe(false)
    // No base in the view: the resolved value minus the user layer answers.
    expect(hasNonUserProfile({ user: { providers: {} }, value: user }, 'acme')).toBe(true)
    expect(hasNonUserProfile({ user, value: user }, 'acme')).toBe(false)
    expect(hasNonUserProfile({}, 'acme')).toBe(false)
  })
})

describe('archive entry resolution', () => {
  it('operator gets the standalone row id when both install sources are served', () => {
    // Given a profile serving the neighbouring pi-ai form plus both of this plugin's rows
    const forms = [form('llm-pi-ai'), form(CAPS_ENTRY_IDS[1]), form(CAPS_ENTRY_IDS[0])]

    // When the browser half resolves its own settings entry
    const resolved = resolveArchiveEntry(forms)

    // Then the package's own row id answers
    expect(resolved?.entryId).toBe(CAPS_ENTRY_IDS[0])
  })

  it('operator gets the aggregate row id the family bundle mounts', () => {
    // Given a profile whose only row for this plugin is the aggregate's web-ui-* one
    const caps = form('web-ui-model-capabilities')

    // When the browser half resolves its own settings entry
    const resolved = resolveArchiveEntry([form('llm-pi-ai'), caps])

    // Then that row answers with its own id and view
    expect(resolved).toEqual({ entryId: 'web-ui-model-capabilities', view: caps })
  })

  it('operator gets a renamed archive row through its form schema', () => {
    // Given a profile that renamed the row and serves no id this package knows
    const renamed = form('my-caps', ARCHIVE_SCHEMA)

    // When the browser half resolves its own settings entry
    const resolved = resolveArchiveEntry([form('llm-pi-ai'), renamed])

    // Then the entry whose form is the archive schema answers
    expect(resolved?.entryId).toBe('my-caps')
  })

  it('operator gets nothing when no served form is this plugin entry', () => {
    // Given a profile serving other plugins' forms, and a single open-typed
    // field under another name (which is not this plugin's schema)
    const foreign = [form('llm-pi-ai'), form('task-board', { type: 'object', dict: { pollMs: { type: 'number' } } })]
    const sameShaped = form('other', { type: 'object', dict: { providers: { type: 'any' } } })

    // When the browser half resolves its own settings entry
    const resolved = resolveArchiveEntry(foreign)
    const resolvedFromSimilar = resolveArchiveEntry([sameShaped])
    const resolvedFromNullSchema = resolveArchiveEntry([form('other', null)])

    // Then nothing resolves, so the surfaces degrade to their unavailable state
    expect(resolved).toBeUndefined()
    expect(resolvedFromSimilar).toBeUndefined()
    expect(resolvedFromNullSchema).toBeUndefined()
  })
})

describe('op builders', () => {
  it('shapes the four toggle ops', () => {
    expect(buildStashOp('acme', { profile: { a: 1 } })).toEqual({ op: 'set', path: ['disabled', 'acme'], value: { profile: { a: 1 } } })
    expect(buildUnstashOp('acme')).toEqual({ op: 'unset', path: ['disabled', 'acme'] })
    expect(buildUnsetProviderOp('acme')).toEqual({ op: 'unset', path: ['providers', 'acme'] })
    expect(buildRestoreProviderOp('acme', { apiKeyEnv: 'ACME_KEY', extra: { x: 1 } })).toEqual({
      op: 'set',
      path: ['providers', 'acme'],
      value: { apiKeyEnv: 'ACME_KEY', extra: { x: 1 } },
    })
  })
})

/** A programmable two-entry settings face with a mutation log. */
interface World {
  llm: SettingsNamespaceView
  caps: SettingsNamespaceView
  /** Fail the next mutate on this entry with this code. */
  failNext?: { ns: string, code: string, message?: string }
  calls: Array<{ ns: string, ops: PathOp[], revision: number | undefined }>
}

function view(ns: string, user: unknown, revision: number): SettingsNamespaceView {
  // The archive entry's schema is a passthrough, so its resolved value and
  // raw user section carry the same content; share one object like production.
  const section = user as Record<string, unknown>
  return { ns, autoGenerate: true, schema: {}, value: section as never, user: section as never, applies: 'live', secrets: [], revision }
}

/** Replace the raw user section (the resolved value follows: passthrough schema). */
function setUserSection(target: SettingsNamespaceView, section: unknown): void {
  const shared = section as Record<string, unknown>
  target.user = shared as never
  target.value = shared as never
}

function applyToUser(view: SettingsNamespaceView, op: PathOp): void {
  const user = (view.user ?? {}) as Record<string, unknown>
  const segments = op.path
  let node: Record<string, unknown> = user
  for (let index = 0; index < segments.length - 1; index++) {
    const key = segments[index]
    const child = node[key]
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      if (op.op === 'unset') return
      const created: Record<string, unknown> = {}
      node[key] = created
      node = created
    } else {
      node = child as Record<string, unknown>
    }
  }
  const last = segments[segments.length - 1]
  if (op.op === 'set') node[last] = (op as { value?: unknown }).value
  else delete node[last]
  ;(view as { user?: unknown }).user = user
}

function faceOf(world: World): SettingsNamespaceFace {
  return {
    describe: () => Promise.resolve({
      ok: true,
      value: { writable: true, hasDocument: true, namespaces: [world.llm, world.caps] } satisfies SettingsDescribeValue,
    }) as Promise<RemoteResult<SettingsDescribeValue>>,
    mutate: (ns: string, ops: never, expectedRevision: number | undefined) => {
      world.calls.push({ ns, ops: ops as unknown as PathOp[], revision: expectedRevision })
      const fail = world.failNext
      if (fail !== undefined && fail.ns === ns) {
        world.failNext = undefined
        return Promise.resolve({
          ok: false,
          error: Object.assign(new Error(fail.message ?? 'boom'), { code: fail.code }),
        }) as Promise<RemoteResult<SettingsNamespaceView>>
      }
      const view = ns === world.llm.ns ? world.llm : world.caps
      for (const op of world.calls[world.calls.length - 1].ops) applyToUser(view, op)
      view.revision += 1
      return Promise.resolve({ ok: true, value: view }) as Promise<RemoteResult<SettingsNamespaceView>>
    },
  }
}

function world(): World {
  return {
    llm: view('llm-pi-ai', { providers: { acme: { apiKeyEnv: 'ACME_KEY', models: [{ id: 'm1', input: ['text', 'image'] }] } } }, 7),
    caps: view(CAPS_ENTRY_ID, {}, 3),
    calls: [],
  }
}

const LLM_NS = 'llm-pi-ai'

describe('disableProvider', () => {
  it('stashes the user profile then unsets the route, revision-fenced', async () => {
    const w = world()
    const outcome = await disableProvider(faceOf(w), LLM_NS, 'acme', 'ACME')
    expect(outcome).toEqual({ kind: 'ok' })
    expect(w.calls).toHaveLength(2)
    expect(w.calls[0].ns).toBe(CAPS_ENTRY_ID)
    expect(w.calls[0].revision).toBe(3)
    expect(w.calls[0].ops).toEqual([{ op: 'set', path: ['disabled', 'acme'], value: { profile: { apiKeyEnv: 'ACME_KEY', models: [{ id: 'm1', input: ['text', 'image'] }] }, displayName: 'ACME' } }])
    expect(w.calls[1].ns).toBe('llm-pi-ai')
    expect(w.calls[1].revision).toBe(7)
    expect(w.calls[1].ops).toEqual([{ op: 'unset', path: ['providers', 'acme'] }])
    // The simulated writes: the route left the user layer; the archive holds the profile.
    expect(w.llm.user).toEqual({ providers: {} })
    expect(readDisabledStore(w.caps.user)['acme']?.profile).toEqual({ apiKeyEnv: 'ACME_KEY', models: [{ id: 'm1', input: ['text', 'image'] }] })
  })

  it('refuses when the composition layer also declares the route', async () => {
    const w = world()
    w.llm.base = { providers: { acme: { apiKeyEnv: 'BASE_KEY' } } }
    const outcome = await disableProvider(faceOf(w), LLM_NS, 'acme', 'ACME')
    expect(outcome).toEqual({ kind: 'base-profile' })
    expect(w.calls).toHaveLength(0)
  })

  it('refuses when the user layer holds no profile', async () => {
    const w = world()
    setUserSection(w.llm, { providers: {} })
    const outcome = await disableProvider(faceOf(w), LLM_NS, 'acme', undefined)
    expect(outcome).toEqual({ kind: 'no-profile' })
    expect(w.calls).toHaveLength(0)
  })

  it('reports unavailable when no archive entry is served', async () => {
    const w = world()
    w.caps = view('something-else', {}, 1)
    const outcome = await disableProvider(faceOf(w), LLM_NS, 'acme', undefined)
    expect(outcome).toEqual({ kind: 'unavailable' })
    expect(w.calls).toHaveLength(0)
  })

  it('stops before the unset when archiving conflicts', async () => {
    const w = world()
    w.failNext = { ns: CAPS_ENTRY_ID, code: 'settings/conflict' }
    const outcome = await disableProvider(faceOf(w), LLM_NS, 'acme', undefined)
    expect(outcome).toEqual({ kind: 'conflict', ns: CAPS_ENTRY_ID })
    expect(w.calls).toHaveLength(1)
  })

  it('reports the conflict when the route unset loses the race', async () => {
    const w = world()
    w.failNext = { ns: 'llm-pi-ai', code: 'settings/conflict' }
    const outcome = await disableProvider(faceOf(w), LLM_NS, 'acme', undefined)
    expect(outcome).toEqual({ kind: 'conflict', ns: 'llm-pi-ai' })
    // The stash write happened; a retry overwrites it harmlessly.
    expect(w.calls).toHaveLength(2)
  })
})

describe('enableProvider', () => {
  it('restores the archived profile verbatim then clears the archive', async () => {
    const w = world()
    setUserSection(w.llm, { providers: {} })
    setUserSection(w.caps, { disabled: { acme: { profile: { apiKeyEnv: 'ACME_KEY', custom: { a: 1 } }, displayName: 'ACME' } } })
    const outcome = await enableProvider(faceOf(w), LLM_NS, 'acme')
    expect(outcome).toEqual({ kind: 'ok' })
    expect(w.calls[0].ns).toBe('llm-pi-ai')
    expect(w.calls[0].ops).toEqual([{ op: 'set', path: ['providers', 'acme'], value: { apiKeyEnv: 'ACME_KEY', custom: { a: 1 } } }])
    expect(w.calls[1].ns).toBe(CAPS_ENTRY_ID)
    expect(w.calls[1].ops).toEqual([{ op: 'unset', path: ['disabled', 'acme'] }])
    expect(w.llm.user).toEqual({ providers: { acme: { apiKeyEnv: 'ACME_KEY', custom: { a: 1 } } } })
  })

  it('refuses to clobber a route that grew a new profile', async () => {
    const w = world()
    setUserSection(w.caps, { disabled: { acme: { profile: { apiKeyEnv: 'OLD' } } } })
    const outcome = await enableProvider(faceOf(w), LLM_NS, 'acme')
    expect(outcome).toEqual({ kind: 'route-exists' })
    expect(w.calls).toHaveLength(0)
  })

  it('reports a missing archive entry', async () => {
    const w = world()
    setUserSection(w.llm, { providers: {} })
    const outcome = await enableProvider(faceOf(w), LLM_NS, 'acme')
    expect(outcome).toEqual({ kind: 'no-stash' })
    expect(w.calls).toHaveLength(0)
  })

  it('surfaces a partial failure when the archive cleanup conflicts', async () => {
    const w = world()
    setUserSection(w.llm, { providers: {} })
    setUserSection(w.caps, { disabled: { acme: { profile: { apiKeyEnv: 'OLD' } } } })
    w.failNext = { ns: CAPS_ENTRY_ID, code: 'settings/conflict', message: 'moved on' }
    const outcome = await enableProvider(faceOf(w), LLM_NS, 'acme')
    expect(outcome.kind).toBe('partial')
    expect(outcome.kind === 'partial' && outcome.message).toBe('moved on')
    // The route is back regardless.
    expect(hasProfileAt(w.llm.user, 'acme')).toBe(true)
  })
})
