/**
 * Shared mounts for the settings-card specs: one writable card snapshot, the
 * props both card shells render from, a mount that tracks its roots so a spec
 * can tear them down, and an EventSource seat that records every channel a card
 * opens so a spec can speak the host's frames itself.
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  TaskBoardSettingsCard,
  type TaskBoardSettingsCardProps,
  type TaskBoardSettingsCardState,
} from '../src/client/TaskBoardSettingsCard.tsx'
import type { PluginSettingsCardProps } from '../src/client/PluginSettingsCard.tsx'
import type { CardShell } from '../src/client/settings-form.ts'
import { zh } from '../src/client/locales.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Copy lookup over the Chinese dictionary the card registers. */
export function t(key: string): string {
  return (zh as Record<string, string>)[key] ?? key
}

const roots: Root[] = []

/**
 * The host event channel a card subscribes to while it is mounted. Neither
 * Node nor jsdom serves an EventSource, and the card only listens for frames
 * here, so a seat that records its connections is enough for a spec to speak
 * the host's side of the channel.
 */
export class StubEventSource {
  onmessage: ((message: MessageEvent<string>) => void) | null = null
  /** Record the connection so a spec can deliver a frame on it. */
  constructor() { eventChannels.push(this) }
  close(): void {}
}

/** Every channel opened since the environment was set up, oldest first. */
export const eventChannels: StubEventSource[] = []

const globalWithEventSource = globalThis as { EventSource?: unknown }

/** Install the locale and event-channel seats a card needs before it mounts. */
export function setupCardEnvironment(): void {
  document.documentElement.lang = 'zh'
  globalWithEventSource.EventSource = StubEventSource
}

/** Unmount every card a spec mounted and take the seats away again. */
export function teardownCardEnvironment(): void {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
  eventChannels.length = 0
  delete globalWithEventSource.EventSource
}

/**
 * One complete, writable card snapshot with no staged edits.
 * @param runLaunchWidth - stored value of the run-launch width field.
 */
export function cardState(runLaunchWidth = ''): TaskBoardSettingsCardState {
  const field = { text: '', overridden: false, invalid: false }
  return {
    available: true,
    exposed: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    enabled: { ...field, text: 'true' },
    announceToAgent: field,
    preventIdleSleep: field,
    trustForwardedProxy: field,
    maxSubtaskDepth: field,
    sessionPollSeconds: field,
    runLaunchWidth: { ...field, text: runLaunchWidth },
    spendBudgetTokens: { ...field, text: '0' },
    cardDefaultMode: field,
    cardDefaultPermission: field,
    cardDefaultModel: field,
    cardDefaultReasoningEffort: field,
  }
}

/** The label the stand-in provider card carries (the real one is a provider section). */
export const PROVIDER_CARD_LABEL = 'Provider section'

/** Render-ready props for the card: a fixed snapshot, an inert form, and optionally the provider seat. */
export function cardProps(withProvider = false, runLaunchWidth = ''): TaskBoardSettingsCardProps {
  const state = cardState(runLaunchWidth)
  return {
    t: (key: string) => (zh as Record<string, string>)[key] ?? key,
    renderSlot: () => withProvider
      ? (
        <li data-testid="provider-seat">
          <button type="button" aria-expanded="false">{PROVIDER_CARD_LABEL}</button>
        </li>
      )
      : undefined,
    dispatch: async () => false,
    useTaskBoardSettingsCard: (select: (snapshot: TaskBoardSettingsCardState) => unknown) => select(state),
    edit: () => {},
    resetField: () => {},
    save: () => {},
    discard: () => {},
  } as unknown as TaskBoardSettingsCardProps
}

/** The chrome state a writable, unedited card shell renders from. */
const shellState: CardShell = {
  available: true,
  exposed: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

/** Marker the shell fixture renders as its body, so a spec can see a body mounted. */
export const SHELL_BODY_MARKER = 'shell-body'

/** Render-ready props for the shared card shell: a writable card that starts collapsed, with one body marker. */
export function shellProps(overrides: Partial<PluginSettingsCardProps> = {}): PluginSettingsCardProps {
  return {
    t,
    titleKey: 'settings.enabled',
    descriptionKey: 'settings.enabledCardHint',
    state: shellState,
    defaultOpen: false,
    onSave: () => {},
    onDiscard: () => {},
    children: <p data-testid={SHELL_BODY_MARKER}>{t('settings.enabledHintBrief')}</p>,
    ...overrides,
  }
}

/** Mount one element into a fresh container and return the container. */
export function mount(node: ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(node) })
  return container
}

/** Render the task-board card into a fresh container and return the container. */
export function render(props: TaskBoardSettingsCardProps): HTMLElement {
  return mount(<TaskBoardSettingsCard {...props} />)
}

/**
 * Speak one host frame on the newest event channel, as the browser does when
 * the Host pushes a change.
 * @param frame - the JSON payload the host sends.
 */
export function deliverFrame(frame: unknown): void {
  const channel = eventChannels[eventChannels.length - 1]
  if (channel === undefined) throw new Error('the card opened no event channel')
  act(() => {
    channel.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>)
  })
}

/** The disclosure headers the card renders, in document order. */
export function headers(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button[aria-expanded]'))
}

/** The hover titles an operator can reach on the card's paragraphs, in document order. */
export function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('p[title]')].map(node => node.getAttribute('title') ?? '')
}

/** The disclosure header that starts with this copy line (a card's title leads its header text). */
export function header(container: HTMLElement, label: string): HTMLButtonElement {
  const found = headers(container).find(button => button.textContent?.startsWith(label) === true)
  if (found === undefined) throw new Error(`the "${label}" disclosure header did not render`)
  return found
}
