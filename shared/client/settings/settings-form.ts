/**
 * Staged form model behind the plugin settings card. A card stages what the
 * user types and writes it only when they save — the settings write is a
 * durable, revision-fenced document mutation, so staging keeps what is on
 * screen exactly what a save would store. Family-shared slice inlined into
 * each plugin's client bundle; mirrors the official ui-plugin-config
 * card-store pattern.
 */

import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The write one field's staged text performs when the card is saved. */
export type FieldWrite =
  | { kind: 'set'; value: unknown }
  | { kind: 'clear' }

/** How one field converts between its stored value and its draft text. */
export interface FieldSpec {
  /** Field name inside the namespace section. */
  field: string
  /**
   * Whether the Host treats this field as a secret and redacts its value from
   * the read-back (role('secret') in the section schema). Redacted secrets are
   * never compared against the draft on save: the Host strips them from every
   * wire view layer, so the settled snapshot carries nothing to read back. A
   * staged secret set is judged by the mutation settling; the rest of its
   * batch, when one exists, is still judged by read-back, and the atomic
   * mutation lands every write or none.
   */
  secret?: boolean
  /** Render a stored value as draft text; the empty string when the section carries none. */
  format: (value: unknown) => string
  /**
   * The write this draft text stages, or undefined when the text is not a
   * value this field accepts — which blocks the save rather than discarding it.
   */
  parse: (text: string) => FieldWrite | undefined
}

/** One field as the card renders it. */
export interface FieldState {
  /** Draft text the control renders. */
  text: string
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Whether the draft is not a value this field accepts, which blocks saving. */
  invalid: boolean
}

/** Form state every plugin settings card shares. */
export interface CardShell {
  /** False while the namespace is still loading; the card renders nothing. */
  available: boolean
  /**
   * Whether the namespace is actually served to this client. False when the
   * Host deployment does not expose it (e.g. the owning plugin's settings
   * domain is not mounted): the card renders an explanation
   * instead of its form, so a missing namespace never looks like a missing
   * plugin.
   */
  exposed: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
  /**
   * The rejection code/message the Host returned for the last failed save,
   * surfaced next to the generic failure text. Undefined while no save has
   * failed (or the failure carried no server reason).
   */
  failedReason?: string
}

/** The write actions the card's slot entry injects. */
export interface CardActions {
  /** Stage draft text for one field. */
  edit: (field: string, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: string) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** One field's staged edit. */
interface StagedEdit {
  /** Draft text the control renders. */
  text: string
  /** True when this edit clears the field whatever text it shows. */
  clear: boolean
}

/** One staged edit resolved into the write a save performs. */
interface PlannedWrite {
  /** Field this entry writes. */
  field: string
  /** The durable write this entry performs, inside the save's one atomic mutation. */
  op: BatchedWrite
  /**
   * Read the settled snapshot back and report whether the Host holds this
   * write's effect. Undefined when the draft is not a value the field
   * accepts: there is nothing to write, and the entry blocks the save.
   */
  judge: (() => boolean) | undefined
}

/** One durable write inside the save's atomic scope mutation. */
export interface BatchedWrite {
  /** Field this entry writes. */
  field: string
  /** set stores a value; unset drops the leaf. */
  op: 'set' | 'unset'
  /** Value for op set (absent for unset). */
  value?: unknown
}

/** Constraints a numeric field's accepted drafts must satisfy, mirroring the host schema. */
export interface NumberConstraints {
  /** The accepted value must be a whole number. */
  integer?: boolean
  /** The accepted value must be at least this. */
  min?: number
}

/** A whole- or decimal-number field. An empty draft clears the field; any other draft that is not a finite number within the constraints blocks the save. */
export function numberField(field: string, constraints: NumberConstraints = {}): FieldSpec {
  const { integer = false, min } = constraints
  return {
    field,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      if (!Number.isFinite(parsed)) return undefined
      if (integer && !Number.isInteger(parsed)) return undefined
      if (min !== undefined && parsed < min) return undefined
      return { kind: 'set', value: parsed }
    },
  }
}

