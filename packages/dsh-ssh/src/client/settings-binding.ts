/**
 * Settings reader of the dsh-ssh browser half.
 *
 * The plugin's browser half owns one preference: the xterm `fontFamily` the
 * panel applies to its terminals. Under the 0.1.7 settings model that field
 * belongs to the plugin's own profile entry (its Cordis Config schema), and
 * the browser surface addresses settings as one form per profile entry id — so
 * the entry has to be resolved before its section can be read:
 *
 * - the family binder (`ctx.get('webUiSettings')`, published while
 *   dsh-web-settings is loaded) resolves the dsh-ssh namespace to its entry id
 *   through the Host bridge and hands back the native shared form;
 * - without that group the shared configuration forms serve the form directly,
 *   and the entry is recognised by the one field this plugin's own schema
 *   declares: the entry whose resolved section carries `terminalFontFamily`.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigFormSnapshot, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Domain-owned description of one settings namespace a family surface binds. */
export interface ConfigFormSpec<T> {
  /** Settings namespace the surface edits. */
  namespace: string
  /**
   * Narrow one wire section; undefined keeps the section the Host resolved.
   * The shared form already validates against the namespace's serialized
   * schema, so a decoder exists only to narrow beyond it.
   */
  decode?: (section: unknown) => T | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional family settings binder provided by dsh-web-settings; absent when
     * that group plugin is not installed, so callers fall back to the shared
     * configuration forms service (`ctx.configForms`).
     */
    webUiSettings?: { bind<S>(spec: ConfigFormSpec<S>): ConfigForm<S> }
  }
}

/** The read face this plugin needs from its own settings entry. */
export interface SettingsReader<T> {
  /** @returns the current snapshot (stable reference until the next change). */
  getSnapshot(): ConfigFormSnapshot<T>
  /** Observe snapshot replacements. */
  subscribe(listener: () => void): () => void
}

/** A reader plus the release of every subscription it installed. */
export interface SettingsBinding<T> extends SettingsReader<T> {
  /** Release the reader's subscriptions; later calls are no-ops. */
  dispose(): void
}

/**
 * The snapshot a reader reports before the Host has answered with this
 * plugin's entry: nothing is readable yet, and no write is attempted.
 */
const PENDING_SNAPSHOT: ConfigFormSnapshot<never> = {
  status: 'loading',
  value: undefined,
  base: undefined,
  user: undefined,
  revision: undefined,
  writable: false,
  mode: 'host',
}

/** Whether one Host namespace section carries a field this plugin's schema declares. */
function carriesField(section: unknown, field: string): boolean {
  return typeof section === 'object' && section !== null && Object.hasOwn(section, field)
}

/**
 * Reader over the shared configuration forms service.
 *
 * The 0.1.7 surface carries no package identity, so this plugin recognises its
 * own entry by the field its Config schema declares. The entry list arrives
 * asynchronously with the shared describe mirror, and an id the Host has not
 * answered with yet is not evidence of absence: the reader re-resolves on every
 * mirror change and reports `loading` until it holds a form.
 */
class SharedFormsReader<T> implements SettingsReader<T> {
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribeMirror: () => void
  private unsubscribeForm: (() => void) | undefined
  private form: ConfigForm<T> | undefined
  private snapshot: ConfigFormSnapshot<T> = PENDING_SNAPSHOT as ConfigFormSnapshot<T>

  /**
   * @param forms - the shared configuration forms service (`ctx.configForms`).
   * @param field - the field this plugin's own schema declares, which is what identifies its entry.
   */
  constructor(private readonly forms: ConfigForms, private readonly field: string) {
    this.unsubscribeMirror = forms.describe().subscribe(() => {
      this.bind()
      this.publish()
    })
    this.bind()
  }

  getSnapshot(): ConfigFormSnapshot<T> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Release the mirror and form subscriptions and drop every listener. */
  dispose(): void {
    this.unsubscribeMirror()
    this.unsubscribeForm?.()
    this.unsubscribeForm = undefined
    this.listeners.clear()
  }

  /** Bind the entry form once the shared mirror names this plugin's entry. */
  private bind(): void {
    if (this.form !== undefined) return
    const namespaces = this.forms.describe().getSnapshot().view?.namespaces
    const entry = namespaces?.find(candidate => carriesField(candidate.value, this.field))
    if (entry === undefined) return
    const form = this.forms.get<T>(entry.ns)
    // A service that answers no form for its own served entry leaves the reader
    // unbound; it retries on the next mirror answer rather than failing a boot.
    if (form === undefined) return
    this.form = form
    this.snapshot = form.getSnapshot()
    this.unsubscribeForm = form.subscribe(() => {
      this.snapshot = form.getSnapshot()
      this.publish()
    })
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * Bind this plugin's settings reader.
 * @param ctx - client context carrying the family binder and/or the shared forms service.
 * @param namespace - the family settings namespace this plugin owns.
 * @param field - the field this plugin's own schema declares, used to recognise its entry when the family binder is absent.
 * @returns the reader and the release of its subscriptions.
 */
export function bindSettingsReader<T>(ctx: ClientContext, namespace: string, field: string): SettingsBinding<T> {
  const family = ctx.get('webUiSettings')
  if (family !== undefined) {
    const form = family.bind<T>({ namespace })
    return {
      getSnapshot: () => form.getSnapshot(),
      subscribe: listener => form.subscribe(listener),
      dispose: () => {},
    }
  }
  return new SharedFormsReader<T>(ctx.configForms, field)
}
