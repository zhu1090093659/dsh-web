/**
 * Browser half of the describe-image plugin: no composer chrome of its own.
 * The shell's input box has no image entry for text-only models, so image
 * sends are rewritten at submit time (installSendHook) into describe-image
 * references before they reach the model — the way a text-only model gets an
 * image to analyze without the shell's vision pipeline. Sessions whose model
 * accepts image input skip the rewrite entirely (createImageCapabilityChecker
 * asks the host): the raw image blocks reach the model's own vision and no
 * describe_image round-trip is needed. The shell renders
 * user messages as plain text, so a sent reference is then upgraded in place
 * into an inline thumbnail (installConversationImagePreview) unless the
 * deployment turns previews off. The settings card is rendered by the web
 * GUI's built-in plugin config page from the plugin's own `Config` schema,
 * which the Host serves as this profile entry's configuration.
 *
 * Failure policy: every DOM/runtime wiring failure is logged, never thrown —
 * the web shell fails the whole boot when a plugin apply throws.
 * @module @linxin666/dsh-tool-describe-image/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { installSendHook } from './send-hook.ts'
import { createImageCapabilityChecker } from './capability.ts'
import { installConversationImagePreview, type ConversationImagePreview } from './preview.ts'
import { DescribeImageSettingsCard, DescribeImageSettingsCardController, type DescribeImageSettings } from './DescribeImageSettingsCard.tsx'
import { dictionaries, setLanguage, type DescribeImageClientKey } from './locales.ts'
import { reportDailyHeartbeat } from './telemetry.ts'
import { installPluginCard } from './plugin-card-seat.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The describe-image attach button copy. */
    'describe-image': DescribeImageClientKey
  }

  interface SlotMap {
    /**
     * One family plugin card inside the Web Plugins group. Spelled here
     * with the same shape so this package can register without depending on
     * the sibling web-ui-settings package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional family settings binder provided by dsh-web-settings (the Web
     * UI plugin group); absent when that group is not installed, so callers
     * fall back to the official `ctx.configForms` service.
     *
     * The 0.1.7 client addresses one form per active profile entry id and
     * carries no package identity, so the family binder resolves a family
     * settings namespace to the entry that owns it and hands back that entry's
     * shared form; the official service is addressed by the entry id directly.
     */
    webUiSettings?: { bind<T>(spec: DescribeImageFormSpec<T>): ConfigForm<T> }
  }
}

/**
 * Domain-owned description of one family settings namespace a card binds. The
 * 0.1.7 client keeps its own spec type private (`ConfigFormSpec` is not
 * exported), so the optional binder seat is declared structurally instead.
 */
interface DescribeImageFormSpec<T> {
  /** Settings namespace the card edits. */
  namespace: string
  /** Narrow one wire section; undefined keeps the last accepted value. */
  decode?: (section: unknown) => T | undefined
}

/**
 * Locale namespace of the browser half, and the family settings namespace its
 * card binds — the profile entry id of a standalone install of this bundle.
 */
export const NS = 'describe-image' as const
const AGGREGATE_ENTRY_ID = 'web-ui-describe-image'
const DESCRIBE_IMAGE_ENTRY_IDS: readonly string[] = [AGGREGATE_ENTRY_ID, 'ui-describe-image', NS]

function servedEntryId(forms: ConfigForms): string {
  let served: readonly string[] | undefined
  try {
    served = forms.describe().getSnapshot().view?.namespaces.map(view => view.ns)
  } catch {
    served = undefined
  }
  if (!served || served.length === 0) return NS
  return DESCRIBE_IMAGE_ENTRY_IDS.find(id => served.includes(id)) ?? NS
}

/** Required services: slots for the settings card, conversation for the send hook, the shared configuration forms and locale for the card copy. */
export const inject = ['slots', 'conversation', 'configForms', 'locale']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-tool-describe-image' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, dictionaries)
    } catch {
      return () => {}
    }
  }, 'dsh-tool-describe-image: dictionaries')
  ctx.effect(() => {
    // Mirror the shell language into the module-level dictionary switch.
    const sync = (): void => {
      const lang = document.documentElement.lang
      setLanguage(lang === 'zh' || lang.startsWith('zh-') ? 'zh' : 'en')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, 'dsh-tool-describe-image: language mirror')

  ctx.inject(['slots', 'conversation'], (scope: ClientContext) => {
    const conversation = scope.conversation
    const slots = scope.slots

    // Bound once the configuration-forms inject fires; the preview enhancer
    // reads it per scan, so an unbound form (or a missing service) keeps the
    // default.
    let settingsFormRef: ConfigForm<DescribeImageSettings> | undefined
    // The form subscription installed by the inject below; kept so dispose (or
    // a re-inject) never leaves a stale listener behind.
    let unsubscribeSettings: (() => void) | undefined

    // Text-only models reject image blocks at submit: rewrite image-bearing
    // sends into describe-image references before they reach the model. The
    // live switch (settings interceptImageSend, default on) is read per
    // send, so other vision plugins keep the raw image blocks when it is off.
    // The capability checker passes raw image blocks straight through for
    // sessions whose model accepts image input — those models see the images
    // natively and must not be detoured through describe_image.
    const capabilityChecker = createImageCapabilityChecker()
    installSendHook(conversation, () => settingsFormRef?.getSnapshot().value?.interceptImageSend !== false, capabilityChecker)

    // The shell renders user messages as plain text, so a sent reference sits
    // in the transcript as raw markdown; upgrade it in place into an inline
    // thumbnail unless the deployment turns previews off.
    let previewRef: ConversationImagePreview | undefined
    ctx.effect(() => {
      const handle = installConversationImagePreview(() => settingsFormRef?.getSnapshot().value?.renderImagePreview !== false)
      previewRef = handle
      return () => {
        previewRef = undefined
        unsubscribeSettings?.()
        unsubscribeSettings = undefined
        settingsFormRef = undefined
        handle.dispose()
      }
    }, 'dsh-tool-describe-image: conversation image preview')

    // The settings card: bound to this plugin's profile entry configuration.
    // The family binder resolves the `describe-image` namespace to the entry
    // that owns it; without the family group the namespace IS the entry id the
    // shared configuration forms are keyed by.
    ctx.inject(['configForms'], (settingsCtx: ClientContext) => {
      const binder = settingsCtx.get('webUiSettings')
      const settingsForm = binder !== undefined && typeof binder.bind === 'function'
        ? binder.bind<DescribeImageSettings>({ namespace: NS })
        : settingsCtx.configForms.get<DescribeImageSettings>(servedEntryId(settingsCtx.configForms))
      unsubscribeSettings?.()
      settingsFormRef = settingsForm
      // Live toggle: re-scan (or restore) the moment a settings save settles.
      unsubscribeSettings = settingsForm.subscribe(() => previewRef?.refresh())
      const settingsCard = new DescribeImageSettingsCardController(settingsForm)
      // Card seat: the family group's list seat, or the official
      // bundle-configuration seat when the group is not installed.
      installPluginCard(settingsCtx, {
        bundle: '@linxin666/dsh-tool-describe-image',
        id: 'describe-image',
        order: 115,
        locale: NS,
        inject: () => settingsCard.inject(),
        component: DescribeImageSettingsCard,
      })
      settingsCtx.effect(() => () => { settingsCard.dispose() }, 'describe-image: settings card')
    })
  })
}
