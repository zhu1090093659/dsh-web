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
 *
 * The boot payload's entries carry client-bundle package ids only (the host
 * graphRow wire shape: id/url/rev per served bundle). Patch row ids such as
 * `web-ui-market` never appear there, so boot entries cannot express per-row
 * enable state. Row gating (#1372) instead asks the host half which family
 * rows are active (GET /api/dsh-web-all/rows, served from the shell's
 * active-row ledger): a row disabled through a user patch override never
 * applies its shell entry, so its folded client child stays unmounted and its
 * settings tabs never reach the page. The fetch is FAIL-OPEN by contract:
 * any uncertainty (network error, non-200, shape mismatch, timeout, or a
 * stale host half that predates the route) mounts every child exactly like
 * before, so a row-state outage can never take the family UI down.
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

/** Same-origin row-state route served by the host shell (src/shell.ts). */
const ROWS_ROUTE = '/api/dsh-web-all/rows'

/** Row-state fetch ceiling: a hung route must not delay the family UI. */
const ROWS_TIMEOUT_MS = 1500

/**
 * Ask the host half which family rows are active. Returns undefined on ANY
 * uncertainty — network error, non-200, shape mismatch, timeout, or a stale
 * host half without the route — so the caller fails open and mounts every
 * child (the pre-gating behavior). Only a shape-clean answer may hide a
 * child.
 */
async function fetchActiveRows(): Promise<Set<string> | undefined> {
  let response: Response
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ROWS_TIMEOUT_MS)
  try {
    response = await fetch(ROWS_ROUTE, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) return undefined
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return undefined
  }
  if (typeof body !== 'object' || body === null) return undefined
  const children = (body as { ok?: unknown; children?: unknown })
  if (children.ok !== true || !Array.isArray(children.children)) return undefined
  if (children.children.some(name => typeof name !== 'string')) return undefined
  return new Set(children.children as string[])
}

/**
 * Mount every generated family child that has no client bundle of its own and
 * whose family row is active. Never rejects: row-state uncertainty fails
 * open, and per-child failures degrade alone.
 */
export async function mountClientChildren(ctx: ClientContext): Promise<void> {
  const active = await fetchActiveRows()
  const own = ownClientEntryIds()
  const registry = mountedRegistry()
  for (const child of clientChildren) {
    if (active !== undefined && !active.has(child.name)) continue
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
