import { useEffect, useRef, useState } from 'react'

import type { PetIntent } from '../../../src/core/intent.ts'
import type { PetRendererDescriptor } from '../../../src/contracts/renderer.ts'
import { PetRendererRegistry } from '../../../src/renderers/registry.ts'
import { PetRendererRuntime } from '../../../src/renderers/runtime.ts'
import type { PetRenderQuality } from '../../../src/contracts/renderer.ts'
import type { PetModelSummary } from '../shared/desktop-api.ts'
import { compatibilityIntent } from './compatibility-intent.ts'
import {
  BUILTIN_SPRITE_RENDERER_ID,
  builtinWhaleModel,
  resolveDesktopModel,
} from './model-resolver.ts'
import { spriteRendererProvider } from './renderers/sprite-provider.tsx'
import type { SpriteAnimation } from './sprite-animation.ts'

interface RendererMountProps {
  model?: PetModelSummary
  models: readonly PetModelSummary[]
  quality: PetRenderQuality
  visible: boolean
  intent?: PetIntent
  compatibilityAnimation: SpriteAnimation
  compatibilityKey?: string
  onDescriptorChange?(descriptor: PetRendererDescriptor | undefined): void
}

export function RendererMount({
  model,
  models,
  quality,
  visible,
  intent,
  compatibilityAnimation,
  compatibilityKey,
  onDescriptorChange,
}: RendererMountProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<PetRendererRuntime>()
  const modelsRef = useRef(models)
  const descriptorListenerRef = useRef(onDescriptorChange)
  const visibleRef = useRef(visible)
  const [error, setError] = useState<string>()
  modelsRef.current = models
  descriptorListenerRef.current = onDescriptorChange
  visibleRef.current = visible

  useEffect(() => {
    const element = elementRef.current
    if (element === null) return
    const registry = new PetRendererRegistry()
    const registration = registry.register(spriteRendererProvider)
    const bounds = element.getBoundingClientRect()
    const surface = {
      element,
      width: bounds.width,
      height: bounds.height,
      devicePixelRatio: window.devicePixelRatio,
    }
    const runtime = new PetRendererRuntime(registry, surface, {
      resolveModel: (modelId) => {
        const selected = modelsRef.current.find(candidate => candidate.id === modelId)
        return selected === undefined ? undefined : resolveDesktopModel(selected)
      },
      fallbackSelections: (failed) => {
        const whale = resolveDesktopModel(builtinWhaleModel(modelsRef.current))
        return failed.rendererId === BUILTIN_SPRITE_RENDERER_ID
          && failed.descriptor.id === whale.descriptor.id
          ? []
          : [{ rendererId: BUILTIN_SPRITE_RENDERER_ID, ...whale }]
      },
      onEvent: (type, event) => {
        if (type === 'error' && 'message' in event) setError(event.message)
      },
    })
    runtimeRef.current = runtime

    const resize = (): void => {
      const next = element.getBoundingClientRect()
      runtime.resize({
        width: next.width,
        height: next.height,
        devicePixelRatio: window.devicePixelRatio,
      })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const onVisibilityChange = (): void => runtime.setVisible(visibleRef.current && !document.hidden)
    document.addEventListener('visibilitychange', onVisibilityChange)
    onVisibilityChange()
    resize()

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      runtimeRef.current = undefined
      descriptorListenerRef.current?.(undefined)
      void runtime.dispose().finally(() => registration.dispose())
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime === undefined || model === undefined) return
    setError(undefined)
    void runtime.selectModel(model.id).then(() => {
      setError(undefined)
      descriptorListenerRef.current?.(runtime.descriptor)
    }, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
      descriptorListenerRef.current?.(undefined)
    })
  }, [model?.id, model?.format, model?.entry, model?.assetUrl])

  useEffect(() => {
    runtimeRef.current?.setQuality(quality)
  }, [quality])

  useEffect(() => {
    runtimeRef.current?.setVisible(visible && !document.hidden)
  }, [visible])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime === undefined) return
    const next = intent ?? compatibilityIntent(compatibilityAnimation, compatibilityKey)
    void runtime.applyIntent(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [intent?.id, intent?.speech?.id, compatibilityAnimation, compatibilityKey])

  return (
    <div className="renderer-host" aria-hidden="true">
      <div ref={elementRef} className="renderer-mount" />
      {error !== undefined && (
        <div className="renderer-error-placeholder" title={error}>!</div>
      )}
    </div>
  )
}
