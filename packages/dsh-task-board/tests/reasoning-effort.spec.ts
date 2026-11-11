/**
 * Task-card reasoning effort: the whole Host/ledger chain for one optional
 * field.
 *
 * The card stores an effort id, the strict same-origin gate refuses anything
 * that is not a string, the ledger keeps the value across a restart, a subtask
 * runs at its ancestor's effort while it pins none of its own, and the launch
 * decision sends an effort ONLY for the exact model route whose adapter
 * declares it. This file drives the real ledger (temporary directory) and the
 * strict action gate, so every case asserts the state a user can observe.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseActionEnvelope } from '../src/protocol.ts'
import { HostTaskLedger, type LedgerState, type OpenedRun } from '../src/host-ledger.ts'
import { resolveExecutionTargets } from '../src/core/subtask.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { normalizeReasoningEffort, declaredRoute, resolveReasoningEffort } from '../src/core/reasoning-effort.ts'
import type { ModelCatalogView } from '../src/core/model-catalog.ts'

const NOW = 1_700_000_000_000

const roots: string[] = []

/** One scratch ledger directory, removed after the case. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-board-effort-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Monotonic request ids: the ledger deduplicates by request id, so each call needs its own. */
let requestSeq = 0
function nextRequestId(kind: string): string {
  requestSeq += 1
  return kind + '-' + String(requestSeq)
}

/** Create one card through the strict gate, exactly as the browser does. */
function createCard(ledger: HostTaskLedger, id: string, input: Record<string, unknown> = {}): LedgerState {
  const parsed = parseActionEnvelope({
    requestId: nextRequestId('create'),
    action: { kind: 'create', id, input: { title: id, description: '', prompt: 'do work', ...input } },
  })
  if (parsed === undefined) throw new Error('the create action was refused by the gate')
  return ledger.applyRequest(parsed.requestId, parsed.action).state
}

/** Apply one update through the strict gate; undefined when the gate refused it. */
function updateCard(ledger: HostTaskLedger, taskId: string, patch: Record<string, unknown>): LedgerState | undefined {
  const parsed = parseActionEnvelope({ requestId: nextRequestId('update'), action: { kind: 'update', taskId, patch } })
  if (parsed === undefined) return undefined
  return ledger.applyRequest(parsed.requestId, parsed.action).state
}

/** Run one card through the ledger, returning the executions it opened. */
function runCard(ledger: HostTaskLedger, taskId: string): readonly OpenedRun[] {
  const parsed = parseActionEnvelope({ requestId: nextRequestId('run'), action: { kind: 'run', taskId } })
  if (parsed === undefined) throw new Error('the run action was refused by the gate')
  return ledger.applyRequest(parsed.requestId, parsed.action).runs ?? []
}

/** Link one card under a parent through the strict gate, exactly as the browser does. */
function linkCard(ledger: HostTaskLedger, taskId: string, parentId: string): LedgerState {
  const parsed = parseActionEnvelope({ requestId: nextRequestId('link'), action: { kind: 'set-parent', taskId, parentId } })
  if (parsed === undefined) throw new Error('the set-parent action was refused by the gate')
  return ledger.applyRequest(parsed.requestId, parsed.action).state
}

/** The one card with `id` in the given ledger state. */
function cardOf(state: LedgerState, id: string): TaskRecord {
  const task = state.tasks.find(candidate => candidate.id === id)
  if (task === undefined) throw new Error('no card ' + id)
  return task
}

