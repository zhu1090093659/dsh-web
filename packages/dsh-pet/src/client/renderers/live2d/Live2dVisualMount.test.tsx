// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetRenderer, PetRendererContext } from '../../../contracts/renderer.ts'
import type { PetDefinition } from '../../../registry.ts'
import { defaultPetRendererRegistry } from '../registry.ts'
import type { Live2dErrorCode } from '../live2d.ts'
import { Live2dVisualMount } from './Live2dVisualMount.tsx'

const t = ((key: string) => key) as PropsLocale<'pet'>['t']
const noop = (): void => {}

function definition(id: string): PetDefinition {
  return {
    id,
    displayName: id,
    description: '',
    renderer: 'live2d',
    live2d: { modelPath: id + '.model3.json', modelUrl: '/pet/' + id + '/' + id + '.model3.json', motions: { idle: 'Idle' } },
  } as unknown as PetDefinition
}

describe('Live2dVisualMount', () => {
  afterEach(() => {
    cleanup()
    defaultPetRendererRegistry.clear()
  })

  it('clears a failed activation error when switching to another pet', () => {
    const errorSinks: ((code: Live2dErrorCode) => void)[] = []
    const disposes: ReturnType<typeof vi.fn>[] = []
    defaultPetRendererRegistry.register({
      id: 'live2d',
      apiVersion: 'test',
      validateConfig: (config) => config,
      mount: (ctx: PetRendererContext) => {
        const canvas = document.createElement('canvas')
        ctx.container.appendChild(canvas)
        const dispose = vi.fn(() => { canvas.remove() })
        disposes.push(dispose)
        return {
          dispose,
          tap: () => {},
          onError: (listener: (code: Live2dErrorCode) => void) => { errorSinks.push(listener) },
        }
      },
    } as PetRenderer)

    const first = definition('broken')
    const second = definition('healthy')
    const { container, rerender, unmount } = render(<Live2dVisualMount definition={first} phase="idle" onPet={noop} t={t} />)
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    act(() => { errorSinks[0]?.('load-failed') })
    expect(container.querySelector('[data-dsh-pet-live2d-error="load-failed"]')).toBeTruthy()

    rerender(<Live2dVisualMount definition={second} phase="idle" onPet={noop} t={t} />)
    expect(disposes[0]).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-dsh-pet-live2d="healthy"]')).toBeTruthy()
    expect(container.querySelector('[data-dsh-pet-live2d-error]')).toBeNull()
    expect(container.querySelectorAll('canvas')).toHaveLength(1)

    rerender(<Live2dVisualMount definition={first} phase="idle" onPet={noop} t={t} />)
    expect(disposes[1]).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-dsh-pet-live2d="broken"]')).toBeTruthy()
    expect(container.querySelector('[data-dsh-pet-live2d-error]')).toBeNull()
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    unmount()
    expect(disposes[2]).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('canvas')).toHaveLength(0)
  })
})
