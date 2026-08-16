/**
 * Minimal browser-module loader for tests: the @deepseek-ai client half
 * bundles are closure factories registered through window.__ModuleLoader__
 * (the GUI module system). Under vitest there is no real loader, so this
 * setup provides a minimal one: factory(require) executes with a require
 * backed by Node resolver (Node >=22.12 can require ESM).
 */
import { createRequire } from 'node:module'

interface LoaderEntry {
  id: string
  factory: (require: (spec: string) => unknown) => unknown
}

const nodeRequire = createRequire(import.meta.url)
const modules = new Map<string, { exports: unknown }>()

function req(spec: string): unknown {
  const cached = modules.get(spec)
  if (cached) return cached.exports
  return nodeRequire(spec)
}

const loader = {
  load(entry: LoaderEntry): unknown {
    const cached = modules.get(entry.id)
    if (cached) return cached.exports
    const module = { exports: {} as unknown }
    modules.set(entry.id, module)
    module.exports = entry.factory(req) ?? module.exports
    return module.exports
  },
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__ModuleLoader__', {
    value: loader,
    configurable: true,
    writable: true,
  })
}
