/**
 * dsh-pet browser half — mounts the whale-girl as a global floating surface
 * and drives it from the host's same-origin `/api/pet/*` JSON endpoints: poll
 * the host snapshot (~800 ms), forward interactions, persist drag positions.
 * The pet is host-global (no session dimension), so it mounts directly onto
 * `document.body` via a single React root rather than a session-scoped slot —
 * on the new-conversation screen no session exists, and a dock-mounted pet
 * would vanish there (issue #48). When the pet is hidden the entry becomes a
 * fixed-position summon button.
 * @module @linxin666/dsh-pet/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetInteractResult, PetStateView } from '../service.ts'
import type { PetInteraction } from '../affinity.ts'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createPetStore, type PetStoreInstance } from './pet-store.ts'
import { PetDockEntry, type PetInjected } from './PetDockEntry.tsx'
import { PetSettingsCard, PetSettingsCardController, type PetSettings } from './PetSettingsCard.tsx'
import { NS, en, zh, t } from './locales.ts'

/** The host pet API as the browser sees it (same-origin JSON endpoints). */
interface PetHttpApi {
  state(): Promise<PetStateView>
  interact(kind: PetInteraction): Promise<PetInteractResult>
  setVisible(visible: boolean): Promise<{ ok: true; display: PetDisplayConfig }>
  setConfig(patch: Partial<PetDisplayConfig>): Promise<{ ok: true; display: PetDisplayConfig }>
  setName(name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }>
}

/** Same-origin JSON fetch helper (GET without body, POST with JSON body). */
async function petFetch<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined
    ? {}
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
  if (!response.ok) {
    throw new Error(`pet ${path} failed: ${response.status}`)
  }
  return (await response.json()) as T
}

/** The live host API instance (always defined; failures surface per call). */
const petApi: PetHttpApi = {
  state: () => petFetch('/api/pet/state'),
  interact: (kind) => petFetch('/api/pet/interact', { kind }),
  setVisible: (visible) => petFetch('/api/pet/set-visible', { visible }),
  setConfig: (patch) => petFetch('/api/pet/set-config', patch),
  setName: (name) => petFetch('/api/pet/set-name', { name }),
}

/** Poll interval for the host snapshot. */
const POLL_MS = 800

/** Settings namespace the pet settings card edits (the Host plugin registers it). */
const PET_SETTINGS_NS = 'pet'

/** Required services. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/** Re-exported for consumers that type against the injected face. */
export type { PetInjected, PetDockEntryProps } from './PetDockEntry.tsx'
export type { PetUiState, PetFeedback } from './pet-store.ts'
export type { PetSettingsCardFace, PetSettingsCardState } from './PetSettingsCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The child slot the Web UI plugin group declares; this card registers
     * into the group instead of the top-level `settings.plugin.item` list.
     * Spelled here with the same shape so this package can register without
     * depending on the sibling UI package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the group card supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

