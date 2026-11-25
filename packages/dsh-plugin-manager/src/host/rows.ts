/**
 * Profile patch-row editing for the gateway host half. The npm web loader
 * honors `disabled` on rows and applies the profile patch as the user layer,
 * so next-start enablement is a bare `{ id, name, disabled }` override row —
 * the same id-targeted, later-wins semantics the official desktop writer
 * uses. Editing goes through the `yaml` document round-trip, which preserves
 * comments and unrelated rows byte-for-byte in spirit; the !!js expression
 * tag keeps loader expressions literal so profiles carrying them stay
 * parseable.
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import { copyFile, rename, writeFile } from 'node:fs/promises'
import { isMap, isScalar, isSeq, parseDocument, type Document, type ScalarTag, type YAMLMap, type YAMLSeq } from 'yaml'

/**
 * Persist one patch file conservatively: a timestamped-free single backup,
 * then a tmp write and an atomic-ish rename over the target.
 * @param patchPath - absolute cordis.patch.yml path.
 * @param text - the new file text.
 */
export async function writePatchAtomic(patchPath: string, text: string): Promise<void> {
  await copyFile(patchPath, `${patchPath}.bak-plugin-manager`).catch(() => {})
  await writeFile(`${patchPath}.tmp`, text, { mode: 0o600 })
  await rename(`${patchPath}.tmp`, patchPath)
}

/** YAML `!!js` expression tag: expressions stay literal until the Loader evaluates them. */
export const JS_EXPRESSION_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: value => value,
}

/** A parsed patch file: the yaml document and its top-level sequence. */
export interface PatchDocumentView {
  readonly document: Document
  readonly root: YAMLSeq
}

/**
 * Parse a patch file, failing loud on invalid YAML and non-array roots.
 * @param text - file content.
 * @param filename - absolute cordis.patch.yml path (diagnostics only).
 * @returns the parsed document and root sequence.
 */
