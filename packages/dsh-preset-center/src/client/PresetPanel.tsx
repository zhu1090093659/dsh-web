/**
 * The Workshop's Presets panel: browse the community preset catalog and drive
 * the host library (install into `$DSH_HOME/agent-presets/<id>` and declare it
 * to the agent-preset registry, disable, uninstall), with the composition
 * profile shown before anything executable is declared.
 *
 * The panel owns no catalog fetch: the Workshop card already fetches
 * `manifest/presets.json` and passes the records down, so one store section
 * makes one catalog request. Preset state comes from the preset-center host
 * routes, which derive it from disk and the live declarations on every read.
 * @module @linxin666/dsh-client-ui-preset-center/client/PresetPanel
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, type PresetCenterKey } from './locales.ts'
import css from './preset-center.module.css'

/** One catalog record the Workshop card fetched from `manifest/presets.json`. */
export interface WorkshopPresetRecord {
  /** Preset id (the directory name). */
  id: string
  /** Display name (Chinese, matching the store convention). */
  name?: string
  /** English display name. */
  nameEn?: string
  /** Catalog author. */
  author?: string
  /** Chinese description. */
  description?: string
  /** English description. */
  descriptionEn?: string
  /** Catalog version used for update notifications. */
  version?: string
  /** Catalog tags. */
  tags?: string[]
  /** Source repository the card links to. */
  repo?: string
  /** Catalog ordering rank. */
  rank?: number
}

/** Marker key props of the Presets panel cell (the owner supplies nothing extra). */
export interface WorkshopPanelKeyProps {
  /** Marker field: key props are intentionally empty. */
  children?: never
}

/** Owner share the Workshop card passes to the Presets panel. */
export interface WorkshopPanelOwnerProps {
  /** Catalog records, already fetched by the store card. */
  items?: readonly WorkshopPresetRecord[]
  /** Catalog fetch state. */
  catalogState?: 'loading' | 'ready' | 'error'
  /** Whether the store's loopback asset gateway answered. */
  gateway?: boolean
  /** Install-event counts by preset id. */
  installs?: Record<string, number>
  /** Download one preset into the library through the store gateway. */
  install?: (id: string, force: boolean) => Promise<{ dest: string }>
  /** Record a successful install with the market (returns the fresh count). */
  reportInstall?: (id: string) => Promise<number>
}

/** Props the renderer binds for the Presets panel. */
export type PresetPanelProps =
  PropsLocale<typeof NS>
  & WorkshopPanelOwnerProps
  & WorkshopPanelKeyProps

interface CompositionProfile {
  plugins: string[]
  relativeNames: string[]
  inlineExpressions: number
  codeFiles: string[]
  codeExecution: 'none' | 'inline' | 'local'
  rows: number
}

export interface PresetStateRow {
  id: string
  installed: boolean
  /** This plugin currently holds a registry declaration for the id. */
  enabled: boolean
  managed: boolean
  assetVersion?: string
  installedAt?: string
  integrity: 'valid' | 'modified' | 'missing' | 'none'
  dir: string
  profile: CompositionProfile
}

interface StateResponse {
  ok?: boolean
  defaultId?: string | null
  occupied?: string[]
  rosterAvailable?: boolean
  presets?: PresetStateRow[]
}

const EMPTY_PROFILE: CompositionProfile = {
  plugins: [], relativeNames: [], inlineExpressions: 0, codeFiles: [], codeExecution: 'none', rows: 0,
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

interface PostResult {
  status: number
  data: { ok?: boolean; error?: string; message?: string; profile?: CompositionProfile; state?: PresetStateRow }
}

async function postJson(url: string, body: unknown): Promise<PostResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as PostResult['data']
  return { status: res.status, data }
}

