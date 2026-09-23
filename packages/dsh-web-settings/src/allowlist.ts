/**
 * rc.6 compatibility allowlist for the settings bridge.
 *
 * rc.6 host-apiproxy never reads settings.yaml for a namespace allowlist: its
 * WEB_SETTINGS_NAMESPACES set is hard-coded. Users configure
 * web_settings_namespaces expecting the configuration page to honor it, so
 * this package reads that key itself (host side) and maps the entries — which
 * users spell as package names like dsh-client-ui-task-board — onto the real
 * settings namespaces the plugins register (task-board and friends). When the
 * key is absent, a built-in family fallback list keeps every family plugin's
 * configuration form visible out of the box. The final allowlist is always
 * intersected with the namespaces actually registered in the host settings
 * seam, so an unknown entry can never surface a form or accept a write.
 */

/** Settings namespaces the dsh-web family plugins register. */
export const FAMILY_NAMESPACES = [
  'dsh-ssh',
  'task-board',
  'remote-web-ui',
  'pet',
  'describe-image',
  'skin-background',
  'skin-custom-theme',
  'skin-wallpaper',
  'community-plugins',
  'dsh-web-ui-market',
  'dsh-market',
  'ui-market',
  'usage',
  'doctor',
  'liangshen',
  'session-archive',
] as const

/**
 * Package names and plugin ids to their settings namespace. A null value
 * means the package owns no settings namespace (its configuration lives
 * elsewhere, e.g. localStorage), so the entry is intentionally ignored.
 */
const NAMESPACE_ALIASES: Readonly<Record<string, string | null>> = {
  'dsh-ssh': 'dsh-ssh',
  ssh: 'dsh-ssh',
  'dsh-client-ui-task-board': 'task-board',
  'dsh-task-board': 'task-board',
  'task-board': 'task-board',
  'dsh-remote-web-ui': 'remote-web-ui',
  'remote-web-ui': 'remote-web-ui',
  'dsh-pet': 'pet',
  pet: 'pet',
  'dsh-skins': 'skin-background',
  'dsh-client-ui-skin-center': 'skin-background',
  'skin-center': 'skin-background',
  'skin-background': 'skin-background',
  'skin-custom-theme': 'skin-custom-theme',
  'skin-wallpaper': 'skin-wallpaper',
  'describe-image': 'describe-image',
  'dsh-tool-describe-image': 'describe-image',
  'community-plugins': 'community-plugins',
  'dsh-community-plugins': 'community-plugins',
  'dsh-client-ui-community-plugins': 'community-plugins',
  'dsh-market': 'dsh-market',
  dshmarket: 'dsh-market',
  'dsh-client-ui-market': 'dsh-web-ui-market',
  'dsh-web-ui-market': 'dsh-web-ui-market',
  'ui-market': 'dsh-web-ui-market',
  'web-ui-market': 'dsh-web-ui-market',
  'dsh-workshop': 'dsh-web-ui-market',
  market: 'dsh-market',
  usage: 'usage',
  'dsh-usage': 'usage',
  doctor: 'doctor',
  'dsh-doctor': 'doctor',
  liangshen: 'liangshen',
  'dsh-liangshen': 'liangshen',
  'session-archive': 'session-archive',
  'dsh-session-archive': 'session-archive',
  'dsh-git-graph': null,
  'dsh-client-ui-git-graph': null,
  'dsh-web': null,
  'dsh-web-all': null,
  'dsh-client-ui-web-ui-settings': null,
}

/**
 * Resolve one user-configured allowlist entry to all matching settings namespaces.
 * Handles both the official dshmarket namespace ('dsh-market') and the family
 * aggregate namespace ('dsh-web-ui-market') interchangeably.
 *
 * An entry may also be spelled as a full npm name (the scoped package a family
 * plugin installs as, or the aggregate's `@linxin666/dsh-web-all/<x>` subplugin
 * row). Such an identity resolves through its bare package segment, because
 * the profile row is the only place a package name still appears — the
 * settings surface itself carries entry ids alone.
 */
export function resolveNamespaceEntries(entry: string): string[] {
  const direct = resolveDirectNamespaceEntries(entry)
  if (direct.length > 0) return direct
  const bare = bareIdentity(entry)
  return bare === undefined ? [] : resolveDirectNamespaceEntries(bare)
}