export function parsePatch(text: string, filename: string): PatchDocumentView {
  const document = parseDocument(text, {
    customTags: [JS_EXPRESSION_TAG],
    prettyErrors: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    const firstError = document.errors[0]
    throw new Error(`plugin-manager: cannot parse ${filename}: ${firstError?.message ?? 'invalid YAML'}`)
  }
  const root = document.contents
  if (!isSeq(root)) {
    throw new Error(`plugin-manager: ${filename} must contain a top-level YAML array`)
  }
  return { document, root }
}

/** Whether a root item is a plain map row (not an insert-list wrapper). */
function isBareRow(item: unknown): item is YAMLMap {
  return isMap(item) && !item.has('insert')
}

/** The string id of a bare row, when it carries one. */
export function bareRowId(item: unknown): string | undefined {
  if (!isBareRow(item)) return undefined
  const id = item.get('id', true)
  return isScalar(id) && typeof id.value === 'string' ? id.value : undefined
}

/** The string name of a bare row, when it carries one. */
export function bareRowName(item: unknown): string | undefined {
  if (!isBareRow(item)) return undefined
  const name = item.get('name', true)
  return isScalar(name) && typeof name.value === 'string' ? name.value : undefined
}

/**
 * The next-start enablement a bare row declares: a row is enabled unless it
 * carries an explicit `disabled: true` (mirrors the official reader). Non-row
 * items (insert wrappers, config rows) count as enabled.
 * @param item - one top-level patch item.
 * @returns whether the item leaves its entry enabled.
 */
export function bareRowEnabled(item: unknown): boolean {
  if (!isBareRow(item)) return true
  const disabled = item.get('disabled', true)
  return !(isScalar(disabled) && disabled.value === true)
}

/**
 * The enablement a bundle patch itself declares for the ids it mentions: an
 * insert entry's own `disabled` key, then later top-level bare
 * `{ id, disabled }` rows applied in file order (the loader's later-wins
 * semantics). Ids the patch never mentions stay absent, which means "this
 * layer has no opinion" — not "enabled". The aggregate package ships its
 * inactive-by-default family rows exactly this way.
 * @param patchText - the package's own bundle patch text (`[]` for none).
 * @returns declared enablement by entry id, absent when undeclared.
 */
export function rowDefaultEnabledOf(patchText: string): Map<string, boolean> {
  const defaults = new Map<string, boolean>()
  if (patchText.trim() === '' || patchText.trim() === '[]') return defaults
  try {
    const { root } = parsePatch(patchText, 'bundle patch')
    for (const item of root.items) {
      if (!isMap(item)) continue
      const insert = item.get('insert', true)
      if (isSeq(insert)) {
        for (const entry of insert.items) {
          if (!isMap(entry)) continue
          const id = entry.get('id', true)
          if (!(isScalar(id) && typeof id.value === 'string')) continue
          const disabled = entry.get('disabled', true)
          if (isScalar(disabled) && typeof disabled.value === 'boolean') defaults.set(id.value, disabled.value !== true)
        }
        continue
      }
      const id = bareRowId(item)
      if (id === undefined) continue
      const disabled = item.get('disabled', true)
      if (isScalar(disabled) && typeof disabled.value === 'boolean') defaults.set(id, disabled.value !== true)
    }
    return defaults
  } catch {
    return defaults
  }
}

/**
 * Find the bare override row for one id.
 * @param root - the top-level sequence.
 * @param id - the entry id to match.
 * @returns the row and its index, or undefined.
 */
export function findBareRow(root: YAMLSeq, id: string): { row: YAMLMap; index: number } | undefined {
  const index = root.items.findIndex(item => isBareRow(item) && bareRowId(item) === id)
  if (index === -1) return undefined
  const row = root.items[index]
  return isMap(row) ? { row, index } : undefined
}

/**
 * The ids an installed package's own bundle patch claims, read from its
 * cordis.patch.yml (each insert entry carries an id). An empty result means
 * the package is a plain plugin whose row id is its package name.
 * @param patchText - the package's own bundle patch text (`[]` for none).
 * @returns the claimed insert ids, in order.
 */
export function claimedIdsOf(patchText: string): string[] {
  const ids: string[] = []
  for (const row of insertRowsOf(patchText)) {
    if (row.id !== undefined) ids.push(row.id)
  }
  return ids
}

/** The string id of a patch entry node (a map carrying a string `id`). */
function entryIdOf(node: unknown): string | undefined {
  if (!isMap(node)) return undefined
  const id = node.get('id', true)
  return isScalar(id) && typeof id.value === 'string' ? id.value : undefined
}

/**
 * Whether a patch node is a `group: true` container, whose `config:` list
 * holds real child entries rather than composition data. The loader mounts
 * those children as entries, so their ids count as live.
 * @param node - one patch node.
 * @returns whether the node is a group entry.
 */
export function isGroupEntry(node: unknown): boolean {
  if (!isMap(node)) return false
  const group = node.get('group', true)
  return isScalar(group) && typeof group.value === 'boolean' && group.value
}

/**
 * The ids of the entries nested (recursively) under one `group: true` entry's
 * `config:` list. These are composition children: the loader mounts each as a
 * real entry, so an override their id carries is live even though no top-level
 * row names them. Only a group's `config:` list is descended — a plain config
 * value that happens to carry an `id` key (a nested `{ id, x }` item, say) is
 * data, not an entry, and is left alone. A child that is itself a group
 * recurses through its own `config:`.
 * @param config - a group entry's `config` node.
 * @param ids - the accumulator to add into.
 */
export function collectGroupEntryIds(config: unknown, ids: Set<string>): void {
  if (!isSeq(config)) return
  for (const child of config.items) {
    const id = entryIdOf(child)
    if (id !== undefined) ids.add(id)
    if (isMap(child) && isGroupEntry(child)) collectGroupEntryIds(child.get('config', true), ids)
  }
}

/**
 * Every entry id a layer declares: its top-level `- id:` rows (bare override
 * rows and config rows alike) plus the entries of its `- insert:` lists, plus —
 * recursively — the entries nested under any `group: true` entry's `config:`
 * list (the loader mounts those as entries too, so an override for one is not
 * an orphan; issue #2091). Ids nested inside a non-group row's own `config:`
 * are composition data of that entry, not layer entries, and are not declared
 * here.
 *
 * This answers "does this layer still declare that row?" without composing, so
 * it stays true in the states where a composition probe is not: a host that
 * composes mid-upgrade, or while a bundle's package is being replaced, drops
 * rows whose layers still exist.
 * @param patchText - a patch layer's text.
 * @param filename - absolute path (diagnostics only).
 * @returns the declared ids, in file order, without duplicates.
 * @throws when the layer does not parse; a caller must then treat this layer's
 * declarations as unknown rather than empty.
 */
export function declaredRowIds(patchText: string, filename: string): string[] {
  const { root } = parsePatch(patchText, filename)
  const ids: string[] = []
  const push = (value: string | undefined): void => {
    if (value === undefined || ids.includes(value)) return
    ids.push(value)
  }
  // A group entry's nested entries come before the id of the next top-level
  // row, so walk each item's children as soon as that item is emitted.
  const pushGroupChildren = (node: YAMLMap): void => {
    if (!isGroupEntry(node)) return
    const children = new Set<string>()
    collectGroupEntryIds(node.get('config', true), children)
    for (const child of children) push(child)
  }
  for (const item of root.items) {
    if (!isMap(item)) continue
    const insert = item.get('insert', true)
    if (isSeq(insert)) {
      for (const entry of insert.items) {
        if (!isMap(entry)) continue
        push(entryIdOf(entry))
        pushGroupChildren(entry)
      }
      continue
    }
    push(entryIdOf(item))
    pushGroupChildren(item)
  }
  return ids
}

/** One insert entry of a bundle patch: the claimed id and the plugin package name. */
export interface InsertRow {
  id?: string
  name?: string
  /**
   * The real plugin package the row mounts, read from the aggregate shell
   * row's config.plugin. Present on shell-wrapped family rows; the display
   * name of a child row prefers it over the per-family subpath name.
   */
  plugin?: string
}

/**
 * The insert entries of an installed package's own bundle patch, with both
 * the claimed id and the entry's own name. The name matters twice: the
 * loader imports the plugin by it (an unresolvable name is a boot failure),
 * and a bare override row whose name mismatches it is skipped by the include
 * patch semantics, so enablement rows must carry this exact name.
 * @param patchText - the package's own bundle patch text (`[]` for none).
 * @returns the insert rows, in order.
 */
export function insertRowsOf(patchText: string): InsertRow[] {
  if (patchText.trim() === '' || patchText.trim() === '[]') return []
  try {
    const { root } = parsePatch(patchText, 'bundle patch')
    const rows: InsertRow[] = []
    for (const item of root.items) {
      if (!isMap(item)) continue
      const insert = item.get('insert', true)
      if (!isSeq(insert)) continue
      for (const entry of insert.items) {
        if (!isMap(entry)) continue
        const id = entry.get('id', true)
        const name = entry.get('name', true)
        const config = entry.get('config', true)
        const plugin = isMap(config) ? config.get('plugin', true) : undefined
        rows.push({
          id: isScalar(id) && typeof id.value === 'string' ? id.value : undefined,
          name: isScalar(name) && typeof name.value === 'string' ? name.value : undefined,
          plugin: isScalar(plugin) && typeof plugin.value === 'string' ? plugin.value : undefined,
        })
      }
    }
    return rows
  } catch {
    return []
  }
}

/**
 * The inner entry of an insert-format item whose id matches, when one exists
 * (the official desktop writer manages rows in this shape).
 * @param root - the top-level sequence.
 * @param id - the entry id to match.
 * @returns the inner row, or undefined.
 */
export function findInsertRow(root: YAMLSeq, id: string): YAMLMap | undefined {
  for (const item of root.items) {
    if (!isMap(item)) continue
    const insert = item.get('insert', true)
    if (!isSeq(insert)) continue
    for (const entry of insert.items) {
      if (!isMap(entry)) continue
      const entryId = entry.get('id', true)
      if (isScalar(entryId) && entryId.value === id) return entry
    }
  }
  return undefined
}

/**
 * Persist the next-start enablement of one entry. Bare override rows are this
 * package's own shape: enabling removes the override (or writes
 * `disabled: false` when the bundle itself ships the row disabled), disabling
 * creates or updates `{ id, name, disabled: true }`. When a newer desktop tool already
 * manages the entry as an insert-format row, the inner row's `disabled` flag
 * is edited instead (the official writer's shape). The returned text
 * preserves every other row and comment.
 * @param text - current patch file text.
 * @param filename - absolute path (diagnostics only).
 * @param id - the entry id to override.
 * @param name - the display name recorded on the row.
 * @param enabled - desired next-start enablement.
 * @param baseEnabled - whether the bundle layer leaves the id enabled; a bundle
 *   that ships the row disabled needs an explicit `disabled: false` override,
 *   because removing the user row only restores "no user opinion".
 * @returns the new file text.
 */
export function setRowEnabled(text: string, filename: string, id: string, name: string, enabled: boolean, baseEnabled = true): string {
  const { document, root } = parsePatch(text, filename)
  const insertRow = findInsertRow(root, id)
  if (insertRow !== undefined) {
    insertRow.set('disabled', document.createNode(!enabled))
    return document.toString({ lineWidth: 0 }) + '\n'
  }
  let found = findBareRow(root, id)
  let effBase = baseEnabled
  if (found === undefined && name !== undefined) {
    const byName: { row: YAMLMap; index: number }[] = []
    root.items.forEach((item, index) => {
      if (!isBareRow(item) || bareRowName(item) !== name || bareRowId(item) === undefined) return
      if (isMap(item)) byName.push({ row: item, index })
    })
    if (byName.length === 1) {
      found = byName[0]
      effBase = false
    }
  }
  if (enabled) {
    if (found === undefined) {
      if (effBase) return text
      root.items.push(document.createNode({ id, name, disabled: false }))
    } else if (effBase) {
      root.items.splice(found.index, 1)
    } else {
      found.row.set('disabled', document.createNode(false))
    }
  } else {
    if (found !== undefined) {
      found.row.set('disabled', document.createNode(true))
    } else {
      root.items.push(document.createNode({ id, name, disabled: true }))
    }
  }
  return document.toString({ lineWidth: 0 }) + '\n'
}

/** The complete key set of an enablement override row this package writes. */
const OVERRIDE_ROW_KEYS: ReadonlySet<string> = new Set(['id', 'name', 'disabled'])

/**
 * The entry id of an enablement override row this package owns, when the item
 * is one: a bare row carrying a string `id`, a boolean `disabled`, and no
 * other key. Anything else is somebody else's row — a config row carrying
 * options, a row with an unknown shape, an insert wrapper — and the manager
 * never edits or removes it.
 * @param item - one top-level patch item.
 * @returns the override's entry id, or undefined when the item is not ours.
 */
export function overrideRowId(item: unknown): string | undefined {
  if (!isBareRow(item)) return undefined
  const id = bareRowId(item)
  if (id === undefined) return undefined
  const disabled = item.get('disabled', true)
  if (!(isScalar(disabled) && typeof disabled.value === 'boolean')) return undefined
  for (const pair of item.items) {
    const key = pair.key
    if (!isScalar(key) || !OVERRIDE_ROW_KEYS.has(String(key.value))) return undefined
  }
  return id
}

/** The rewritten patch text and the entry ids that were dropped. */
export interface PrunedOverrides {
  /** The new file text; the original text when nothing was pruned. */
  readonly text: string
  /** The pruned entry ids, in file order. */
  readonly pruned: string[]
}

/**
 * Drop this package's own enablement overrides whose entry id the composed
 * profile no longer carries — a retired row leaves a stale override behind,
 * which the loader reports on every boot as `patch: entry "<id>" not found`.
 * The prunable set is decided by the caller from the composed entry ids: an
 * id the composition does not carry has no row left to override. Only rows
 * {@link overrideRowId} recognizes are removed, comments and every other row
 * are kept, and an already-pruned file returns its input text unchanged so the
 * caller can skip the write entirely.
 * @param text - current patch file text.
 * @param filename - absolute path (diagnostics only).
 * @param composedIds - the entry ids the composed profile carries.
 * @returns the rewritten text and the pruned ids.
 */
export function pruneOrphanRowOverrides(text: string, filename: string, composedIds: ReadonlySet<string>): PrunedOverrides {
  const { document, root } = parsePatch(text, filename)
  const pruned: string[] = []
  for (let index = root.items.length - 1; index >= 0; index -= 1) {
    const item = root.items[index]
    const id = overrideRowId(item)
    if (id === undefined || composedIds.has(id)) continue
    pruned.unshift(id)
    // A comment block above a row is the user's text, not the row's: keep it
    // on the row that follows (or at the end of the file when none does), so
    // pruning never silently deletes a written explanation.
    const comment = isMap(item) ? item.commentBefore : undefined
    root.items.splice(index, 1)
    if (comment === undefined || comment === null || comment === '') continue
    const next = root.items[index]
    if (isMap(next) || isSeq(next)) {
      next.commentBefore = appendComment(comment, next.commentBefore)
    } else {
      document.comment = appendComment(comment, document.comment)
    }
  }
  if (pruned.length === 0) return { text, pruned }
  const serialized = document.toString({ lineWidth: 0 })
  const body = serialized.endsWith('\n') ? serialized.slice(0, -1) : serialized
  return { text: `${body}${text.endsWith('\n') ? '\n' : ''}`, pruned }
}

/**
 * One node's comment block followed by another's.
 * @param first - the comment block to keep first.
 * @param second - the existing block, when there is one.
 * @returns the combined block.
 */
function appendComment(first: string, second: string | null | undefined): string {
  return second === undefined || second === null || second === '' ? first : `${first}\n${second}`
}

/** The live entry names by id, and the rows this manager repaired. */
export interface RepairedRowNames {
  /** The new file text; the original text when nothing was repaired. */
  readonly text: string
  /** The repaired rows, in file order. */
  readonly repaired: Array<{ id: string; from: string; to: string }>
}

/**
 * Point the profile's own rows at the packages that now carry those entry ids.
 *
 * The include patch semantics skip a row whose `name` does not match the name
 * of the row a bundle inserted under that id, and the skip takes the whole row
 * with it: a config row stops configuring anything and a `disabled` override
 * stops disabling anything, both without a word in the browser. A package that
 * changes its name — the aggregate's family rows moved from the
 * `@linxin666/dsh-web-all/<family>` subpath to the real package in issue
 * #1901 — therefore leaves every profile row that named it dead.
 *
 * The live names come from the installed bundles' own patch files, which is
 * where the loader takes the row it inserts, so a repaired row names exactly
 * the package the loader mounts under that id. A row whose id no bundle claims
 * is left alone: its package may still be carried by a layer this manager
 * cannot see, and a name it cannot prove is a name it must not write.
 *
 * @param text - current patch file text.
 * @param filename - absolute path (diagnostics only).
 * @param liveNames - the live entry names, by entry id.
 * @returns the rewritten text and the repaired rows.
 */
export function repairStaleRowNames(text: string, filename: string, liveNames: ReadonlyMap<string, string>): RepairedRowNames {
  const { document, root } = parsePatch(text, filename)
  const repaired: Array<{ id: string; from: string; to: string }> = []
  for (const item of root.items) {
    if (!isBareRow(item)) continue
    const id = bareRowId(item)
    const from = bareRowName(item)
    if (id === undefined || from === undefined) continue
    const to = liveNames.get(id)
    if (to === undefined || to === from) continue
    item.set('name', document.createNode(to))
    repaired.push({ id, from, to })
  }
  if (repaired.length === 0) return { text, repaired }
  const serialized = document.toString({ lineWidth: 0 })
  const body = serialized.endsWith('\n') ? serialized.slice(0, -1) : serialized
  return { text: `${body}${text.endsWith('\n') ? '\n' : ''}`, repaired }
}
