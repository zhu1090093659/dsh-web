/**
 * The market card: a first-level settings section that browses
 * dsh-market.com (skins / pets / community plugins), ranks entries by
 * device-backed likes, and offers one-click install — assets land in the
 * DSH home directories through the host gateway, plugins go through the
 * optional pluginManager service (with the copy-command degradation).
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { marketTurnstileToken } from './turnstile.ts'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import {
  getPluginManagerSnapshot,
  subscribePluginManager,
  type InstalledPluginItem,
  type PluginManagerService,
} from './plugin-manager-bridge.ts'
import { entryInstalled, installCommand, installSpec, isInstallSpecValid } from './install-source.ts'
import type { MarketKey } from './locales.ts'
import css from './market.module.css'

const MARKET_ORIGIN = 'https://dsh-market.com'

/** The settings fields this card edits (the namespace's full schema). */
export interface MarketSettings {
  /** Master switch for the market card. */
  enabled?: boolean
}

/** What the market card renders. */
export interface MarketCardState extends CardShell {
  enabled: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface MarketCardFace extends CardActions {
  hooks: {
    marketCard: SnapshotStore<MarketCardState>
  }
}

/** Bridges the market scope onto the card's staged form. */
export class MarketCardController {
  private readonly form: CardForm<MarketSettings>
  private readonly store: SnapshotStore<MarketCardState>

  /** @param scope - the bound settings scope for the dsh-web-ui-market namespace. */
  constructor(scope: SettingsScope<MarketSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): MarketCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
    }
  }

  /** Build the face the card's slot registration injects. */
  inject(): MarketCardFace {
    return { hooks: { marketCard: this.store }, ...this.form.actions() }
  }

  /** Release the scope subscription; the slot disposer calls this on teardown. */
  dispose(): void {
    this.form.dispose()
  }
}

type Kind = 'skin' | 'pet' | 'plugin'

interface MarketRecord {
  id: string
  name?: string
  nameEn?: string
  displayName?: string
  author?: string
  description?: string
  descriptionEn?: string
  rank?: number
  version?: string
  preview?: { light?: string; dark?: string }
  spritesheet?: string
  previews?: string[]
  category?: string
  npm?: string
  repo?: string
  tags?: string[]
}

interface MarketStats {
  skin: Record<string, number>
  pet: Record<string, number>
  plugin: Record<string, number>
}

interface MarketData {
  items: Record<Kind, MarketRecord[]>
  stats: MarketStats
}

const KIND_LABEL: Record<Kind, MarketKey> = {
  skin: 'tab.skin',
  pet: 'tab.pet',
  plugin: 'tab.plugin',
}

