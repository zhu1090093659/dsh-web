/**
 * The live preset declarations of this plugin.
 *
 * A declaration is the whole of "enabled": the registry eagerly mounts the
 * preset's rows and hands back a disposer, which this plugin owns and keeps
 * for as long as the id stays declared. Dropping a declaration (disable, or a
 * plugin unload) unmounts the preset's rows and leaves the installed bytes
 * untouched.
 * @module @linxin666/dsh-client-ui-preset-center/host/declarations
 */

import type { AgentPresetRegistry, PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

/** The registry surface this plugin drives; injectable for tests. */
export type PresetRegistry = Pick<AgentPresetRegistry, 'register' | 'list' | 'defaultId'>

/** Why a declaration was refused. */
export type DeclarationFailure = 'unavailable' | 'shadowed' | 'invalid'

/** A refused declaration. */
export class DeclarationError extends Error {
  readonly code: DeclarationFailure
  constructor(code: DeclarationFailure, message: string) {
    super(message)
    this.code = code
    this.name = 'DeclarationError'
  }
}

/** The registry's own refusal for an id another declaration already owns. */
const DUPLICATE_RE = /duplicate agent preset/i

/** Registry declarations held by this plugin, keyed by preset id. */
export class PresetDeclarations {
  private readonly live = new Map<string, () => Promise<void>>()
  private readonly registry: () => PresetRegistry | undefined

  /**
   * @param registry - resolver for the `agentPresets` service; undefined when
   *   the deployment supplies no preset registry.
   */
  constructor(registry: () => PresetRegistry | undefined) {
    this.registry = registry
  }

  /** Ids this plugin currently declares. */
  declared(): ReadonlySet<string> {
    return new Set(this.live.keys())
  }

  /** Whether this plugin currently declares `id`. */
  has(id: string): boolean {
    return this.live.has(id)
  }

  /**
   * Register one preset and keep its disposer. Declaring an already-declared
   * id is a no-op, so a repeated install does not restart the mounted rows.
   * @param definition - the definition read from the installed bytes.
   * @throws {DeclarationError} unavailable, shadowed, or invalid.
   */
  async declare(definition: PresetDefinition): Promise<void> {
    const registry = this.registry()
    if (registry === undefined) {
      throw new DeclarationError('unavailable', 'the agent-preset registry is unavailable')
    }
    if (this.live.has(definition.id)) return
    let dispose: () => Promise<void>
    try {
      dispose = await registry.register(definition)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new DeclarationError(DUPLICATE_RE.test(message) ? 'shadowed' : 'invalid', message)
    }
    this.live.set(definition.id, dispose)
  }

  /**
   * Drop one declaration; the installed bytes stay in place.
   * @param id - preset id.
   * @returns whether a declaration was dropped.
   */
  async undeclare(id: string): Promise<boolean> {
    const dispose = this.live.get(id)
    if (dispose === undefined) return false
    this.live.delete(id)
    await dispose()
    return true
  }

  /** Drop every declaration (plugin unload); failures never mask the rest. */
  async release(): Promise<void> {
    const all = [...this.live.values()]
    this.live.clear()
    for (const dispose of all) {
      try {
        await dispose()
      } catch {
        /* a registry already gone is not this plugin's failure */
      }
    }
  }
}
