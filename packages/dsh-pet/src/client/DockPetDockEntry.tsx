/**
 * Dock-band fallback seat for the pet.
 *
 * Current dsh web shells declare `conversation.input.dock` (the composer dock
 * band, a list slot) instead of the legacy `conversation.input.selector.context`
 * hole this plugin was written against. The dock band renders only for an
 * active session, so on shells that carry it the pet follows the session seat
 * — an acceptable degradation until the upstream shell restores the context
 * hole. The underlying entry ignores owner props (it reads only injected
 * actions and the locale), so this wrapper is a pure props re-cast.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PetDockEntry, type PetDockEntryProps, type PetInjected } from './PetDockEntry.tsx'
import { NS } from './locales.ts'

/** Composed props of the dock-band fallback seat. */
export type DockPetDockEntryProps = PropsRuntime<'conversation.input.dock'> & PetInjected & PropsLocale<typeof NS>

/**
 * Render the pet dock from the composer dock band.
 * @param props - composed slot props (dock band seat).
 * @returns the dock entry element tree.
 */
export function DockPetDockEntry(props: DockPetDockEntryProps) {
  return <PetDockEntry {...(props as unknown as PetDockEntryProps)} />
}
