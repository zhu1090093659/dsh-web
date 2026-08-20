/**
 * dsh-pet browser half — mounts the selected pet as a global floating
 * surface and drives it from the host's same-origin '/api/pet/*' JSON
 * endpoints: fetch the registry list once, poll the host snapshot (~2 s),
 * forward interactions, persist drag positions. The pet is host-global (no
 * session dimension), so it mounts directly onto 'document.body' via a
 * single React root rather than a session-scoped slot — on the
 * new-conversation screen no session exists, and a dock-mounted pet would
 * vanish there (issue #48). When the pet is hidden the entry becomes a
 * fixed-position summon button.
 * @module @linxin666/dsh-pet/client
 */

import type { ClientContext, ISessions, SessionId, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetInteractResult, PetStateView } from '../service.ts'
import type { PetInteraction } from '../affinity.ts'
import type { PetDefinition } from '../registry.ts'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createPetStore, type PetStoreInstance } from './pet-store.ts'
import { PetDockEntry, type PetInjected } from './PetDockEntry.tsx'
import { defaultPetRendererRegistry } from './renderers/registry.ts'
import { live2dRenderer } from './renderers/live2d.ts'
import { registerPetUiTeardown, takeoverPetUiTeardown } from './ui-teardown.ts'
import { PetSettingsSection, PetSettingsCardController, type PetSettings } from './PetSettingsCard.tsx'
import { NS, en, zh, t } from './locales.ts'

/** The host pet API as the browser sees it (same-origin JSON endpoints). */
interface PetHttpApi {
  state(): Promise<PetStateView>
  pets(): Promise<PetDefinition[]>
  interact(kind: PetInteraction): Promise<PetInteractResult>
  setVisible(visible: boolean): Promise<{ ok: true; display: PetDisplayConfig }>
  setConfig(patch: Partial<PetDisplayConfig>): Promise<{ ok: true; display: PetDisplayConfig }>
  setName(name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }>
  setPet(petId: string): Promise<{ ok: true; petId: string } | { ok: false; error: string }>
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
    throw new Error('pet ' + path + ' failed: ' + response.status)
  }
  return (await response.json()) as T
}

/** The live host API instance (always defined; failures surface per call). */
const petApi: PetHttpApi = {
  state: () => petFetch('/api/pet/state'),
  pets: () => petFetch('/api/pet/pets'),
  interact: (kind) => petFetch('/api/pet/interact', { kind }),
  setVisible: (visible) => petFetch('/api/pet/set-visible', { visible }),
  setConfig: (patch) => petFetch('/api/pet/set-config', patch),
  setName: (name) => petFetch('/api/pet/set-name', { name }),
  setPet: (petId) => petFetch('/api/pet/set-pet', { petId }),
}

/** Poll interval for the host snapshot. */
const POLL_MS = 2000

/** Settings namespace the pet settings card edits (the Host plugin registers it). */
const PET_SETTINGS_NS = 'pet'

/** Required services (sessions powers bubble-to-session navigation). */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote', 'sessions']

/** Re-exported for consumers that type against the injected face. */
export type { PetInjected, PetDockEntryProps } from './PetDockEntry.tsx'
export type { PetSpriteProps } from './PetSprite.tsx'
export type { PetUiState, PetFeedback } from './pet-store.ts'
export type { PetSettingsCardFace, PetSettingsCardState } from './PetSettingsCard.tsx'
export type { PetSettingsSectionProps } from './PetSettingsCard.tsx'
export type { PetDefinition } from '../registry.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-ui-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

