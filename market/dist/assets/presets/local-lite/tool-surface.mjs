/**
 * tool-surface — free the preset's context window from every global tool the
 * preset does not declare.
 *
 * This file is addressed as a PRESET-DIRECTORY file: `agent.cordis.yml` names it
 * `./tool-surface.mjs`, and the preset center resolves that relative row to an
 * absolute `file://` URL before the registry ever sees it (see
 * `src/core/definition.ts`, `absolutizeRows`). It therefore has to work as a
 * bare file with no package around it, which is why it imports nothing.
 *
 * The same preset is also distributed as an npm cordis bundle at
 * https://github.com/Xeraph627/local-lite, where this plugin is a package entry
 * point instead. The two files are behaviourally identical; only this header and
 * the `@module` tag differ.
 *
 * `ctx.tools.restrict()` masks a scope's GLOBAL tools while leaving that scope's
 * own registrations visible, which is the seam this preset needs: the mounting
 * context is the preset's standing scope, so one `deny` computed here covers
 * every agent joined under it.
 *
 * The deny list is COMPUTED, never hardcoded. A hardcoded list of globally
 * mounted tools (SSH controls, workspace dependency paths, and whatever the
 * deployment adds next) would be stale the moment the profile changes, and
 * `restrict()` THROWS on an unknown name — so a stale entry would break the
 * preset instead of quietly costing tokens. Instead:
 *
 *   deny = { names in the global view }
 *        - { names this preset registers itself }   // `ownTools` below
 *        - { reserved transport names }             // `run_code`
 *        - { keep }                                 // config escape hatch
 *        + { alsoDeny }                             // config escape hatch
 *
 * `run_code` MUST be filtered out of the deny list: when an outer scope selects
 * PTC execution, the global view carries that reserved transport name and
 * `restrict()` refuses it. Leaving the name in loses the ENTIRE mask, and the
 * retry cannot recover it — the retry drops only caller-named `alsoDeny`
 * entries, so a computed `run_code` survives into it as well. The preset itself
 * mounts no PTC executor and stays native; the guard covers an outer PTC scope.
 *
 * The filter appears twice on purpose (the loop skip and the trailing
 * `deny.delete`), and either alone is sufficient — the mutation check removes
 * both to make the failure observable. Two guards for one condition, because a
 * silently inert mask is invisible to both the model and the user: the only
 * symptom is a slightly larger request, which nothing reports.
 *
 * Every remaining failure path narrows rather than gives up: an unknown name
 * costs the caller-named `alsoDeny` entries (the call is retried without them),
 * and only a registry that cannot be read at all leaves the surface untouched. A
 * preset whose surface could not be trimmed still composes — it just pays the
 * tokens.
 *
 * Measured on the author's deployment, native presentation. The saving comes from
 * ONE matched pair of sessions — both with `web_fetch` still enabled, byte-identical
 * prompts, the same host surface — differing only in whether this row ran:
 *
 *   this row running      2,004 tokens/request  (186-token prompt + 1,818, 13 tools)
 *   this row not running  3,155 tokens/request  (same prompt + 2,969, 19 tools)
 *   difference            1,151 tokens          what the mask removed on that host
 *
 * That 1,151 is the host's six `ssh_*` controls plus
 * `load_workspace_dependencies`, and it is the only subtraction these two sessions
 * support. The preset's own standing cost is a separate figure, and the stable
 * one: 1,789 tokens per request with `web_fetch` off (190-token prompt + 1,599,
 * 11 tools). Do not subtract the pair and call the result the preset's cost, and
 * do not pair 1,151 with a per-tool total quoted elsewhere — only a difference
 * between two sessions describes a saving.
 *
 * The saving is per-host by nature: the row can only remove tools the host
 * mounted, so a plain harness — where the only inherited global is
 * `load_workspace_dependencies` — sees a far smaller one.
 *
 * @module tool-surface
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-surface'

/** The registry this row masks. */
export const inject = ['tools']

/**
 * The reserved PTC transport name. `restrict()` rejects it because it is not an
 * end-capability tool: masking it would have to be expressed as a presentation
 * change, not a restriction.
 */
export const RESERVED_TRANSPORT = 'run_code'

/**
 * Trim the preset's visible tool surface to the tools it declares.
 * @param ctx - the preset's mounting context, which owns the standing scope.
 * @param config - `keep` retains names past the preset's own; `alsoDeny` removes names regardless.
 */
export function apply(ctx, config) {
  const keep = new Set(config?.keep ?? [])
  const alsoDeny = new Set(config?.alsoDeny ?? [])

  const globalNames = readGlobalToolNames(ctx)
  if (globalNames === undefined) return

  const deny = new Set()
  for (const toolName of globalNames) {
    if (ownTools.has(toolName) || keep.has(toolName)) continue
    if (toolName === RESERVED_TRANSPORT) continue
    deny.add(toolName)
  }
  for (const toolName of alsoDeny) deny.add(toolName)
  for (const toolName of ownTools) deny.delete(toolName)
  deny.delete(RESERVED_TRANSPORT)

  if (deny.size === 0) return

  try {
    // The returned disposer is owned by the plugin's effect scope; the loader
    // releases the restriction when this preset unmounts.
    ctx.tools.restrict({ deny: [...deny].sort() })
    return
  } catch (error) {
    ctx.logger?.warn?.(`tool-surface: restrict() rejected the full deny list (${error.message})`)
  }

  // The registry rejected the filter. Retry once without the entries the caller
  // named explicitly, so one bad `alsoDeny` cannot cost the whole mask. This does
  // NOT rescue a computed reserved name: the retry keeps everything computed,
  // which is why the `run_code` filter above is load-bearing rather than a
  // belt-and-braces extra.
  const narrowed = [...deny].filter((toolName) => !alsoDeny.has(toolName)).sort()
  if (narrowed.length === 0) return
  try {
    ctx.tools.restrict({ deny: narrowed })
  } catch (error) {
    ctx.logger?.warn?.(
      `tool-surface: could not trim the global tool view (${error.message}); the preset composed with its full inherited surface`,
    )
  }
}

/**
 * Every tool name the preset registers for itself, on either platform. Listing
 * both platform shells keeps the set correct without reading the current
 * platform: a name that is not registered cannot appear in the global view, so
 * an extra entry is inert while a missing one would be masked.
 *
 * `web_fetch` is deliberately ABSENT. This preset sets `fetch: false` on its
 * `tool-web` row, so it does not register `web_fetch` — and listing it here would
 * invert the preset's whole network posture on a host whose base still mounts
 * that tool globally: the name would be treated as the preset's own and left
 * unmasked, handing back exactly the model-chosen-URL capability the row turns
 * off. A name belongs in this set only while the preset really registers it.
 */
const ownTools = new Set([
  'read',
  'write',
  'edit',
  'read_image',
  'glob',
  'grep',
  'web_search',
  'bash',
  'pwsh',
  'job_output',
  'job_list',
  'job_kill',
])

/**
 * The registry's global tool names, or undefined when the view cannot be read —
 * in which case the caller trims nothing rather than masking on a guess.
 * @param ctx - the preset's mounting context.
 */
function readGlobalToolNames(ctx) {
  try {
    return ctx.tools.schemas().map((schema) => schema.name)
  } catch (error) {
    ctx.logger?.warn?.(`tool-surface: could not read the global tool view (${error.message})`)
    return undefined
  }
}
