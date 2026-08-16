/** API-backed Community Plugins settings section and lifecycle controls. */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  Button,
  IconCloseOutline16,
  IconRefreshOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  buildInstallPlan,
  COMMUNITY_STORE_API_PREFIX,
  filterCatalogRepositories,
  getCatalogFacets,
  mergeInstalledPlugins,
  type CatalogRepository,
  type InstalledPlugin,
} from '../core/store-catalog.ts'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import { CatalogStore } from './catalog-store.ts'
import type { CommunityPluginKey } from './locales.ts'
import css from './community.module.css'

const PAGE_SIZE = 24

export interface CommunityPluginsSettings {
  enabled?: boolean
}

export interface CommunityPluginsCardState extends CardShell {
  enabled: CardFieldState
}

export interface CommunityPluginsCardFace extends CardActions {
  hooks: {
    communityPluginsCard: SnapshotStore<CommunityPluginsCardState>
  }
}

export class CommunityPluginsCardController {
  private readonly form: CardForm<CommunityPluginsSettings>
  private readonly store: SnapshotStore<CommunityPluginsCardState>

  constructor(scope: SettingsScope<CommunityPluginsSettings>) {
    this.form = new CardForm(scope, [booleanField('enabled')])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
    }))
  }

  inject(): CommunityPluginsCardFace {
    return { hooks: { communityPluginsCard: this.store }, ...this.form.actions() }
  }

  dispose(): void {
    this.form.dispose()
  }
}

type Translate = CommunityPluginsCardProps['t']
type LifecycleFetch = typeof fetch

interface InventoryState {
  status: 'loading' | 'ready' | 'error'
  plugins: InstalledPlugin[]
}

interface MutationTarget {
  repository: CatalogRepository
  action: 'install' | 'update' | 'remove'
}

function detailUrl(repository: CatalogRepository): string {
  return `https://dshmk.com/plugins/${encodeURIComponent(String(repository.repositoryId))}`
}

function formatStars(stars: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(stars)
}

interface ProjectRowProps {
  repository: CatalogRepository
  onMutate: (target: MutationTarget) => void
  t: Translate
}

function ProjectRow({ repository, onMutate, t }: ProjectRowProps): ReactNode {
  const plan = buildInstallPlan(repository)
  const installed = repository.installed === true
  const update = repository.updateAvailable === true
  const action = update ? 'update' : 'install'
  return (
    <li className={css.entry}>
      <div className={css.entryHead}>
        <a className={css.entryName} href={detailUrl(repository)} target="_blank" rel="noreferrer">
          {repository.name}
        </a>
        <span className={css.stars}>{t('store.stars', { count: formatStars(repository.stars) })}</span>
      </div>
      <span className={css.entryRepository}>{repository.fullName}</span>
      <p className={css.entryDescription}>{repository.description}</p>
      <div className={css.badges}>
        <span className={css.badge}>{repository.projectType}</span>
        <span className={css.badge}>{repository.category}</span>
        <span className={css.validation} data-status={repository.validation?.overall ?? 'unrecognized'}>
          {repository.validation?.label ?? repository.validation?.overall ?? t('store.unrecognized')}
        </span>
        {installed ? <span className={css.installed}>{update ? t('store.updateAvailable') : t('store.installed')}</span> : null}
      </div>
      <div className={css.entryActions}>
        {plan === null
          ? <span className={css.unavailable}>{t('store.installUnavailable')}</span>
          : (
            <Button
              size="sm"
              variant={update ? 'primary' : 'outline'}
              type="button"
              disabled={installed && !update}
              onClick={() => { onMutate({ repository, action }) }}
            >
              {update ? t('store.update') : installed ? t('store.installed') : t('store.install')}
            </Button>
          )}
        {installed && repository.installedPlugin !== null && repository.installedPlugin !== undefined
          ? (
            <button
              type="button"
              className={css.removeButton}
              aria-label={t('store.removeAria', { name: repository.name })}
              title={t('store.remove')}
              onClick={() => { onMutate({ repository, action: 'remove' }) }}
            >
              <IconTrashOutline16 size={16} />
            </button>
          )
          : null}
      </div>
    </li>
  )
}

interface MutationModalProps {
  target: MutationTarget | null
  lifecycleFetch: LifecycleFetch
  onClose: () => void
  onComplete: () => Promise<void>
  t: Translate
}