describe('task card reasoning effort', () => {
  it('user creating a card with a reasoning effort keeps it across a Host restart', () => {
    // Given a board whose ledger lives in a scratch directory
    const dir = scratch()
    const ledger = new HostTaskLedger(dir, () => NOW)

    // When the user creates a card that pins an effort and the Host restarts
    createCard(ledger, 'task-effort', { reasoningEffort: 'high' })
    ledger.dispose()

    // Then the card stores the effort, and a freshly opened ledger reads it back
    expect(cardOf(ledger.state(), 'task-effort').reasoningEffort).toBe('high')
    expect(cardOf(new HostTaskLedger(dir, () => NOW).state(), 'task-effort').reasoningEffort).toBe('high')
  })

  it('user editing the effort on a card stores the new value and clearing it restores inheritance', () => {
    // Given a card that pins an effort
    const ledger = new HostTaskLedger(scratch(), () => NOW)
    createCard(ledger, 'task-effort', { reasoningEffort: 'high' })

    // When the user switches the effort, then clears it with the wire's clearing value
    const switched = updateCard(ledger, 'task-effort', { reasoningEffort: 'low' })
    const cleared = updateCard(ledger, 'task-effort', { reasoningEffort: '' })

    // Then each edit is stored, and the cleared card pins nothing at all
    expect(switched === undefined ? undefined : cardOf(switched, 'task-effort').reasoningEffort).toBe('low')
    expect(cleared === undefined ? undefined : cardOf(cleared, 'task-effort').reasoningEffort).toBeUndefined()
    expect('reasoningEffort' in cardOf(cleared as LedgerState, 'task-effort')).toBe(true)
  })

  it('user submitting an effort that is not text is refused by the strict action gate', () => {
    // Given a board and a create action whose effort is a number, plus an update carrying an object
    const ledger = new HostTaskLedger(scratch(), () => NOW)
    createCard(ledger, 'task-plain')

    // When the strict same-origin gate parses those actions
    const badCreate = parseActionEnvelope({
      requestId: 'bad-create',
      action: { kind: 'create', id: 'task-bad', input: { title: 'bad', description: '', prompt: 'x', reasoningEffort: 3 } },
    })
    const badUpdate = parseActionEnvelope({
      requestId: 'bad-update',
      action: { kind: 'update', taskId: 'task-plain', patch: { reasoningEffort: { id: 'high' } } },
    })
    const goodUpdate = parseActionEnvelope({
      requestId: 'good-update',
      action: { kind: 'update', taskId: 'task-plain', patch: { reasoningEffort: 'high' } },
    })

    // Then both malformed actions are refused and the well-formed one is accepted
    expect([badCreate, badUpdate]).toEqual([undefined, undefined])
    expect(goodUpdate === undefined ? undefined : goodUpdate.action).toEqual({ kind: 'update', taskId: 'task-plain', patch: { reasoningEffort: 'high' } })
    expect(ledger.state().tasks.map(task => task.id)).toEqual(['task-plain'])
  })

  it('user running a subtask executes it at the ancestor effort while its own pin wins', () => {
    // Given a root card pinning an effort, one subtask pinning none, and two pinning their own
    const ledger = new HostTaskLedger(scratch(), () => NOW)
    createCard(ledger, 'task-root', { reasoningEffort: 'high' })
    createCard(ledger, 'task-child', { parentId: 'task-root' })
    createCard(ledger, 'task-own', { parentId: 'task-root', reasoningEffort: 'low' })
    createCard(ledger, 'task-cleared', { parentId: 'task-root', reasoningEffort: 'low' })

    // When the user runs each subtask
    const inherited = runCard(ledger, 'task-child')
    const own = runCard(ledger, 'task-own')

    // Then the inheriting member runs at the ancestor effort and the pinning one at its own
    expect(inherited.map(run => [run.task.id, run.task.reasoningEffort])).toEqual([['task-child', 'high']])
    expect(own.map(run => [run.task.id, run.task.reasoningEffort])).toEqual([['task-own', 'low']])

    // And a card that stores no value of its own still runs at the ancestor one
    const state = ledger.state()
    const bare: TaskRecord = { ...cardOf(state, 'task-child'), reasoningEffort: undefined }
    const resolved = resolveExecutionTargets(bare, state.tasks.map(task => task.id === 'task-child' ? bare : task))
    expect(resolved.reasoningEffort).toBe('high')

    // And clearing a subtask's own effort returns it to that same inheritance
    const cleared = updateCard(ledger, 'task-cleared', { reasoningEffort: '' })
    expect(cleared === undefined ? undefined : cardOf(cleared, 'task-cleared').reasoningEffort).toBeUndefined()
    expect(runCard(ledger, 'task-cleared').map(run => run.task.reasoningEffort)).toEqual(['high'])
  })

  it('user picking a model on the create form never drags the parent level onto it', () => {
    // Given a root card pinning a model and one of its levels
    const ledger = new HostTaskLedger(scratch(), () => NOW)
    createCard(ledger, 'task-root', { model: 'acme/a', reasoningEffort: 'high' })

    // When the user creates subtasks that pick a model themselves and leave the effort to that model
    createCard(ledger, 'task-same-model', { parentId: 'task-root', model: 'acme/a' })
    createCard(ledger, 'task-other-model', { parentId: 'task-root', model: 'acme/b' })
    createCard(ledger, 'task-untouched', { parentId: 'task-root' })

    // Then an explicitly picked model never re-fills the ancestor level...
    const state = ledger.state()
    expect(cardOf(state, 'task-same-model').model).toBe('acme/a')
    expect(cardOf(state, 'task-same-model').reasoningEffort).toBeUndefined()
    expect(cardOf(state, 'task-other-model').model).toBe('acme/b')
    expect(cardOf(state, 'task-other-model').reasoningEffort).toBeUndefined()

    // ...while a subtask that picked nothing still copies the model and its level
    expect(cardOf(state, 'task-untouched').model).toBe('acme/a')
    expect(cardOf(state, 'task-untouched').reasoningEffort).toBe('high')
  })

  it('user running a subtask on its own model runs at that model default, not the ancestor level', () => {
    // Given a root card at one model and level, and a subtask pinned to another model with no level
    const ledger = new HostTaskLedger(scratch(), () => NOW)
    createCard(ledger, 'task-root', { model: 'acme/a', reasoningEffort: 'high' })
    createCard(ledger, 'task-child', { parentId: 'task-root', model: 'acme/b' })

    // When the user runs the subtask
    const [run] = runCard(ledger, 'task-child')

    // Then the run keeps its own model and sends no effort at all: the ancestor
    // level was chosen for the ancestor model and cannot cross the model pin
    expect(run?.task.model).toBe('acme/b')
    expect(run?.task.reasoningEffort).toBeUndefined()
  })

  it('user running a subtask that pins no model follows the ancestor model and its level', () => {
    // Given a root card at one model and level, and a subtask that pins no model of its own
    const ledger = new HostTaskLedger(scratch(), () => NOW)
    createCard(ledger, 'task-root', { model: 'acme/a', reasoningEffort: 'high' })
    createCard(ledger, 'task-child', { parentId: 'task-root' })

    // When the user runs the subtask
    const [run] = runCard(ledger, 'task-child')

    // Then both the model and the level come from the ancestor
    expect(run?.task.model).toBe('acme/a')
    expect(run?.task.reasoningEffort).toBe('high')
  })

  it('user pinning only a level on a subtask applies it to the inherited model', () => {
    // Given a root card at one model and level, and a subtask pinning only its own level
    const ledger = new HostTaskLedger(scratch(), () => NOW)
    createCard(ledger, 'task-root', { model: 'acme/a', reasoningEffort: 'high' })
    createCard(ledger, 'task-child', { parentId: 'task-root', reasoningEffort: 'low' })

    // When the user runs the subtask
    const [run] = runCard(ledger, 'task-child')

    // Then the own level wins over the inherited model
    expect(run?.task.model).toBe('acme/a')
    expect(run?.task.reasoningEffort).toBe('low')
  })

  it('user clearing a copied subtask level is not handed the ancestor level back', () => {
    // Given a subtask that copied the parent model and level on creation
    const ledger = new HostTaskLedger(scratch(), () => NOW)
    createCard(ledger, 'task-root', { model: 'acme/a', reasoningEffort: 'high' })
    createCard(ledger, 'task-child', { parentId: 'task-root' })

    // When the user clears that level through the wire's clearing value
    updateCard(ledger, 'task-child', { reasoningEffort: '' })
    const [run] = runCard(ledger, 'task-child')

    // Then the card keeps its (copied) model pin and the launch sends no level:
    // the cleared card must not silently run at the ancestor's high
    expect(cardOf(ledger.state(), 'task-child').model).toBe('acme/a')
    expect(cardOf(ledger.state(), 'task-child').reasoningEffort).toBeUndefined()
    expect(run?.task.model).toBe('acme/a')
    expect(run?.task.reasoningEffort).toBeUndefined()
  })

  it('user linking a card to a parent never inherits a level across its own model pin', () => {
    // Given a parent at one model and level, plus two free cards: one pinning another model, one pinning nothing
    const ledger = new HostTaskLedger(scratch(), () => NOW)
    createCard(ledger, 'task-root', { model: 'acme/a', reasoningEffort: 'high' })
    createCard(ledger, 'task-free-model', { model: 'acme/b' })
    createCard(ledger, 'task-free-bare')

    // When the user links both under the parent
    linkCard(ledger, 'task-free-model', 'task-root')
    linkCard(ledger, 'task-free-bare', 'task-root')

    // Then the model-pinning card runs at its own model default...
    const [pinned] = runCard(ledger, 'task-free-model')
    expect(pinned?.task.model).toBe('acme/b')
    expect(pinned?.task.reasoningEffort).toBeUndefined()

    // ...and the bare card follows the parent model and level
    const [bare] = runCard(ledger, 'task-free-bare')
    expect(bare?.task.model).toBe('acme/a')
    expect(bare?.task.reasoningEffort).toBe('high')
  })

  it('operator importing a board keeps every card model and level pair', () => {
    // Given an exported card that pins a model with one of its levels
    const exported = createTask({ title: 'Exported', description: '', prompt: 'work', model: 'acme/a', reasoningEffort: 'high' }, NOW, 'task-export')
    const ledger = new HostTaskLedger(scratch(), () => NOW)

    // When the board imports it through the strict gate
    const parsed = parseActionEnvelope({ requestId: 'import-1', action: { kind: 'import', sourceId: 'legacy-v1', tasks: [exported] } })
    if (parsed === undefined) throw new Error('the import action was refused by the gate')
    const state = ledger.applyRequest(parsed.requestId, parsed.action).state

    // Then the imported card still carries BOTH values of the pair: the level
    // means nothing without the model it was chosen for
    expect(cardOf(state, 'task-export').model).toBe('acme/a')
    expect(cardOf(state, 'task-export').reasoningEffort).toBe('high')
  })
})

