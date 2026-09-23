// @vitest-environment jsdom
/**
 * Frames2dVisualMount registration contract: the mount consumes the base idle
 * the gameplay HUD latches on the bus. That covers a renderer which mounts
 * after the HUD restored a skin from the host snapshot, and one that remounts
 * later (hidden/summoned, StrictMode double mount) — the pet must repaint the
 * selected skin instead of snapping back to the default look.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { PetDefinition } from '../../registry.ts'
import { createDragStream } from '../drag-stream.ts'
import type { GameplayBus } from '../gameplay-hud.tsx'
import { t } from '../locales.ts'
import { Frames2dVisualMount } from './Frames2dVisualMount.tsx'
import { defaultPetRendererRegistry } from './registry.ts'

function definition(): PetDefinition {
  return {
    id: 'miku',
    displayName: 'Miku',
    description: '',
    renderer: 'frames2d',
    cell: { width: 100, height: 100 },
    columns: 8,
    rows: [],
    atlasUrl: '/pet/miku/atlas.webp',
    manifestUrl: '/pet/miku/pet.json',
    tracks: {} as PetDefinition['tracks'],
    frames2d: {
      tracks: {
        idle: { frames: ['/pet/miku/idle_1.webp'], durations: [200], loop: true },
        skin: { frames: ['/pet/miku/skin_1.webp'], durations: [200], loop: true },
      },
      phases: { idle: 'idle' },
      skins: [{ id: 'skin', label: 'Skin', idleTrack: 'skin' }],
    },
  } as unknown as PetDefinition
}

function mountWith(bus: GameplayBus): { setIdleTrack: ReturnType<typeof vi.fn> } {
  const handle = { dispose: vi.fn(), setState: vi.fn(), setIdleTrack: vi.fn(), currentTrack: () => 'idle' }
  vi.spyOn(defaultPetRendererRegistry, 'mount')
    .mockReturnValue(handle as unknown as ReturnType<typeof defaultPetRendererRegistry.mount>)
  render(
    <Frames2dVisualMount
      definition={definition()}
      phase="idle"
      onPet={() => undefined}
      drag={createDragStream()}
      bus={bus}
      t={t}
    />,
  )
  return handle
}

describe('Frames2dVisualMount', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('applies the base idle the HUD latched before this mount (restored skin)', () => {
    const handle = mountWith({ idleTrack: 'skin' })
    expect(handle.setIdleTrack).toHaveBeenCalledWith('skin')
  })

  it('leaves the default look alone when no base idle is latched', () => {
    const handle = mountWith({})
    expect(handle.setIdleTrack).not.toHaveBeenCalled()
  })
})