interface SemverParts {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export function parseSemver(value: string): SemverParts | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa === undefined && pb === undefined) return 0
  if (pa === undefined) return -1
  if (pb === undefined) return 1
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0
  if (pa.prerelease.length === 0) return 1
  if (pb.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(pa.prerelease.length, pb.prerelease.length); index++) {
    const ra = pa.prerelease[index]
    const rb = pb.prerelease[index]
    if (ra === undefined) return -1
    if (rb === undefined) return 1
    if (ra === rb) continue
    const numericA = /^\d+$/.test(ra)
    const numericB = /^\d+$/.test(rb)
    if (numericA && numericB) return Number(ra) < Number(rb) ? -1 : 1
    if (numericA) return -1
    if (numericB) return 1
    return ra < rb ? -1 : 1
  }
  return 0
}

/** Whether the catalog advertises a version newer than the installed one. */
export function hasUpdate(record: WorkshopPresetRecord, row: PresetStateRow | undefined): boolean {
  if (row === undefined || !row.installed) return false
  if (record.version === undefined || row.assetVersion === undefined) return false
  return compareVersions(record.version, row.assetVersion) > 0
}

/** Render the Presets panel. */
export function PresetPanel(props: PresetPanelProps): ReactNode {
  const { t } = props
  const [state, setState] = useState<StateResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [viewer, setViewer] = useState<{ id: string; text: string; truncated: boolean } | null>(null)
  const [confirmInstall, setConfirmInstall] = useState<{ id: string; name: string; profile: CompositionProfile } | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<{ id: string; name: string } | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setLoadError(null)
    void fetchJson('/api/preset-center/state').then((raw) => {
      if (!alive) return
      setState(raw as StateResponse)
    }).catch((reason: unknown) => {
      if (!alive) return
      setState(null)
      setLoadError(messageOf(reason))
    })
    return () => { alive = false }
  }, [reload])

  const rows = props.items ?? []
  const stateById = new Map<string, PresetStateRow>((state?.presets ?? []).map((row) => [row.id, row]))
  const occupied = new Set(state?.occupied ?? [])
  const gateway = props.gateway === true && state !== null
  const busyNow = busy !== null

  const note = (id: string, text: string): void => {
    setNotes((prev) => ({ ...prev, [id]: text }))
    window.setTimeout(() => {
      setNotes((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }, 4000)
  }

  const refresh = (): void => { setReload((value) => value + 1) }

  const run = async (id: string, label: string, work: () => Promise<void>): Promise<void> => {
    if (busyNow) return
    setBusy(id)
    try {
      await work()
    } catch (reason) {
      note(id, t('note.actionFailed', { reason: messageOf(reason) }))
    } finally {
      setBusy(null)
    }
  }

  /** Declare one installed preset, asking for confirmation when it carries code. */
  const declareNow = async (record: WorkshopPresetRecord, confirm: boolean, success: PresetCenterKey): Promise<void> => {
    const res = await postJson('/api/preset-center/install', { id: record.id, confirm })
    if (res.data.ok === true) {
      setConfirmInstall(null)
      note(record.id, t(success, {}))
      refresh()
      return
    }
    if (res.data.error === 'confirmation-required') {
      setConfirmInstall({ id: record.id, name: displayName(record), profile: res.data.profile ?? EMPTY_PROFILE })
      return
    }
    if (res.data.error === 'broken' || res.data.error === 'invalid-composition') {
      note(record.id, t('note.broken', { reason: res.data.message ?? '' }))
      refresh()
      return
    }
    if (res.data.error === 'shadowed') {
      note(record.id, t('note.shadowed', {}))
      refresh()
      return
    }
    if (res.data.error === 'roster-unavailable') {
      note(record.id, t('note.rosterUnavailable', {}))
      return
    }
    note(record.id, t('note.actionFailed', { reason: res.data.message ?? res.data.error ?? 'HTTP ' + res.status }))
  }

  const install = (record: WorkshopPresetRecord, force: boolean): Promise<void> => run(record.id, 'install', async () => {
    if (props.install === undefined) return
    try {
      await props.install(record.id, force)
    } catch (reason) {
      const code = (reason as { code?: string }).code
      if (code === 'conflict') {
        note(record.id, t('note.conflict', {}))
        return
      }
      note(record.id, t('note.installFailed', { reason: messageOf(reason) }))
      return
    }
    void props.reportInstall?.(record.id).catch(() => { /* non-fatal */ })
    refresh()
    // A download lands inert; the declaration is what makes it live, and the
    // confirmation gate is what protects that step.
    await declareNow(record, false, force ? 'note.updated' : 'note.enabled')
  })

  const update = (record: WorkshopPresetRecord, row: PresetStateRow): Promise<void> => run(record.id, 'update', async () => {
    if (props.install === undefined) return
    const wasEnabled = row.enabled
    if (wasEnabled) {
      const off = await postJson('/api/preset-center/disable', { id: record.id })
      if (off.data.ok !== true) {
        note(record.id, t('note.actionFailed', { reason: off.data.message ?? off.data.error ?? 'HTTP ' + off.status }))
        return
      }
    }
    try {
      await props.install(record.id, true)
    } catch (reason) {
      note(record.id, t('note.installFailed', { reason: messageOf(reason) }))
      refresh()
      return
    }
    void props.reportInstall?.(record.id).catch(() => { /* non-fatal */ })
    if (wasEnabled) {
      // Already consented before the update; re-declaring the replaced bytes
      // must not silently lose the declaration the user asked for.
      await declareNow(record, true, 'note.updated')
      return
    }
    note(record.id, t('note.updated', {}))
    refresh()
  })

  const enable = (record: WorkshopPresetRecord, confirm: boolean): Promise<void> => run(record.id, 'enable', async () => {
    await declareNow(record, confirm, 'note.enabled')
  })

  const disable = (record: WorkshopPresetRecord): Promise<void> => run(record.id, 'disable', async () => {
    const res = await postJson('/api/preset-center/disable', { id: record.id })
    if (res.data.ok === true) {
      note(record.id, t('note.disabled', {}))
      refresh()
      return
    }
    if (res.data.error === 'default-preset') {
      note(record.id, t('note.defaultPreset', {}))
      return
    }
    note(record.id, t('note.actionFailed', { reason: res.data.message ?? res.data.error ?? 'HTTP ' + res.status }))
  })

  const uninstall = (record: WorkshopPresetRecord): Promise<void> => run(record.id, 'uninstall', async () => {
    const res = await postJson('/api/preset-center/uninstall', { id: record.id })
    setConfirmUninstall(null)
    if (res.data.ok === true) {
      note(record.id, t('note.uninstalled', {}))
      refresh()
      return
    }
    if (res.data.error === 'default-preset') {
      note(record.id, t('note.defaultPreset', {}))
      return
    }
    note(record.id, t('note.actionFailed', { reason: res.data.message ?? res.data.error ?? 'HTTP ' + res.status }))
  })

  const view = (record: WorkshopPresetRecord): Promise<void> => run(record.id, 'view', async () => {
    const raw = await fetchJson('/api/preset-center/composition?id=' + encodeURIComponent(record.id)) as { text?: string; truncated?: boolean }
    setViewer({ id: record.id, text: raw.text ?? '', truncated: raw.truncated === true })
  })

  function displayName(record: WorkshopPresetRecord): string {
    return record.name ?? record.nameEn ?? record.id
  }

  const matches = (record: WorkshopPresetRecord): boolean => {
    if (query === '') return true
    const q = query.toLowerCase()
    const hay = [record.name, record.nameEn, record.author, record.description, record.descriptionEn, ...(record.tags ?? [])]
      .filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  }

  const visible = rows
    .filter(matches)
    .slice()
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || displayName(a).localeCompare(displayName(b)))

  const codeBadgeKey = (profile: CompositionProfile): PresetCenterKey =>
    profile.codeExecution === 'local' ? 'code.local' : profile.codeExecution === 'inline' ? 'code.inline' : 'code.none'

  const statusOf = (record: WorkshopPresetRecord, row: PresetStateRow | undefined): { key: PresetCenterKey; tone: string } => {
    if (occupied.has(record.id)) return { key: 'state.shadowed', tone: css.badgeWarn }
    if (row === undefined) return { key: 'state.notInstalled', tone: css.badgeMuted }
    if (!row.managed) return { key: 'state.local', tone: css.badgeWarn }
    if (row.integrity === 'modified') return { key: 'state.modified', tone: css.badgeWarn }
    if (row.enabled) return { key: 'state.enabled', tone: css.badgeOn }
    return { key: 'state.installed', tone: css.badgeOff }
  }

  return (
    <div className={css.panel} data-dsh-plugin="preset-center" data-dsh-part="preset-panel">
      {props.gateway !== true ? <p className={css.note}>{t('note.remoteInstall', {})}</p> : null}
      {state === null && loadError !== null ? (
        <p className={css.note} role="status">
          {gateway ? t('note.loadFailed', { reason: loadError }) : t('note.gatewayUnavailable', {})}
          <Button className={css.inlineButton} onClick={refresh}>{t('action.refresh')}</Button>
        </p>
      ) : null}
      <input
        className={css.search}
        type="search"
        aria-label={t('search.placeholder')}
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      {props.catalogState === 'loading' ? (
        <p className={css.empty} role="status">{t('installing', {})}</p>
      ) : visible.length === 0 ? (
        <p className={css.empty} role="status">{rows.length === 0 ? t('note.emptyCatalog', {}) : t('note.noMatch', {})}</p>
      ) : (
        <ul className={css.list}>
          {visible.map((record) => {
            const row = stateById.get(record.id)
            const status = statusOf(record, row)
            const profile = row?.profile ?? EMPTY_PROFILE
            const updateAvailable = hasUpdate(record, row)
            const busyHere = busy === record.id
            // A directory this plugin does not manage (hand-authored, or
            // installed by another tool) blocks the download: installing over
            // it would be a silent overwrite of someone else's files.
            const blockedByLocal = row !== undefined && !row.managed && row.installed
            const installable = gateway && props.install !== undefined && !occupied.has(record.id) && !blockedByLocal
            const installs = props.installs?.[record.id] ?? 0
            return (
              <li key={record.id} className={css.card}>
                <div className={css.cardHead}>
                  <span className={css.cardName} title={displayName(record)}>
                    {record.repo ? (
                      <a href={record.repo} target="_blank" rel="noreferrer">{displayName(record)}</a>
                    ) : displayName(record)}
                    {record.version ? <span className={css.version}>v{record.version}</span> : null}
                  </span>
                  <span className={css.cardMeta}>
                    {record.author ?? ''}
                    <span className={status.tone}>{t(status.key, {})}</span>
                    {updateAvailable ? <span className={css.badgeWarn}>{t('state.newVersion', { version: record.version ?? '' })}</span> : null}
                    {row?.enabled && row.integrity === 'valid' ? null : null}
                    {installs > 0 ? <span className={css.badgeMuted}>{t('count.installs', { count: String(installs) })}</span> : null}
                  </span>
                </div>
                {record.description || record.descriptionEn ? (
                  <p className={css.cardDesc}>{(record.description ?? record.descriptionEn ?? '').slice(0, 200)}</p>
                ) : null}
                {row !== undefined ? (
                  <p className={css.profile}>
                    <span className={css.badgeCode}>{t(codeBadgeKey(profile), {})}</span>
                    <span className={css.profileText}>
                      {t('code.detail', {
                        files: String(profile.codeFiles.length),
                        expressions: String(profile.inlineExpressions),
                        plugins: String(profile.plugins.length),
                      })}
                    </span>
                  </p>
                ) : null}
                <div className={css.actions}>
                  {row === undefined || !row.managed ? (
                    <Button
                      className={css.primary}
                      disabled={!installable || busyNow}
                      onClick={() => { void install(record, false) }}
                    >
                      {busyHere ? t('installing', {}) : t('action.install', {})}
                    </Button>
                  ) : null}
                  {row !== undefined && row.managed && !row.enabled ? (
                    <Button
                      className={css.primary}
                      disabled={!gateway || busyNow || occupied.has(record.id)}
                      onClick={() => { void enable(record, false) }}
                    >
                      {busyHere ? t('installing', {}) : t('action.enable', {})}
                    </Button>
                  ) : null}
                  {row !== undefined && row.managed && row.enabled ? (
                    <Button
                      className={css.secondary}
                      disabled={!gateway || busyNow}
                      onClick={() => { void disable(record) }}
                    >
                      {t('action.disable', {})}
                    </Button>
                  ) : null}
                  {row !== undefined && row.managed && (updateAvailable || row.integrity === 'modified') ? (
                    <Button
                      className={css.secondary}
                      disabled={!installable || busyNow}
                      onClick={() => { void update(record, row) }}
                    >
                      {t('action.update', {})}
                    </Button>
                  ) : null}
                  {row !== undefined && row.integrity !== 'none' ? (
                    <Button className={css.secondary} disabled={busyNow} onClick={() => { void view(record) }}>
                      {t('action.view', {})}
                    </Button>
                  ) : null}
                  {row !== undefined && row.managed ? (
                    <Button className={css.danger} disabled={busyNow} onClick={() => { setConfirmUninstall({ id: record.id, name: displayName(record) }) }}>
                      {t('action.uninstall', {})}
                    </Button>
                  ) : null}
                </div>
                {notes[record.id] ? <p className={css.note} role="status">{notes[record.id]}</p> : null}
              </li>
            )
          })}
        </ul>
      )}
      <Modal
        title={viewer ? t('viewer.title', { name: viewer.id }) : ''}
        open={viewer !== null}
        onClose={() => { setViewer(null) }}
        closeLabel={t('action.cancel', {})}
      >
        <pre className={css.viewer}>{viewer?.text === '' ? t('viewer.empty', {}) : viewer?.text}</pre>
        {viewer?.truncated ? <p className={css.note}>{t('viewer.empty', {})}</p> : null}
      </Modal>
      <Modal
        title={t('confirm.title', {})}
        open={confirmInstall !== null}
        onClose={() => { setConfirmInstall(null) }}
        closeLabel={t('action.cancel', {})}
      >
        <p>
          {t('confirm.text', {
            name: confirmInstall?.name ?? '',
            detail: t('code.detail', {
              files: String(confirmInstall?.profile.codeFiles.length ?? 0),
              expressions: String(confirmInstall?.profile.inlineExpressions ?? 0),
              plugins: String(confirmInstall?.profile.plugins.length ?? 0),
            }),
          })}
        </p>
        <div className={css.modalActions}>
          <Button className={css.primary} onClick={() => {
            const target = confirmInstall
            setConfirmInstall(null)
            const record = rows.find((entry) => entry.id === target?.id)
            if (record !== undefined) void enable(record, true)
          }}>{t('action.enable', {})}</Button>
          <Button className={css.secondary} onClick={() => { setConfirmInstall(null) }}>{t('action.cancel', {})}</Button>
        </div>
      </Modal>
      <Modal
        title={t('uninstall.title', {})}
        open={confirmUninstall !== null}
        onClose={() => { setConfirmUninstall(null) }}
        closeLabel={t('action.cancel', {})}
      >
        <p>{t('uninstall.text', { name: confirmUninstall?.name ?? '' })}</p>
        <div className={css.modalActions}>
          <Button className={css.danger} onClick={() => {
            const target = confirmUninstall
            const record = rows.find((entry) => entry.id === target?.id)
            if (record !== undefined) void uninstall(record)
            else setConfirmUninstall(null)
          }}>{t('action.uninstall', {})}</Button>
          <Button className={css.secondary} onClick={() => { setConfirmUninstall(null) }}>{t('action.cancel', {})}</Button>
        </div>
      </Modal>
    </div>
  )
}