describe('reasoning effort resolution for one execution route', () => {
  /** One catalog declaring a reasoner with two efforts and a plain chat model. */
  const catalog: ModelCatalogView = {
    default: { provider: 'deepseek', model: 'deepseek-chat' },
    groups: [{
      id: 'deepseek',
      models: [
        { id: 'deepseek-chat' },
        { id: 'deepseek-reasoner', reasoning: { efforts: [{ id: 'high' }, { id: 'low' }], defaultEffort: 'low' } },
      ],
    }],
  }

  it('user choosing an effort the target model declares sends exactly that effort', () => {
    // Given a card whose effort is declared by its pinned model
    const requested = 'high'
    const route = { provider: 'deepseek', model: 'deepseek-reasoner' }

    // When the launch resolves it against the host catalog
    const decision = resolveReasoningEffort(requested, catalog, route)

    // Then that exact effort is what the session receives
    expect(decision).toEqual({ effort: 'high' })
  })

  it('user choosing an effort the target model does not declare sends nothing', () => {
    // Given a model-route switch to a model that declares neither this effort nor any other
    const declaredElsewhere = resolveReasoningEffort('high', catalog, { provider: 'deepseek', model: 'deepseek-chat' })
    const undeclaredId = resolveReasoningEffort('ultra', catalog, { provider: 'deepseek', model: 'deepseek-reasoner' })
    const unknownRoute = resolveReasoningEffort('high', catalog, { provider: 'other', model: 'mystery-model' })
    const noCatalog = resolveReasoningEffort('high', undefined, { provider: 'deepseek', model: 'deepseek-reasoner' })

    // When the launch reports what it will send
    // Then an unsupported effort is reported as dropped and never sent
    expect(declaredElsewhere).toEqual({ dropped: 'high' })
    expect(undeclaredId).toEqual({ dropped: 'ultra' })
    expect(unknownRoute).toEqual({ dropped: 'high' })
    expect(noCatalog).toEqual({ dropped: 'high' })
  })

  it('user leaving the effort unset sends nothing and blank text means the same', () => {
    // Given a card that never chose an effort, and one carrying only whitespace
    // When the launch resolves both
    const unset = resolveReasoningEffort(undefined, catalog, { provider: 'deepseek', model: 'deepseek-reasoner' })
    const blank = resolveReasoningEffort('   ', catalog, { provider: 'deepseek', model: 'deepseek-reasoner' })

    // Then neither produces an effort, so the model's own default stands
    expect([unset, blank]).toEqual([{}, {}])
    expect([normalizeReasoningEffort('  '), normalizeReasoningEffort(' high ')]).toEqual([undefined, 'high'])
  })

  it('user pinning a bare model id resolves its provider from the catalog', () => {
    // Given a route that names only a model id
    // When the launch looks it up
    const resolved = declaredRoute(catalog, { model: 'deepseek-reasoner' })
    const missing = declaredRoute(catalog, { model: 'not-in-catalog' })
    const qualified = declaredRoute(catalog, { provider: 'deepseek', model: 'deepseek-chat' })

    // Then the catalog supplies the provider, or nothing when it declares no such model
    expect(resolved).toEqual({ provider: 'deepseek', model: 'deepseek-reasoner', reasoning: { efforts: [{ id: 'high' }, { id: 'low' }], defaultEffort: 'low' } })
    expect(missing).toBeUndefined()
    expect(qualified).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })
})