function deviceFp(): string {
  const key = 'dsh-market-web-fp'
  let fp = ''
  try {
    fp = window.localStorage.getItem(key) || ''
  } catch {
    /* storage unavailable (private mode, sandboxed): use an ephemeral fingerprint */
  }
  if (!fp || !/^[A-Za-z0-9_-]{16,64}$/.test(fp)) {
    fp = window.crypto.randomUUID ? window.crypto.randomUUID() : 'fp-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
    try {
      window.localStorage.setItem(key, fp)
    } catch {
      /* ephemeral for this tab */
    }
  }
  return fp
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

/** Props the renderer binds for the market card. */
export type MarketCardProps =
  PropsLocale<'dsh-web-ui-market'>
  & InjectFace<MarketCardFace>
  & {
    /** Remote data override (injected for tests). */
    remote?: MarketData | null
    /** Host gateway override; null forces the degraded copy-only UI (injected for tests). */
    gateway?: {
      install(kind: Kind, id: string, force: boolean): Promise<{ dest: string }>
      list(): Promise<{ skins: string[]; pets: string[] }>
    } | null
    /** Plugin-manager face override; undefined reads the bridged cordis service. */
    pluginManager?: PluginManagerService | null
    /** Turnstile token override (injected for tests). */
    turnstileToken?: () => Promise<string>
  }

/**
 * Render the market card.
 */
export function MarketCard(props: MarketCardProps): ReactNode {
  const { t } = props
  const state = props.useMarketCard((snapshot) => snapshot)
  const disabled = !state.writable
  const cardVisible = state.enabled.text !== 'false'
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }

  const [tab, setTab] = useState<Kind>('skin')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<MarketData | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [installed, setInstalled] = useState<{ skins: string[]; pets: string[] }>({ skins: [], pets: [] })
  const [installing, setInstalling] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ kind: Kind; id: string; dest: string } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [callouts, setCallouts] = useState<Record<string, string>>({})
  const [pluginList, setPluginList] = useState<readonly InstalledPluginItem[] | null>(null)
  const [pluginErrors, setPluginErrors] = useState<Record<string, string>>({})
  const likeSeq = useRef(new Map<string, number>())

  // Remote data (test override or the live market site).
  useEffect(() => {
    if (props.remote !== undefined) {
      setData(props.remote)
      setFailed(false)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void Promise.all([
      fetchJson(MARKET_ORIGIN + '/manifest/skins.json'),
      fetchJson(MARKET_ORIGIN + '/manifest/pets.json'),
      fetchJson(MARKET_ORIGIN + '/manifest/plugins.json'),
      fetchJson(MARKET_ORIGIN + '/api/stats'),
    ]).then(([skins, pets, plugins, stats]) => {
      if (!alive) return
      const s = (stats ?? { skin: {}, pet: {}, plugin: {} }) as MarketStats
      setData({
        items: {
          skin: ((skins as { items: MarketRecord[] }).items) ?? [],
          pet: ((pets as { items: MarketRecord[] }).items) ?? [],
          plugin: ((plugins as { items: MarketRecord[] }).items) ?? [],
        },
        stats: { skin: s.skin ?? {}, pet: s.pet ?? {}, plugin: s.plugin ?? {} },
      })
      setFailed(false)
      setLoading(false)
    }).catch(() => {
      if (!alive) return
      setFailed(true)
      setLoading(false)
    })
    return () => { alive = false }
  }, [props.remote, loadAttempt])

  // Host gateway probe: POST install routes + GET installed snapshot. When
  // the loopback gateway answers, asset install buttons become available;
  // otherwise the card degrades to copy-only with the market-site link.
  interface AssetGateway {
    install(kind: Kind, id: string, force: boolean): Promise<{ dest: string }>
    list(): Promise<{ skins: string[]; pets: string[] }>
  }
  const [liveGateway, setLiveGateway] = useState<AssetGateway | null | undefined>(undefined)
  useEffect(() => {
    if (props.gateway !== undefined) return
    let alive = true
    const gatewayClient: AssetGateway = {
      async install(kind, id, force) {
        const res = await fetch('/api/market/install-' + (kind === 'skin' ? 'skin' : 'pet'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, force }),
        })
        const data = await res.json().catch(() => ({})) as { ok?: boolean; dest?: string; error?: string; message?: string }
        if (!res.ok || data.ok !== true) {
          const errMsg = data.message ?? data.error ?? ('HTTP ' + res.status)
          const err = new Error(errMsg) as Error & { code?: string; dest?: string }
          err.code = data.error ?? 'write'
          err.dest = data.dest
          throw err
        }
        return { dest: data.dest ?? id }
      },
      async list() {
        const raw = await fetchJson('/api/market/installed')
        const r = raw as { skins: string[]; pets: string[] }
        return { skins: r.skins ?? [], pets: r.pets ?? [] }
      },
    }
    void gatewayClient.list().then((list) => {
      if (!alive) return
      setInstalled(list)
      setLiveGateway(gatewayClient)
    }).catch(() => { if (alive) setLiveGateway(null) })
    return () => { alive = false }
  }, [props.gateway])
  const gateway = props.gateway !== undefined ? props.gateway : (liveGateway ?? null)

  // Plugin-manager face (optional) for the plugins tab.
  const bridge = useSyncExternalStore(subscribePluginManager, getPluginManagerSnapshot)
  const face = props.pluginManager !== undefined ? props.pluginManager : bridge.face
  const faceLoopback = face !== null && face.isLoopback
  useEffect(() => {
    if (face === null || !face.isLoopback) {
      setPluginList(null)
      return
    }
    let alive = true
    const refresh = (): void => {
      void face.list().then((list) => { if (alive) setPluginList(list) }, () => { /* transient */ })
    }
    refresh()
    const unsubscribe = face.onChange(refresh)
    return () => { alive = false; unsubscribe() }
  }, [face, faceLoopback])

  const votesOf = (kind: Kind, id: string): number => {
    const bucket = data?.stats ?? { skin: {}, pet: {}, plugin: {} }
    return (bucket[kind] as Record<string, number>)[id] ?? 0
  }

  const sorted = (kind: Kind): MarketRecord[] => {
    const items = (data?.items[kind] ?? []).slice()
    items.sort((a, b) => {
      const va = votesOf(kind, a.id)
      const vb = votesOf(kind, b.id)
      if (va !== vb) return vb - va
      return (a.rank ?? 999) - (b.rank ?? 999)
    })
    return items
  }

  const matches = (item: MarketRecord): boolean => {
    if (!query) return true
    const q = query.toLowerCase()
    const hay = [item.name, item.nameEn, item.displayName, item.author, item.description, item.descriptionEn, item.category]
      .filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  }

  const callout = (id: string, text: string): void => {
    setCallouts((prev) => ({ ...prev, [id]: text }))
    window.setTimeout(() => {
      setCallouts((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }, 2400)
  }

  const copyCommand = (id: string, command: string): void => {
    const done = (): void => { setCopiedId(id); window.setTimeout(() => setCopiedId(null), 1200) }
    const fallback = (): boolean => {
      const ta = document.createElement('textarea')
      ta.value = command
      document.body.appendChild(ta)
      ta.select()
      let ok = false
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
      ta.remove()
      return ok
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(command).then(done, () => {
        if (fallback()) done()
      })
    } else {
      if (fallback()) done()
    }
  }

  const installAssetKind = async (kind: Kind, id: string, force: boolean): Promise<void> => {
    if (gateway === null) return
    const key = kind + ':' + id
    setInstalling(key)
    try {
      const result = await gateway.install(kind, id, force)
      callout(id, t('installedAt', { path: result.dest }))
      const list = await gateway.list()
      setInstalled(list)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'conflict' && !force) {
        setConflict({ kind, id, dest: (err as { dest?: string }).dest ?? id })
      } else {
        callout(id, t('installFailed', { reason: messageOf(err) }))
      }
    } finally {
      setInstalling(null)
    }
  }

  const onInstallAsset = (kind: Kind, id: string): void => {
    if (gateway === null || installing !== null) return
    void installAssetKind(kind, id, false)
  }

  const onInstallPlugin = (item: MarketRecord): void => {
    if (face === null || !face.isLoopback || installing !== null) return
    const id = item.id
    const spec = installSpec(item)
    if (!isInstallSpecValid(spec)) {
      setPluginErrors((prev) => ({ ...prev, [id]: t('installFailed', { reason: t('installSpecInvalid') }) }))
      return
    }
    setInstalling('plugin:' + id)
    face.install(spec).then(() => face.list()).then((list) => {
      setPluginList(list)
      callout(id, t('installed', {}))
    }).catch((reason: unknown) => {
      setPluginErrors((prev) => ({ ...prev, [id]: t('installFailed', { reason: messageOf(reason) }) }))
    }).finally(() => setInstalling(null))
  }

  const onLike = async (kind: Kind, id: string): Promise<void> => {
    const key = kind + ':' + id
    const seq = (likeSeq.current.get(key) ?? 0) + 1
    likeSeq.current.set(key, seq)
    const current = votesOf(kind, id)
    setData((prev) => prev ? {
      ...prev,
      stats: { ...prev.stats, [kind]: { ...prev.stats[kind], [id]: current + 1 } },
    } : prev)
    try {
      const token = await (props.turnstileToken ?? marketTurnstileToken)()
      const res = await fetch(MARKET_ORIGIN + '/api/like', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, asset_id: id, device_fp: deviceFp(), turnstile_token: token }),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const out = (await res.json()) as { votes?: number }
      if (likeSeq.current.get(key) !== seq) return
      setData((prev) => prev ? {
        ...prev,
        stats: { ...prev.stats, [kind]: { ...prev.stats[kind], [id]: out.votes ?? current + 1 } },
      } : prev)
    } catch {
      if (likeSeq.current.get(key) !== seq) return
      setData((prev) => prev ? {
        ...prev,
        stats: { ...prev.stats, [kind]: { ...prev.stats[kind], [id]: current } },
      } : prev)
      setCallouts((prev) => ({ ...prev, [id]: t('likeFailed', {}) }))
    }
  }

  const visible = sorted(tab).filter(matches)
  const total = (data?.items[tab] ?? []).length

  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      state={state}
      alwaysOpen
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-market-enabled"
        label={t('settings.enable')}
        hint={t('settings.enableHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.enabled}
        onEdit={(value) => { props.edit('enabled', value) }}
        onReset={() => { props.resetField('enabled') }}
      />
      {cardVisible ? (
        <div className={css.market}>
          <div className={css.tabs} role="tablist" aria-label={t('settings.title')}>
            {(['skin', 'pet', 'plugin'] as Kind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={tab === kind}
                className={tab === kind ? css.tab + ' ' + css.tabActive : css.tab}
                onClick={() => { setTab(kind) }}
              >
                {t(KIND_LABEL[kind])}
                <span className={css.tabCount}>{(data?.items[kind] ?? []).length}</span>
              </button>
            ))}
          </div>
          <input
            className={css.search}
            type="search"
            aria-label={t('search.label')}
            placeholder={t('search.label')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
          {failed ? (
            <p className={css.empty} role="status">
              {t('empty')}
              <Button className={css.retry} onClick={() => { setLoadAttempt((value) => value + 1) }}>{t('retry')}</Button>
            </p>
          ) : loading ? (
            <p className={css.empty} role="status">{t('loading')}</p>
          ) : visible.length === 0 ? (
            <p className={css.empty} role="status">{total === 0 ? t('empty') : t('noMatch')}</p>
          ) : (
            <ul className={css.grid}>
              {visible.map((item) => {
                const name = item.name ?? item.displayName ?? item.id
                const id = item.id
                const installedHere = tab === 'skin' ? installed.skins.includes(id)
                  : tab === 'pet' ? installed.pets.includes(id)
                  : entryInstalled(item, pluginList ?? []) !== null
                const isInstalling = installing === tab + ':' + id || installing === 'plugin:' + id
                const command = tab === 'plugin' ? installCommand(item) : ''
                const thumb = tab === 'skin' ? item.preview?.light
                  : tab === 'pet' ? (item.previews?.[0] ?? item.spritesheet)
                  : ''
                return (
                  <li key={id} className={css.card}>
                    {thumb ? <img className={css.thumb} src={MARKET_ORIGIN + '/' + thumb} alt="" loading="lazy" /> : (
                      <span className={css.thumb + ' ' + css.thumbPlaceholder}>{(name[0] ?? '?').toUpperCase()}</span>
                    )}
                    <span className={css.cardBody}>
                      <span className={css.cardName} title={name}>
                        {name}
                        {item.version ? <span className={css.cardVersion}>v{item.version}</span> : null}
                      </span>
                      <span className={css.cardMeta}>
                        {item.author ?? ''}
                        {item.category ? <span className={css.badge}>{item.category}</span> : null}
                        {installedHere ? <span className={css.badge + ' ' + css.badgeInstalled}>{t('installed')}</span> : null}
                      </span>
                      {item.description || item.descriptionEn ? (
                        <span className={css.cardDesc}>{(item.description ?? item.descriptionEn ?? '').slice(0, 140)}</span>
                      ) : null}
                      <span className={css.cardFooter}>
                        <span className={css.actionRow}>
                          <button type="button" className={css.like} onClick={() => { void onLike(tab, id) }}>
                            {t('like')} {votesOf(tab, id)}
                          </button>
                          <button
                            type="button"
                            className={css.previewLink}
                            onClick={() => {
                              window.open(
                                tab === 'skin'
                                  ? MARKET_ORIGIN + '/preview.html?skin=' + encodeURIComponent(id) + '&theme=light&chrome=0'
                                  : MARKET_ORIGIN + '/',
                                '_blank',
                                'noopener',
                              )
                            }}
                          >
                            {t('preview')}
                          </button>
                          {tab === 'plugin' && item.repo ? (
                            <a className={css.previewLink} href={item.repo} target="_blank" rel="noreferrer">{t('repository')}</a>
                          ) : null}
                        </span>
                        {tab === 'plugin' || gateway !== null ? (
                          <span className={css.actionRowPrimary}>
                            {tab === 'plugin' ? (
                              <button
                                type="button"
                                className={css.install}
                                title={command}
                                onClick={() => { copyCommand(id, command) }}
                              >
                                {copiedId === id ? t('copied') : t('copyCommand')}
                              </button>
                            ) : null}
                            {tab === 'plugin' && faceLoopback && !installedHere ? (
                              <button
                                type="button"
                                className={css.install + ' ' + css.installPrimary}
                                disabled={installing !== null}
                                onClick={() => { onInstallPlugin(item) }}
                              >
                                {isInstalling ? t('installing') : t('installNow')}
                              </button>
                            ) : null}
                            {(tab === 'skin' || tab === 'pet') && gateway !== null ? (
                              <button
                                type="button"
                                className={css.install + ' ' + css.installPrimary}
                                disabled={installing !== null || installedHere}
                                onClick={() => { onInstallAsset(tab, id) }}
                              >
                                {isInstalling ? t('installing') : installedHere ? t('installed') : t('installNow')}
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                      {pluginErrors[id] ? <span className={css.error}>{pluginErrors[id]}</span> : null}
                      {callouts[id] ? <span className={css.callout}>{callouts[id]}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {gateway === null ? <p className={css.remoteNote}>{t('remote.note')}</p> : null}
        </div>
      ) : null}
      <Modal
        title={conflict ? t('conflict.title') : ''}
        open={conflict !== null}
        onClose={() => { setConflict(null) }}
      >
        <div>
          <p>{t('conflict.text', { dest: conflict?.dest ?? '' })}</p>
          <div className={css.modalActions}>
            <Button onClick={() => {
              const target = conflict
              setConflict(null)
              if (target) void installAssetKind(target.kind, target.id, true)
            }}>{t('replace')}</Button>
            <Button onClick={() => { setConflict(null) }}>{t('cancel')}</Button>
          </div>
        </div>
      </Modal>
    </PluginSettingsCard>
  )
}

/** The section wrapper the slot renderer mounts. */
export type MarketSectionProps = ComponentProps<typeof MarketCard>
export function MarketSection(props: ComponentProps<typeof MarketCard>): ReactNode {
  return <MarketCard {...props} />
}
