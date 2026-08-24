/**
 * The "Version Notes" entry inside the Web UI plugins group section.
 *
 * A compact row naming the latest release (title, description, version and
 * new-release pills); clicking it opens the full release page in the
 * primitives Modal - the same token-driven overlay dsh-market and
 * dsh-plugin-manager use - with the release hero, highlight cards and the
 * per-category change lists. The pill clears only when the user explicitly
 * closes the release page (Got it / Escape / mask), which persists the seen
 * version immediately.
 *
 * On first mount after a version upgrade, the modal auto-pops once (方案 D).
 * The auto-shown flag is persisted immediately so subsequent mounts suppress
 * the popup until the next upgrade. A "don't auto-popup" checkbox lets users
 * opt out of future auto-popups; its state is persisted on close.
 */

import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { CURRENT_VERSION, RELEASES, type ReleaseChange } from './release-notes.ts'
import {
  acknowledgeVersion,
  hasNewRelease,
  readSuppress,
  setAutoShown,
  setSuppress,
  shouldAutoPopup,
  type StringStorage,
} from './whats-new.ts'
import css from './web-ui-settings.module.css'

/** Props the group section passes down: its own locale face plus optional storage. */
export type ReleaseNotesCardProps = {
  /** The `web-ui-plugins` translate seat (the card lives in that namespace). */
  t: PropsLocale<'web-ui-plugins'>['t']
  /** Injectable persistence face; defaults to localStorage. */
  storage?: StringStorage
}

/** The translate seat type, matching PropsLocale<'web-ui-plugins'>. */
type GroupTranslate = PropsLocale<'web-ui-plugins'>['t']