/** The last path segment of an scoped npm name (`@scope/pkg` and `@scope/bundle/sub`). */
function bareIdentity(entry: string): string | undefined {
  const key = entry.trim()
  if (!key.startsWith('@')) return undefined
  const slash = key.lastIndexOf('/')
  if (slash < 0 || slash === key.length - 1) return undefined
  return key.slice(slash + 1)
}

/** Resolve one allowlist entry spelled exactly as the alias table or the family list spells it. */
function resolveDirectNamespaceEntries(entry: string): string[] {
  const key = entry.trim()
  if (key === '') return []
  if (key === 'dsh-market' || key === 'market' || key === 'dsh-client-ui-market' || key === 'dsh-web-ui-market' || key === 'dshmarket') {
    return ['dsh-market', 'dsh-web-ui-market']
  }
  if (Object.hasOwn(NAMESPACE_ALIASES, key)) {
    const target = NAMESPACE_ALIASES[key]
    return target === null || target === undefined ? [] : [target]
  }
  if ((FAMILY_NAMESPACES as readonly string[]).includes(key)) return [key]
  return []
}

/**
 * Resolve one user-configured allowlist entry to a settings namespace.
 * @param entry - raw entry from the user's allowlist.
 * @returns the settings namespace, or undefined when the entry names nothing
 *   configurable (unknown name, or a package without a settings namespace).
 */
export function resolveNamespaceEntry(entry: string): string | undefined {
  return resolveNamespaceEntries(entry)[0]
}

/**
 * Compose the effective bridge allowlist.
 * @param userEntries - normalized web_settings_namespaces entries; the empty
 *   list selects the built-in family fallback list.
 * @param registered - namespaces currently registered in the host settings
 *   seam (the only namespaces a form or write can target).
 * @returns the allowlist: resolved entries intersected with the registered
 *   set, sorted for a stable wire view.
 */
export function composeAllowlist(userEntries: readonly string[], registered: readonly string[]): string[] {
  const requested = userEntries.length === 0 ? (FAMILY_NAMESPACES as readonly string[]) : userEntries
  const resolved = new Set<string>()
  for (const entry of requested) {
    for (const ns of resolveNamespaceEntries(entry)) {
      resolved.add(ns)
    }
  }
  const registeredSet = new Set(registered)
  return [...resolved].filter(ns => registeredSet.has(ns)).sort()
}

/** Strip one YAML scalar's quoting (single or double quotes). */
function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && (trimmed[0] === "'" || trimmed[0] === '"') && trimmed[trimmed.length - 1] === trimmed[0]) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/** Trim one YAML list or map item down to its entry name. */
function entryOfItem(item: string): string | undefined {
  let value = item.trim()
  if (value.startsWith('- ')) value = value.slice(2).trim()
  if (value === '') return undefined
  // Map item inside a list ("- key: value") or a bare map key: take the key.
  const colon = value.indexOf(':')
  if (colon >= 0) value = value.slice(0, colon).trim()
  const name = stripQuotes(value)
  return name === '' ? undefined : name
}

/**
 * Extract the web_settings_namespaces entries from raw settings.yaml text.
 * Accepts a block list, a block map, and an inline flow list — the shapes
 * users have actually tried. Returns the empty list when the key is absent
 * or unparseable.
 * @param text - raw settings.yaml content (the empty string is fine).
 * @returns the configured entries in document order.
 */
export function extractWebSettingsNamespaces(text: string): string[] {
  if (text.trim() === '') return []
  const inline = /(?:^|\n)\s*web_settings_namespaces\s*:\s*\[([^\]]*)\]/m.exec(text)
  if (inline !== null) {
    const entries: string[] = []
    for (const part of inline[1].split(',')) {
      const name = stripQuotes(part)
      if (name !== '') entries.push(name)
    }
    return entries
  }
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => /^\s*web_settings_namespaces\s*:\s*(?:#.*)?$/.test(line.trim()))
  if (start < 0) return []
  const entries: string[] = []
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim()
    if (trimmed === '') break
    if (trimmed.startsWith('#')) continue
    // A sequence item may sit at column 0 (YAML allows unindented list items
    // under a key); only a non-indented, non-item line starts the next
    // top-level key and ends this block.
    if (!/^\s/.test(line) && !trimmed.startsWith('-')) break
    const name = entryOfItem(trimmed)
    if (name !== undefined) entries.push(name)
  }
  return entries
}
