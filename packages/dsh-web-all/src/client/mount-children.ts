/**
 * Client-side mirror of the host fault-isolation shell (src/shell.ts).
 *
 * The shell folds every family patch row under this package, and the client
 * module scanner only enumerates loader entries — so the folded children's
 * client bundles never reach the browser on their own. This mount runs each
 * generated child client module (src/client/children.generated.ts, inlined
 * into this bundle at build time) as a nested client plugin with its own
 * declared injects on a child fiber: an apply or activation failure degrades
 * that child alone and never fails this bundle's fiber, mirroring the host
 * contract.
 *
 * Double-mount guards: a child whose package id appears in the browser boot
 * payload already mounts through its own loader entry (profile-level direct
 * bundle rows) and is skipped here; the global mount registry shares
 * mountOnce's symbol so two module instances of the same package (npm copy
 * vs repository link) keep one verdict. Registry entries are deliberately
 * never unmarked — inlined children live for the page lifetime, and the
 * loader reloads the page on any plugin change.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { clientChildren } from './children.generated.ts'

const MOUNTED_PLUGINS = Symbol.for('dsh-web.mounted-plugins')

interface BootEntry {
  id?: unknown
}

interface BootPayload {
  entries?: readonly BootEntry[]
}

/** Package ids the loader already serves a client bundle for. */
function ownClientEntryIds(): Set<string> {
  const boot = (globalThis as { __DSH_BOOT__?: BootPayload }).__DSH_BOOT__
  const ids = new Set<string>()
  for (const entry of boot?.entries ?? []) {
    if (typeof entry?.id === 'string') ids.add(entry.id)
  }
  return ids
}

function mountedRegistry(): Set<string> {
  const registry = globalThis as { [MOUNTED_PLUGINS]?: Set<string> }
  registry[MOUNTED_PLUGINS] ??= new Set<string>()
  return registry[MOUNTED_PLUGINS]
}

/** Mount every generated family child that has no client bundle of its own. */
export function mountClientChildren(ctx: ClientContext): void {
  const own = ownClientEntryIds()
  const registry = mountedRegistry()
  for (const child of clientChildren) {
    if (own.has(child.name)) continue
    if (registry.has(child.name)) continue
    registry.add(child.name)
    const mod = child.module as { apply?: unknown; default?: unknown; inject?: readonly string[] }
    const face = (mod.default ?? mod) as { apply?: unknown; inject?: readonly string[] }
    const apply = typeof face === 'function' ? face : face.apply
    if (typeof apply !== 'function') {
      console.error(`[dsh-web-all] client child degraded: ${child.name} has no usable apply shape`)
      continue
    }
    const definition = {
      name: child.name,
      inject: face.inject !== undefined ? [...face.inject] : [],
      apply,
    } as Parameters<ClientContext['plugin']>[0]
    try {
      // Sync application errors escape the ctx.plugin() call itself; async
      // ones settle on the returned fiber. Both paths are captured so this
      // bundle's fiber never fails (the boot audit would otherwise tear the
      // family off the page).
      const fiber = ctx.plugin(definition)
      void Promise.resolve(fiber).then(
        () => {},
        (error: unknown) => {
          console.error(`[dsh-web-all] client child degraded: ${child.name}`, error)
        },
      )
    } catch (error) {
      console.error(`[dsh-web-all] client child degraded: ${child.name}`, error)
    }
  }
}