/** Render one highlight entry with its square badge, index, title and links. */
function HighlightRow({ change, t, index }: { change: ReleaseChange; t: GroupTranslate; index: number }): ReactNode {
  return (
    <li className={css.releaseHighlight}>
      <span className={css.releaseBadgeSquare + ' ' + css['badge-' + change.kind]}>{t(change.kind)}</span>
      <div className={css.releaseHighlightBody}>
        <span className={css.releaseHighlightIndex}>{String(index + 1).padStart(2, '0')}</span>
        <h4 className={css.releaseHighlightTitle}>{change.title}</h4>
        <p className={css.releaseHighlightDesc}>{change.desc}</p>
        {change.refs !== undefined && change.refs.length > 0 ? (
          <div className={css.releaseRefs}>
            {change.refs.map(ref => (
              <a key={ref} className={css.releaseRef} href={'https://github.com/zhu1090093659/dsh-web-ui/issues/' + ref}>
                #{ref}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** Render one category list (New / Improved / Fixed). */
function ChangeList({ title, items }: { title: string; items: string[] }): ReactNode {
  if (items.length === 0) return null
  return (
    <section className={css.whatsNewSection}>
      <h3 className={css.whatsNewSectionHead}>{title}</h3>
      <ul className={css.whatsNewBullets}>
        {items.map(item => <li key={item} className={css.whatsNewBullet}>{item}</li>)}
      </ul>
    </section>
  )
}

/**
 * Render the version-notes entry and its release-page modal.
 * @param props - the group locale face and an optional storage override.
 */
export function ReleaseNotesCard(props: ReleaseNotesCardProps): ReactNode {
  const { t } = props
  const storage = props.storage ?? globalThis.localStorage
  // A host without localStorage simply never advertises a fresh release.
  const [seen, setSeen] = useState(() => {
    if (storage === undefined) return true
    try { return !hasNewRelease(storage, CURRENT_VERSION) } catch { return true }
  })
  const [open, setOpen] = useState(false)
  const [suppressAuto, setSuppressAuto] = useState(() => {
    if (storage === undefined) return false
    try { return readSuppress(storage) } catch { return false }
  })
  const isNew = !seen

  // Auto-popup on first mount after a version upgrade (方案 D).
  useEffect(() => {
    if (storage === undefined) return
    try {
      if (shouldAutoPopup(storage, CURRENT_VERSION)) {
        setAutoShown(storage, CURRENT_VERSION)
        setOpen(true)
      }
    } catch { /* storage unavailable — no auto-popup */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Open the release page (no acknowledge yet — pill stays until Got it). */
  const openNotes = (): void => {
    setOpen(true)
  }

  /** Close the release page: always acknowledge + persist suppress preference. */
  const closeNotes = (): void => {
    try {
      if (storage !== undefined) {
        acknowledgeVersion(storage, CURRENT_VERSION)
        setSuppress(storage, suppressAuto)
      }
    } catch { /* storage unavailable — silently skip persistence */ }
    setSeen(true)
    setOpen(false)
  }

  /** Toggle the "don't auto-popup" preference (does not close the modal). */
  const onSuppressToggle = (e: ChangeEvent<HTMLInputElement>): void => {
    setSuppressAuto(e.target.checked)
  }

  const latest = RELEASES[0]

  return (
    <>
      <li className={css.releaseCard}>
        <button
          type="button"
          className={css.releaseHeader}
          aria-haspopup="dialog"
          onClick={openNotes}
        >
          <span className={css.releaseHeadText}>
            <span className={css.releaseName} title={t('releaseNotesTitle')}>{t('releaseNotesTitle')}</span>
            <span className={css.releaseDescription} title={t('releaseNotesDescription')}>{t('releaseNotesDescription')}</span>
          </span>
          <span className={css.releasePills}>
            <span className={css.releaseVersion}>v{CURRENT_VERSION}</span>
            {isNew ? <span className={css.whatsNewBadge}>{t('new')}</span> : null}
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={css.releaseChevron + ' ' + css.releaseChevronRight}
          >
            <path
              d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </li>
      <Modal
        open={open}
        onClose={closeNotes}
        title={t('releaseNotesTitle') + ' v' + CURRENT_VERSION}
        closeLabel={t('ack')}
        headless
        className={css.releaseModal}
      >
        <div className={css.releasePage}>
          {/* --- Chrome-style panel header --- */}
          <div className={css.releaseChromeBar}>
            <span className={css.releaseChromeDot + ' ' + css['releaseChromeDot-r']} />
            <span className={css.releaseChromeDot + ' ' + css['releaseChromeDot-y']} />
            <span className={css.releaseChromeDot + ' ' + css['releaseChromeDot-g']} />
            <span className={css.releaseChromeTitle}>{t('releaseNotesTitle')}</span>
            <span className={css.releaseChromeSpacer} />
            <span className={css.releaseChromePill}>v{CURRENT_VERSION}</span>
          </div>
          {/* --- Hero --- */}
          <header className={css.releaseHero}>
            <p className={css.releaseHeroKicker}>What's new in v{CURRENT_VERSION}</p>
            <div className={css.releaseHeroTop}>
              <span className={css.releaseHeroVersion}>DSH Web UI</span>
              <span className={css.releaseHeroDate}>{latest.date}</span>
            </div>
            <p className={css.whatsNewLede}>{latest.lede}</p>
          </header>
          {/* --- Highlights (horizontal card layout, dashed separators) --- */}
          <div className={css.releasePageBody}>
            <section className={css.whatsNewSection}>
              <h3 className={css.whatsNewSectionHead}>{t('highlights')}</h3>
              <ul className={css.releaseHighlights}>
                {latest.highlights.map((change, index) => (
                  <HighlightRow key={change.title} change={change} t={t} index={index} />
                ))}
              </ul>
            </section>
            <ChangeList title={t('new')} items={latest.sections.new} />
            <ChangeList title={t('improved')} items={latest.sections.improved} />
            <ChangeList title={t('fixed')} items={latest.sections.fixed} />
          </div>
          {/* --- Footer: primary acknowledge button --- */}
          <div className={css.releaseFooter}>
            <button className={css.releaseBtnPrimary + ' ' + css.releaseBtnPrimaryHover} type="button" onClick={closeNotes}>
              {t('ack')}
            </button>
          </div>
          {/* --- Don't auto-popup checkbox --- */}
          <div className={css.releaseDontShow}>
            <label className={css.releaseDontShowLabel}>
              <input
                type="checkbox"
                className={css.releaseDontShowInput}
                checked={suppressAuto}
                onChange={onSuppressToggle}
              />
              {t('dontAutoShow')}
            </label>
          </div>
        </div>
      </Modal>
    </>
  )
}
