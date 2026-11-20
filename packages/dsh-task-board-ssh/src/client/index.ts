/**
 * Browser half of the task-board SSH provider.
 *
 * It registers the extension's copy, contributes one settings section into the
 * task board's own settings card, and installs the provider's three rendering
 * seats into the board: the task-detail section, the card badge, and the
 * new-card section of the create dialog. Both halves of the extension's own
 * switch are followed live: the seats appear and disappear with the settings
 * section's `enabled` value, while the section itself stays reachable so the
 * switch can be turned back on.
 *
 * Failure policy: a missing slot, settings surface, or board service is handled,
 * never thrown — the web shell fails the whole boot when a plugin apply throws,
 * and one external plugin must not take the GUI down.
 *
 * @module dsh-task-board-ssh/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigFormSnapshot, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the settings-surface Context merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer's Context merge (ctx.slots) and uiRenderer.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SshSettingsCardController, SshSettingsSection, type SshSettings } from './ssh/settings-section.tsx'
import { installSshClientHalf, type ExtensionEnabledSource } from './ssh/extension.ts'
import { en, setRuntimeTranslate, zh, type TaskBoardSshKey } from './locales.ts'
import { createServedEntryForm } from './settings-entry-form.ts'

/** Locale namespace this half owns. */
export const NS = 'task-board-ssh'

/** Settings namespace the section edits: this extension's family settings identity. */
export const SETTINGS_NAMESPACE = 'task-board-ssh'

/**
 * Profile entry id the family aggregate's generated row carries — the shape
 * nearly every user runs, and the id the shared-forms fallback binds when the
 * family binder cannot resolve the namespace.
 */
const AGGREGATE_ENTRY_ID = 'web-ui-task-board-ssh'

/** Profile entry ids this package's patch rows carry, most specific first. */
const ENTRY_IDS: readonly string[] = [AGGREGATE_ENTRY_ID, 'ui-task-board-ssh', 'dsh-task-board-ssh', SETTINGS_NAMESPACE]

/**
 * The family settings binder published by dsh-web-settings; absent when that
 * group plugin is not installed.
 */
interface SettingsFormBinder {
  /** Resolve this package's family namespace onto the row the Host serves. */
  bind<T>(spec: { namespace: string }): ConfigForm<T>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Provider task-detail section; the board declares and renders it. */
    'task-board.detail.section': { kind: 'list'; scope: 'root'; owner: import('./seat-props.ts').SshDetailSectionProps }
    /** Provider settings section; the board declares and renders it. */
    'task-board.settings.section': { kind: 'list'; scope: 'root'; owner: import('./seat-props.ts').SshSettingsSectionProps }
    /** Provider card decoration; the board declares and renders it. */
    'task-board.card.decoration': { kind: 'list'; scope: 'root'; owner: import('./seat-props.ts').SshCardDecorationProps }
    /** Provider new-card section; the board renders it inside the create dialog's execution settings. */
    'task-board.compose.section': { kind: 'list'; scope: 'root'; owner: import('./seat-props.ts').SshComposeSectionProps }
  }

  interface LocaleNamespaceMap {
    /** The SSH provider extension copy. */
    'task-board-ssh': TaskBoardSshKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional family settings binder provided by dsh-web-settings; absent when
     * that group plugin is not installed, so callers bind the shared forms
     * service (`ctx.configForms`) by profile entry id directly.
     */
    webUiSettings?: SettingsFormBinder
  }
}

/**
 * Required client services: the slot registry, the locale catalog, and the
 * shared configuration forms the section stages over.
 */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Bind the settings form the section stages over.
 *
 * The family binder comes first: it resolves this package's family namespace
 * onto the profile entry id the Host serves the form under. A page without that
 * group binds through the shared forms service on the entry id the describe
 * mirror justifies, rebound as soon as the mirror answers.
 * @param ctx - the browser plugin context.
 * @returns the form the settings section reads and writes.
 */
export function bindSettingsForm(ctx: ClientContext): ConfigForm<SshSettings> {
  const binder = ctx.get('webUiSettings')
  if (binder !== undefined && typeof binder.bind === 'function') {
    return binder.bind<SshSettings>({ namespace: SETTINGS_NAMESPACE })
  }
  return createServedEntryForm<SshSettings>({
    forms: ctx.configForms as ConfigForms,
    entryIds: ENTRY_IDS,
  })
}

/**
 * A form for a page that serves this namespace to nobody: it never answers, so
 * the section explains the missing namespace instead of pretending to be broken,
 * and the seats still follow the documented default (enabled).
 * @returns an inert configuration form.
 */
function unavailableForm(): ConfigForm<SshSettings> {
  const snapshot: ConfigFormSnapshot<SshSettings> = {
    status: 'unavailable',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async () => false,
    unset: async () => false,
    mutate: async () => false,
  }
}

/**
 * Mount the extension's browser half: the dictionaries, the settings section,
 * and the provider's child seats.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'task-board-ssh: dictionaries')

  // Wire the SDK translate seat into the module-level t the child seats use: it
  // reads the active locale at call time, so the seats follow a runtime language
  // switch without a reload.
  try { setRuntimeTranslate(ctx.locale.bind(NS)) } catch { /* locale missing: document-language fallback stays */ }

  let scope: ConfigForm<SshSettings>
  try {
    scope = bindSettingsForm(ctx)
  } catch {
    // No settings surface on this page: the section is unavailable, but the
    // provider's seats stay on their documented default.
    scope = unavailableForm()
  }

  // The rendering seats follow the extension's own master switch, live: the
  // settings form is the same volatile reference the Host commits an edit into.
  const enabledSource: ExtensionEnabledSource = {
    read: () => scope.getSnapshot().value?.enabled !== false,
    subscribe: listener => scope.subscribe(listener),
  }

  let controller: SshSettingsCardController | undefined
  try {
    controller = new SshSettingsCardController(scope)
  } catch {
    // A form that cannot be staged over: the extension keeps its rendering
    // seats and loses only the configuration section.
    controller = undefined
  }

  // Seats. The rendering seats (task-detail section, card decoration and the
  // create dialog's new-card section) sit behind both switches; the
  // configuration section sits behind the board service alone, because it is
  // where this extension's own switch lives — a section gated by that switch
  // could never turn it back on.
  const settingsSeat = controller === undefined
    ? undefined
    : { inject: () => controller.inject(), component: SshSettingsSection }
  ctx.effect(() => installSshClientHalf(ctx, enabledSource, settingsSeat), 'task-board-ssh: provider seats')
  if (controller !== undefined) {
    const owned = controller
    ctx.effect(() => () => { owned.dispose() }, 'task-board-ssh: provider settings section')
  }
}