/**
 * Client plugin body: register dictionaries, mount the global pet entry and
 * poll loop while the plugin is enabled, and seat the settings card as a
 * first-level settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pet: dictionaries')

  // Built-in renderers dispatch through the plugin-wide registry (pet-center
  // M3). Registration is idempotent (id wins), so re-applies stay clean.
  defaultPetRendererRegistry.register(live2dRenderer)

  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const settingsScope = binder.bind<PetSettings>({ namespace: PET_SETTINGS_NS })
  const enabled = (): boolean => {
    const snapshot = settingsScope.getSnapshot()
    return snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
  }

  // First-level settings section: one staged form over the 'pet' settings
  // namespace, registered as a top-level settings page. The controller loads
  // the petId choices from the registry endpoint itself.
  const petSettings = new PetSettingsCardController(settingsScope)
  ctx.slots.inject('settings.section', () => {
    const unregister = ctx.slots.register({
      name: 'settings.section',
      id: 'pet',
      order: 130,
      label: () => ctx.locale.bind('pet')('settings.title'),
      locale: 'pet',
      inject: () => petSettings.inject(),
    }, PetSettingsSection)
    return () => {
      petSettings.dispose()
      unregister()
    }
  })

  // The global pet entry, its store, and the poll loop live while the plugin
  // is enabled; toggling the setting off hides the pet and stops polling.
  // 'uiDead' marks a terminal teardown (takeover by a later bundle instance
  // or fiber disposal): a taken-over or disposed instance must never remount
  // from a late settings callback (issue #785).
  let disposeUi: (() => void) | undefined
  let clearUiTeardown: (() => void) | undefined
  let uiDead = false
  const killUi = (): void => {
    if (uiDead) return
    uiDead = true
    clearUiTeardown?.()
    clearUiTeardown = undefined
    disposeUi?.()
    disposeUi = undefined
  }
  const syncUi = (): void => {
    if (!uiDead && enabled() && disposeUi === undefined) {
      // ONE store instance for the whole app, owned by this apply body. The
      // pet is host-global (state/display/interactions are /api/pet/*
      // endpoints with no session dimension), so the slot system's per-session
      // store scoping would only reset the pet on session switches and leave
      // it stateless on the new-conversation screen (no session to scope by).
      const petStore: PetStoreInstance = createPetStore().create()
      const setSnapshot = petStore.actions.setSnapshot
      const setPets = petStore.actions.setPets
      const setState = petStore.actions.setState
      const setFeedback = petStore.actions.setFeedback

      // The registry list is fetched lazily with retries baked into the poll
      // cycle: until it lands, the dock entry renders nothing and every 2s
      // tick tries again. After it lands, one list feeds both the sprite and
      // the settings card's choices.
      let petsLoaded = false
      // Latest-wins guard: the 2s tick, visibility recovery, and
      // interaction-triggered refreshes can overlap; only the newest
      // response may publish, so a slow older one can never roll the
      // snapshot back.
      let stateSeq = 0
      const pollNow = (): void => {
        if (!petsLoaded) {
          petApi.pets().then((list) => {
            petsLoaded = true
            setPets(list)
          }, () => {
            // Retry on the next poll tick.
          })
        }
        const seq = stateSeq + 1
        stateSeq = seq
        petApi.state().then((snapshot) => {
          if (seq !== stateSeq) return
          setSnapshot(snapshot)
        }, () => {
          if (seq !== stateSeq) return
          setState('error', 'pet.state transport error')
        })
      }

      const disposePoll = ctx.effect(() => {
        // Poll only while the tab is visible: the host snapshot does not
        // change while the page is hidden, so a background interval would
        // only burn RPCs (browser throttling is an unreliable backstop).
        // Coming back to the tab refreshes the pet immediately instead of
        // waiting out the next 2 s cycle.
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

      // Clicking a session bubble jumps the GUI to that session. A bubble
      // can outlive its disposed session by one poll tick, and the sessions
      // service fails loud on unknown ids, so consult the live list first.
      // The pet's type program also loads the host-side dsh-session package
      // through the service types, whose Context merge declares a different
      // 'sessions' face; pin the browser runtime's outward face here.
      const sessions = ctx.sessions as unknown as ISessions
      const openSession = (sessionId: string): void => {
        const list = sessions.list.getSnapshot()
        if (list.byId[sessionId as SessionId] === undefined) return
        sessions.open(sessionId as SessionId)
      }

      const injected = (): PetInjected => ({
        store: petStore,
        ensure: pollNow,
        openSession,
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
      // React root for the page lifetime: PetSprite portals itself to body
      // when visible, and the hidden-state summon button is fixed-positioned.
      //
      // Cross-instance single-mount guard (issue #785): take over the
      // page-global slot first — the previous bundle instance's fiber may
      // still be draining during a client reload, so unmount its React root
      // and remove its container — then sweep containers left behind by
      // instances that predate the teardown registry, so this mount is the
      // page's only [data-dsh-pet-root].
      takeoverPetUiTeardown()
      for (const stale of Array.from(document.querySelectorAll('div[data-dsh-pet-root]'))) {
        stale.remove()
      }
      const container = document.createElement('div')
      container.dataset.dshPetRoot = ''
      container.dataset.dshPlugin = 'pet'
      document.body.appendChild(container)
      const petRoot = createRoot(container)
      petRoot.render(createElement(PetDockEntry, { ...injected(), t }))

      let uiGone = false
      disposeUi = () => {
        if (uiGone) return
        uiGone = true
        clearUiTeardown?.()
        clearUiTeardown = undefined
        petRoot.unmount()
        container.remove()
        disposePoll()
        disposeUi = undefined
      }
      // The slot teardown is the takeover hook a later apply body runs; it
      // marks this instance terminal so a late settings callback from the
      // still-draining instance cannot remount a second pet.
      clearUiTeardown = registerPetUiTeardown(() => {
        uiDead = true
        disposeUi?.()
      })
    } else if (!uiDead && !enabled() && disposeUi !== undefined) {
      disposeUi()
      disposeUi = undefined
    }
  }
  // The settings subscription and the pet UI lifetime follow the fiber
  // (issue #785): disposal drops the subscription and tears the UI down
  // (terminal), so a hot-reloaded or re-injected bundle never leaves the
  // previous React root, container, or poll loop behind on document.body.
  const unsubscribeSettings = settingsScope.subscribe(syncUi)
  ctx.effect(
    () => () => {
      unsubscribeSettings()
      killUi()
    },
    'pet: client lifecycle',
  )
  syncUi()
}