/**
 * Client plugin body: register dictionaries, mount the global pet entry and
 * poll loop while the plugin is enabled, and seat the settings card in the
 * Web UI plugin group.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pet: dictionaries')

  const settingsScope = ctx.settingsScope.bind<PetSettings>({ namespace: PET_SETTINGS_NS })
  const enabled = (): boolean => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
  }

  // Plugin configuration card: one staged form over the `pet` settings
  // namespace, contributed to the Web UI plugin group.
  const petSettings = new PetSettingsCardController(settingsScope)
  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
    name: 'web-ui.plugin.item',
    id: 'pet-settings',
    order: 140,
    locale: NS,
    inject: () => petSettings.inject(),
  }, PetSettingsCard))

  // The global pet entry, its store, and the poll loop live while the plugin
  // is enabled; toggling the setting off hides the pet and stops polling.
  let disposeUi: (() => void) | undefined
  const syncUi = (): void => {
    if (enabled() && disposeUi === undefined) {
      // ONE store instance for the whole app, owned by this apply body. The
      // pet is host-global (state/display/interactions are /api/pet/*
      // endpoints with no session dimension), so the slot system's per-session
      // store scoping would only reset the pet on session switches and leave
      // it stateless on the new-conversation screen (no session to scope by).
      const petStore: PetStoreInstance = createPetStore().create()
      const setSnapshot = petStore.actions.setSnapshot
      const setState = petStore.actions.setState
      const setFeedback = petStore.actions.setFeedback

      const pollNow = (): void => {
        petApi.state().then((snapshot) => {
          setSnapshot(snapshot)
        }, () => {
          setState('error', 'pet.state transport error')
        })
      }

      const disposePoll = ctx.effect(() => {
        // Poll only while the tab is visible: the host snapshot does not
        // change while the page is hidden, so a background interval would
        // only burn RPCs (browser throttling is an unreliable backstop).
        // Coming back to the tab refreshes the pet immediately instead of
        // waiting out the next 800 ms cycle.
        let timer: number | undefined
        const stop = (): void => {
          if (timer !== undefined) {
            window.clearInterval(timer)
            timer = undefined
          }
        }
        const start = (): void => {
          if (timer === undefined && document.visibilityState === 'visible') {
            timer = window.setInterval(pollNow, POLL_MS)
          }
        }
        const onVisibility = (): void => {
          if (document.visibilityState === 'visible') {
            pollNow()
            start()
          } else {
            stop()
          }
        }
        start()
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          stop()
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, 'pet: poll')

      const injected = (): PetInjected => ({
        store: petStore,
        ensure: pollNow,
        pet: () => {
          petApi.interact('pet').then((result) => {
            setFeedback({
              text: result.reaction,
              kind: 'pet',
              at: Date.now(),
            })
          }, () => {
            // Ignore transport errors on interactions; the next poll resyncs.
          })
        },
        feed: () => {
          petApi.interact('feed').then((result) => {
            setFeedback({
              text: result.reaction,
              kind: 'feed',
              at: Date.now(),
            })
          }, () => {
            // Ignore transport errors on interactions; the next poll resyncs.
          })
        },
        hide: () => {
          petApi.setVisible(false).then(() => {
            pollNow()
          }, () => {
            // Ignore; next poll resyncs.
          })
        },
        summon: () => {
          petApi.setVisible(true).then(() => {
            pollNow()
          }, () => {
            // Ignore; next poll resyncs.
          })
        },
        dragEnd: (right, bottom) => {
          petApi.setConfig({ right, bottom }).then(() => {
            pollNow()
          }, () => {
            // Ignore; next poll resyncs.
          })
        },
        rename: (name) => {
          petApi.setName(name).then((result) => {
            if (result.ok) pollNow()
          }, () => {
            // Ignore; next poll resyncs.
          })
        },
        feedbackDone: () => {
          setFeedback(null)
        },
      })

      // The pet is host-global (its state/display/interactions have no session
      // dimension), and the official rc.6 shell declares no root-scoped slot
      // for a global floating surface — the dock is session-scoped, so a pet
      // mounted there would vanish on the new-conversation screen (issue #48).
      // The entry therefore mounts straight onto document.body via a single
      // React root for the page lifetime: WhalePet portals itself to body when
      // visible, and the hidden-state summon button is fixed-positioned.
      const container = document.createElement('div')
      container.dataset.dshPetRoot = ''
      document.body.appendChild(container)
      const petRoot = createRoot(container)
      petRoot.render(createElement(PetDockEntry, { ...injected(), t }))

      disposeUi = () => {
        petRoot.unmount()
        container.remove()
        disposePoll()
        disposeUi = undefined
      }
    } else if (!enabled() && disposeUi !== undefined) {
      disposeUi()
      disposeUi = undefined
    }
  }
  settingsScope.subscribe(syncUi)
  syncUi()
}
