/**
 * The pet-center plugin card: one disclosure card inside the Web UI plugin
 * group (插件配置 → Web UI 插件 → 宠物中心), listing the two pet companions
 * (the original whale and the introduced whale maid). Try-on switches the
 * active pet live and can be reverted; Apply persists the choice. Both go
 * through the host /api/pet-center API, which rewrites the managed pet
 * section of ~/.dsh/cordis.patch.yml; the config watcher hot-reloads it
 * within seconds and a page refresh lands on the new pet.
 */

import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './pet-center.module.css'

/** A pet selectable in the center. */
export interface PetOption {
  /** Pet id (the aggregate row id; also the apply target). */
  id: 'pet' | 'pet-maid'
  /** Locale key of the pet name. */
  titleKey: 'original' | 'introduced'
  /** Locale key of the pet's one-line description. */
  taglineKey: 'originalTagline' | 'introducedTagline'
}

/** The pets the center can switch between. */
const PET_OPTIONS: readonly PetOption[] = [
  { id: 'pet', titleKey: 'original', taglineKey: 'originalTagline' },
  { id: 'pet-maid', titleKey: 'introduced', taglineKey: 'introducedTagline' },
] as const

/** Plugin-card component props: group-item runtime share + locale seat. */
export type PetCenterComponentProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'petCenter'>

/** Poll `active` until the host reports the target, or time out. */
function confirmActive(target: string, budgetMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = (): void => {
      void fetch('/api/pet-center/state')
        .then(async (response) => {
          const payload = await response.json().catch(() => null) as { ok?: boolean; active?: string } | null
          if (response.ok && payload?.ok === true && payload.active === target) {
            resolve(true)
            return
          }
          if (Date.now() - start > budgetMs) resolve(false)
          else window.setTimeout(tick, 250)
        })
        .catch(() => {
          if (Date.now() - start > budgetMs) resolve(false)
          else window.setTimeout(tick, 250)
        })
    }
    tick()
  })
}

/** Read the currently active pet from the host. */
function fetchActive(): Promise<string> {
  return fetch('/api/pet-center/state')
    .then((response) => response.json())
    .then((payload: { ok?: boolean; active?: string }) => (payload.ok === true && typeof payload.active === 'string' ? payload.active : 'pet'))
    .catch(() => 'pet')
}

/**
 * Render the pet-center card: a disclosure header naming the plugin, with
 * the pet list (original whale + introduced whale maid; try-on preview /
 * one-click apply) inside its body.
 * @param props - card props.
 * @returns the plugin card.
 */
export function PetCenter({ t }: PetCenterComponentProps) {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tryingId, setTryingId] = useState<string | null>(null)
  const [preTarget, setPreTarget] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ensureActive = async (): Promise<void> => {
    if (activeId === null) setActiveId(await fetchActive())
  }
  void ensureActive()

  const apply = async (target: string, markTrying: boolean): Promise<void> => {
    setError(null)
    setApplying(true)
    try {
      const response = await fetch('/api/pet-center/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pet: target }),
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; active?: string; message?: string } | null
      if (!response.ok || payload?.ok !== true) {
        setError(t('applyFailed') + (payload !== null && typeof payload === 'object' && 'error' in payload ? `: ${String((payload as { error?: unknown }).error)}` : ''))
        return
      }
      if (markTrying) {
        setPreTarget((prev) => prev ?? activeId)
        setTryingId(target)
      } else {
        setTryingId(null)
        setPreTarget(null)
      }
      setActiveId(payload.active ?? target)
      // The patch hot-reloads within seconds; confirm so the UI reflects it.
      const confirmed = await confirmActive(target)
      if (!confirmed) setError(t('appliedUnconfirmed'))
    } finally {
      setApplying(false)
    }
  }

  const exitTryOn = (): void => {
    if (preTarget !== null && preTarget !== tryingId) {
      void apply(preTarget, false)
    }
    setTryingId(null)
    setPreTarget(null)
  }

  return (
    <li className={css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('title')}</span>
          <span className={css.description}>{t('cardDescription')}</span>
        </span>
        <span className={open ? css.chevronOpen : css.chevron}>▾</span>
      </button>
      {open
        ? (
          <div className={css.body}>
            <p className={css.intro}>{t('intro')}</p>
            {error !== null ? <p className={css.pending} role="status">{error}</p> : null}
            <ul className={css.list}>
              {PET_OPTIONS.map((pet) => {
                const isActive = activeId === pet.id
                const isTrying = tryingId === pet.id
                const badge = isActive && !isTrying
                  ? <span className={`${css.badge} ${css.badgeActive}`} data-testid={`pet-${pet.id}-active`}>{t('active')}</span>
                  : isTrying
                    ? <span className={`${css.badge} ${css.badgeTrying}`}>{t('tryingOn')}</span>
                    : null
                return (
                  <li key={pet.id} className={`${css.item} ${isTrying ? css.itemTrying : isActive ? css.itemActive : ''}`}>
                    <div className={css.meta}>
                      <div className={css.itemName}>{t(pet.titleKey)}</div>
                      <div className={css.itemTagline}>{t(pet.taglineKey)}</div>
                    </div>
                    {badge}
                    <div className={css.actions}>
                      <button
                        type="button"
                        className={css.action}
                        disabled={applying || isTrying}
                        onClick={() => { void apply(pet.id, true) }}
                        data-testid={`pet-${pet.id}-try`}
                      >
                        {t('tryOn')}
                      </button>
                      <button
                        type="button"
                        className={css.action}
                        disabled={applying || isActive}
                        onClick={() => { void apply(pet.id, false) }}
                        data-testid={`pet-${pet.id}-apply`}
                      >
                        {t(applying && !isTrying ? 'applying' : 'apply')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {tryingId !== null ? (
              <button type="button" className={css.action} onClick={exitTryOn} style={{ marginTop: 8 }}>
                {t('exitTryOn')}
              </button>
            ) : null}
          </div>
        )
        : null}
    </li>
  )
}