function MutationModal({ target, lifecycleFetch, onClose, onComplete, t }: MutationModalProps): ReactNode {
  const [acknowledged, setAcknowledged] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setAcknowledged(false)
    setPhase('idle')
    setMessage('')
  }, [target?.repository.repositoryId, target?.action])

  if (target === null) return null
  const removing = target.action === 'remove'
  const updating = target.action === 'update'
  const title = removing ? t('store.removeTitle') : updating ? t('store.updateTitle') : t('store.installTitle')
  const busy = phase === 'running'
  const finished = phase === 'success'
  const canConfirm = !busy && !finished && (removing || acknowledged)

  const mutate = async (): Promise<void> => {
    if (!canConfirm) return
    setPhase('running')
    setMessage('')
    const path = removing ? 'remove' : 'install'
    const body = removing
      ? { name: target.repository.installedPlugin?.name }
      : { repositoryId: target.repository.repositoryId }
    try {
      const response = await lifecycleFetch(`${COMMUNITY_STORE_API_PREFIX}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const value = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; output?: string }
      if (!response.ok || value.ok !== true) throw new Error(value.message ?? `${t('store.mutationFailed')} (${response.status})`)
      setPhase('success')
      setMessage([t('store.restartRequired'), value.output ?? ''].filter(Boolean).join('\n'))
      await onComplete()
    } catch (error) {
      setPhase('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose() }}
      title={title}
      closeLabel={t('store.cancel')}
      className={css.modal}
      headless
    >
      <div className={css.modalShell}>
        <header className={css.modalHeader}>
          <span className={css.modalTitle}>
            {removing ? <IconTrashOutline16 size={18} /> : <IconWarningOutline16 size={18} />}
            <strong>{title}</strong>
          </span>
          <button type="button" className={css.iconButton} onClick={onClose} disabled={busy} aria-label={t('store.cancel')}>
            <IconCloseOutline16 size={16} />
          </button>
        </header>
        <div className={css.modalBody}>
          <p>{removing ? t('store.removeRisk') : t('store.installRisk')}</p>
          <strong>{target.repository.fullName}</strong>
          <code>{removing ? target.repository.installedPlugin?.name : buildInstallPlan(target.repository)?.command}</code>
          {!removing && !finished
            ? (
              <label className={css.acknowledge}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={busy}
                  onChange={event => { setAcknowledged(event.target.checked) }}
                />
                <span>{t('store.riskAcknowledge')}</span>
              </label>
            )
            : null}
          {phase === 'running' ? <p role="status">{removing ? t('store.removing') : updating ? t('store.updating') : t('store.installing')}</p> : null}
          {phase === 'success' ? <pre className={css.success} role="status">{message}</pre> : null}
          {phase === 'error' ? <pre className={css.error} role="alert">{message}</pre> : null}
        </div>
        <footer className={css.modalActions}>
          <Button size="sm" variant="outline" type="button" disabled={busy} onClick={onClose}>
            {finished ? t('store.done') : t('store.cancel')}
          </Button>
          {!finished
            ? (
              <Button size="sm" variant="primary" type="button" disabled={!canConfirm} onClick={() => { void mutate() }}>
                {busy
                  ? removing ? t('store.removing') : updating ? t('store.updating') : t('store.installing')
                  : removing ? t('store.confirmRemove') : updating ? t('store.confirmUpdate') : t('store.confirmInstall')}
              </Button>
            )
            : null}
        </footer>
      </div>
    </Modal>
  )
}

interface StoreViewProps {
  catalogStore: CatalogStore
  lifecycleFetch: LifecycleFetch
  t: Translate
}

function StoreView({ catalogStore, lifecycleFetch, t }: StoreViewProps): ReactNode {
  const snapshot = useSyncExternalStore(catalogStore.subscribe, catalogStore.getSnapshot)
  const [inventory, setInventory] = useState<InventoryState>({ status: 'loading', plugins: [] })
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<'recommended' | 'stars' | 'updated' | 'name'>('recommended')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [installedOnly, setInstalledOnly] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [mutationTarget, setMutationTarget] = useState<MutationTarget | null>(null)

  const refreshInventory = useCallback(async (): Promise<void> => {
    setInventory(current => ({ ...current, status: 'loading' }))
    try {
      const response = await lifecycleFetch(`${COMMUNITY_STORE_API_PREFIX}/plugins`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      const value = await response.json().catch(() => ({})) as { ok?: boolean; plugins?: unknown; message?: string }
      if (!response.ok || value.ok !== true || !Array.isArray(value.plugins)) {
        throw new Error(value.message ?? `${t('store.inventoryFailed')} (${response.status})`)
      }
      setInventory({ status: 'ready', plugins: value.plugins as InstalledPlugin[] })
    } catch {
      setInventory({ status: 'error', plugins: [] })
    }
  }, [lifecycleFetch, t])

  useEffect(() => { void catalogStore.load() }, [catalogStore])
  useEffect(() => { void refreshInventory() }, [refreshInventory])
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [query, category, sort, verifiedOnly, installedOnly])

  const repositories = useMemo(
    () => mergeInstalledPlugins(snapshot.catalog?.repositories ?? [], inventory.plugins),
    [snapshot.catalog, inventory.plugins],
  )
  const facets = useMemo(() => snapshot.catalog === null ? null : getCatalogFacets(snapshot.catalog), [snapshot.catalog])
  const filtered = useMemo(() => filterCatalogRepositories(repositories, {
    query,
    category,
    sort,
    verifiedOnly,
    installedOnly,
  }), [repositories, query, category, sort, verifiedOnly, installedOnly])
  const visible = filtered.slice(0, visibleCount)

  const refresh = (): void => {
    void catalogStore.load({ force: true })
    void refreshInventory()
  }

  return (
    <section className={css.store} aria-label={t('settings.title')}>
      <div className={css.storeHead}>
        <div className={css.storeMeta}>
          <span>{t('store.results', { visible: visible.length, total: filtered.length })}</span>
          {snapshot.catalog?.generatedAt
            ? <span>{t('store.updated', { date: new Date(snapshot.catalog.generatedAt).toLocaleString() })}</span>
            : null}
          {inventory.status === 'error' ? <span className={css.warning}>{t('store.inventoryFailed')}</span> : null}
        </div>
        <button type="button" className={css.iconButton} onClick={refresh} disabled={snapshot.status === 'loading'} aria-label={t('store.refresh')} title={t('store.refresh')}>
          <IconRefreshOutline16 size={16} />
        </button>
      </div>

      <div className={css.filters}>
        <input
          type="search"
          className={css.search}
          value={query}
          onChange={event => { setQuery(event.target.value) }}
          placeholder={t('store.search')}
          aria-label={t('store.search')}
        />
        <select value={category} onChange={event => { setCategory(event.target.value) }} aria-label={t('store.category')}>
          <option value="all">{t('store.categoryAll')}</option>
          {(facets?.categories ?? []).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select value={sort} onChange={event => { setSort(event.target.value as typeof sort) }} aria-label={t('store.sort')}>
          <option value="recommended">{t('store.sortRecommended')}</option>
          <option value="stars">{t('store.sortStars')}</option>
          <option value="updated">{t('store.sortUpdated')}</option>
          <option value="name">{t('store.sortName')}</option>
        </select>
        <label className={css.check}><input type="checkbox" checked={verifiedOnly} onChange={event => { setVerifiedOnly(event.target.checked) }} /><span>{t('store.verifiedOnly')}</span></label>
        <label className={css.check}><input type="checkbox" checked={installedOnly} onChange={event => { setInstalledOnly(event.target.checked) }} /><span>{t('store.installedOnly')}</span></label>
      </div>

      {snapshot.status === 'loading' && snapshot.catalog === null ? <p className={css.status} role="status">{t('store.loading')}</p> : null}
      {snapshot.status === 'error' && snapshot.catalog === null
        ? <p className={css.error} role="alert">{t('store.loadFailed')}: {snapshot.error}</p>
        : null}
      {snapshot.status === 'error' && snapshot.catalog !== null
        ? <p className={css.warning} role="status">{t('store.refreshFailed')}: {snapshot.error}</p>
        : null}
      {snapshot.catalog !== null && filtered.length === 0 ? <p className={css.status}>{t('store.empty')}</p> : null}
      {visible.length > 0 ? <ul className={css.entries}>{visible.map(repository => <ProjectRow key={repository.id} repository={repository} onMutate={setMutationTarget} t={t} />)}</ul> : null}
      {visible.length < filtered.length
        ? <button type="button" className={css.loadMore} onClick={() => { setVisibleCount(count => count + PAGE_SIZE) }}>{t('store.loadMore')}</button>
        : null}
      <p className={css.notice} role="note">{t('store.disclaimer')}</p>

      <MutationModal
        target={mutationTarget}
        lifecycleFetch={lifecycleFetch}
        onClose={() => { setMutationTarget(null) }}
        onComplete={refreshInventory}
        t={t}
      />
    </section>
  )
}

export type CommunityPluginsCardProps =
  PropsLocale<'community-plugins'>
  & InjectFace<CommunityPluginsCardFace>
  & {
    catalogStore: CatalogStore
    lifecycleFetch?: LifecycleFetch
  }

export function CommunityPluginsCard(props: CommunityPluginsCardProps): ReactNode {
  const { t } = props
  const state = props.useCommunityPluginsCard(snapshot => snapshot)
  const visible = state.enabled.text !== 'false'
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled: !state.writable,
  }
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
        id="settings-community-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.enabled}
        onEdit={text => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      {visible
        ? <StoreView catalogStore={props.catalogStore} lifecycleFetch={props.lifecycleFetch ?? globalThis.fetch.bind(globalThis)} t={t} />
        : <p className={css.status} role="status">{t('off')}</p>}
    </PluginSettingsCard>
  )
}

export type CommunityPluginsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'community-plugins'>
  & InjectFace<CommunityPluginsCardFace>
  & {
    catalogStore: CatalogStore
    lifecycleFetch?: LifecycleFetch
  }

export function CommunityPluginsSection(props: CommunityPluginsSectionProps): ReactNode {
  const { t, useCommunityPluginsCard, save, discard, edit, resetField, catalogStore, lifecycleFetch } = props
  return (
    <ul className={css.sectionList}>
      <CommunityPluginsCard
        t={t}
        useCommunityPluginsCard={useCommunityPluginsCard}
        save={save}
        discard={discard}
        edit={edit}
        resetField={resetField}
        catalogStore={catalogStore}
        lifecycleFetch={lifecycleFetch}
      />
    </ul>
  )
}