/** A free-text field. An empty draft clears the field. */
export function textField(field: string): FieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/**
 * A free-text field the Host treats as a secret and redacts from the read-back
 * (role('secret') in the section schema). The card still edits it like text,
 * but a save never compares the redacted value back: the staged set is judged
 * by the mutation settling (see {@link FieldSpec.secret}).
 */
export function secretField(field: string): FieldSpec {
  return { ...textField(field), secret: true }
}

/** A boolean field, edited through true/false draft text. */
export function booleanField(field: string): FieldSpec {
  return {
    field,
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (trimmed === 'true') return { kind: 'set', value: true }
      if (trimmed === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/** An enumerated string field; only the listed choices are accepted. An empty draft clears the field. */
export function choiceField(field: string, choices: readonly string[]): FieldSpec {
  return {
    field,
    format: value => typeof value === 'string' && choices.includes(value) ? value : '',
    parse: (text) => {
      if (text === '') return { kind: 'clear' }
      return choices.includes(text) ? { kind: 'set', value: text } : undefined
    },
  }
}

/**
 * Stages one card's edits over one settings namespace and writes them on save.
 *
 * The Host is the only authority on whether a value was accepted — its
 * validators own the constraints no schema can express — so the outcome is
 * read back from the section rather than predicted here. A save that did not
 * land keeps its drafts, so the user can correct them instead of retyping.
 */
export class CardForm<T> {
  private readonly specs: Map<string, FieldSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  /** The scope subscription installed in the constructor; released by dispose(). */
  private readonly disposeScope: () => void
  private disposed = false
  private saving = false
  private failed = false
  private failedReason: string | undefined

  /** @param scope - the bound settings scope for this card's namespace. */
  constructor(
    private readonly scope: SettingsScope<T>,
    specs: FieldSpec[],
  ) {
    this.specs = new Map(specs.map(spec => [spec.field, spec]))
    this.disposeScope = scope.subscribe(() => { this.publish() })
  }

  /**
   * Release the scope subscription and every bound store listener. The card
   * must call this on teardown; later calls are no-ops.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeScope()
    this.listeners.clear()
  }

  /** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /** Read the card-level state: what the Host serves, and what a save would do. */
  shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status !== 'loading',
      exposed: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.judge === undefined),
      saving: this.saving,
      failed: this.failed,
      ...this.failedReason === undefined ? {} : { failedReason: this.failedReason },
    }
  }

  /** Read one field's state from the effective section and its staged draft. */
  field(field: string): FieldState {
    const spec = this.specOf(field)
    const staged = this.staged.get(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return {
      text: staged.text,
      overridden: write?.kind === 'set',
      invalid: write === undefined,
    }
  }

  /** The actions the card's slot registration injects. */
  actions(): CardActions {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => {
        this.stage(field, { text: this.specOf(field).format(this.baseValue(field)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.failedReason = undefined
        this.publish()
      },
    }
  }

  /**
   * Write every staged edit in one atomic scope mutation, then re-seed from
   * what the Host accepted.
   *
   * The whole batch rides one mutate, so cross-field validate hooks
   * (baseURL+model) judge it as a unit: the Host either applies every write
   * or refuses the batch. The 0.1.2 scope contract never rejects a refused
   * mutation — the scope recovers with a fresh Host view and resolves — so
   * resolution alone proves nothing: the outcome is judged by reading the
   * settled snapshot back, one planned write at a time, and one missed write
   * fails the whole save. A scope that still rejects on refusal (the dsh-web
   * bridge scope) reports through the same failure path with its rejection
   * message. A save that did not land keeps its drafts, so the user can
   * correct them instead of retyping.
   * @returns settlement after the mutation and the read-back.
   */
  async save(): Promise<void> {
    const plan = this.plan()
    const valid = plan.filter((item): item is PlannedWrite & { judge: () => boolean } => item.judge !== undefined)
    if (plan.length === 0 || this.saving || valid.length !== plan.length) return
    // Snapshot the staged entries this save writes, so an edit staged while it
    // is in flight (which replaces the same key) survives: only delete the key
    // when the entry is still the one this save started from.
    const pending = new Map<string, StagedEdit | undefined>()
    for (const item of plan) pending.set(item.field, this.staged.get(item.field))
    this.saving = true
    this.failed = false
    this.failedReason = undefined
    this.publish()
    // One atomic namespace mutation: the 0.1.2 scope contract takes ordered
    // path operations, so the whole staged batch is validated, persisted, and
    // recovered together — either every write lands or none does.
    const ops: Array<{ op: 'set'; path: string[]; value: string | number | boolean } | { op: 'unset'; path: string[] }> = valid.map(item => item.op.op === 'set'
      ? { op: 'set', path: [item.field], value: (item.op as { value: string | number | boolean }).value }
      : { op: 'unset', path: [item.field] })
    let failedReason: string | undefined
    try {
      await this.scope.mutate(ops)
    } catch (error) {
      failedReason = error instanceof Error ? error.message : String(error)
    }
    // The 0.1.2 scope resolves even a refused mutation (it recovers with a
    // fresh view instead of throwing), so resolution alone proves nothing:
    // judge every planned write against the settled snapshot. The mutation is
    // atomic, so one missed write fails the whole save and keeps the drafts.
    const landed = failedReason === undefined && valid.every(item => item.judge())
    for (const [field, before] of pending) {
      if (landed && this.staged.get(field) === before) this.staged.delete(field)
    }
    this.saving = false
    this.failed = !landed
    // A read-back failure carries no server reason: the card surfaces its
    // generic failure copy; a rejecting scope (the bridge) adds its message.
    this.failedReason = failedReason
    this.publish()
  }

  /**
   * Every staged edit a save would write. An entry whose draft is not a value
   * its field accepts carries no write: the form is still dirty, and the save
   * refuses rather than dropping the edit. A staged edit that matches the
   * effective section is not a write at all.
   * @returns the planned writes, in the order the fields were staged.
   */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const spec = this.specOf(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, op: { field, op: 'unset' }, judge: () => this.landedUnset(field) })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field, op: { field, op: 'unset' }, judge: undefined })
      else if (write.kind === 'clear') plan.push({ field, op: { field, op: 'unset' }, judge: () => this.landedUnset(field) })
      else plan.push({ field, op: { field, op: 'set', value: write.value }, judge: () => this.landedSet(field, write.value) })
    }
    return plan
  }

  /**
   * Read-back judgment for a planned set: the user layer must hold the
   * intended value once the mutation has settled.
   */
  private landedSet(field: string, value: unknown): boolean {
    // A redacted secret never appears in any wire view layer: the Host strips
    // role('secret') fields and reports them through a sidecar the scope
    // snapshot does not expose, so there is nothing to compare the draft
    // against. Settling is the only signal the form has; the rest of the
    // batch, when one exists, still carries the atomic verdict by read-back.
    if (this.specOf(field).secret) return true
    return this.userLayer()?.[field] === value
  }

  /**
   * Read-back judgment for a planned unset: the field must be gone from the
   * user layer once the mutation has settled.
   */
  private landedUnset(field: string): boolean {
    return !this.stored(field)
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.failedReason = undefined
    this.publish()
  }

  private specOf(field: string): FieldSpec {
    const spec = this.specs.get(field)
    // Every call site names a field this card declared; a missing one is a
    // wiring mistake that must not degrade into a silently inert control.
    if (spec === undefined) throw new Error(`settings card has no field ${field}`)
    return spec
  }

  private snapshotOf(): SettingsScopeSnapshot<T> {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: string): unknown {
    return (this.snapshotOf().value as Record<string, unknown> | undefined)?.[field]
  }

  private baseValue(field: string): unknown {
    return (this.snapshotOf().base as Record<string, unknown> | undefined)?.[field]
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.snapshotOf().user as Record<string, unknown> | undefined
  }

  private stored(field: string): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
