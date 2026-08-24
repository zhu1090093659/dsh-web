/**
 * The star plugin's browser half.
 *
 * An ordinary client plugin: one registrant in the surface's own
 * `sidebar.footer.action` slot, the same hole the terminal and `ui-cordis` use,
 * wearing the shape of the Settings row it sits above and folding to the same
 * 36px circle when the column does, so the foot reads as one stack of rows.
 *
 * The star count is a courtesy, not a feature. GitHub serves the repository
 * endpoint with CORS and rate-limits it by address, so the number is fetched
 * once, cached for the day, and simply absent when the request fails — the
 * link works either way, and nothing here waits on the network to render.
 */

import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'

// market/tryon: the shell is the dsh-market try-on build; the repo the
// visitor should star is the plugin family this market sells, not the
// vendored upstream shell.
/** The repository the button points at. */
const REPO = 'zhu1090093659/dsh-web'

/** Where the button sends the visitor. */
const REPO_URL = `https://github.com/${REPO}`

/** Where the count comes from. */
const API_URL = `https://api.github.com/repos/${REPO}`

/** Where a fetched count is kept between reloads, and for how long. */
const CACHE_KEY = 'dsh-web-star:count'
const CACHE_TTL = 24 * 60 * 60 * 1000

/**
 * Read a count cached by an earlier visit.
 * @returns the count, or nothing when it is absent, stale, or unreadable.
 */
function cachedCount(): number | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw === null) return undefined
    const entry = JSON.parse(raw) as { count?: unknown, at?: unknown }
    if (typeof entry.count !== 'number' || typeof entry.at !== 'number') return undefined
    return Date.now() - entry.at < CACHE_TTL ? entry.count : undefined
  } catch {
    return undefined
  }
}

/**
 * The repository's star count, fetched at most once a day per browser.
 * @returns the count once it is known.
 */
function useStarCount(): number | undefined {
  const [count, setCount] = useState<number | undefined>(cachedCount)
  useEffect(() => {
    if (count !== undefined) return
    let live = true
    void (async () => {
      try {
        const response = await fetch(API_URL, { headers: { accept: 'application/vnd.github+json' } })
        if (!response.ok) return
        const body = await response.json() as { stargazers_count?: unknown }
        if (typeof body.stargazers_count !== 'number') return
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ count: body.stargazers_count, at: Date.now() }))
        } catch { /* a full or blocked store is not a reason to hide the count */ }
        if (live) setCount(body.stargazers_count)
      } catch { /* offline, rate-limited, or blocked: the link still works */ }
    })()
    return () => { live = false }
  }, [count])
  return count
}

/** A star, outlined at 16px like the Settings icon it sits under. */
function StarIcon(): JSX.Element {
  return (
    <svg
      className="dsh-web-star-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M8 1.6l1.86 3.78 4.17.6-3.02 2.94.71 4.15L8 11.13l-3.72 1.94.71-4.15L1.97 5.98l4.17-.6L8 1.6Z" />
    </svg>
  )
}

/**
 * The foot action itself.
 * @param props - the owner share of the slot; `wide` is false on the 56px rail.
 * @returns the link when the column is wide, and nothing when it is folded.
 */
function StarAction({ wide }: { wide: boolean }): JSX.Element {
  const count = useStarCount()
  // `compact` is Intl's own abbreviation, so 1200 reads as 1.2K in every locale
  // the surface offers without this file knowing any of them.
  const reading = count === undefined
    ? undefined
    : new Intl.NumberFormat(undefined, { notation: 'compact' }).format(count)
  return (
    <a
      className="dsh-web-star"
      {...(wide ? {} : { 'data-rail': '' })}
      href={REPO_URL}
      target="_blank"
      rel="noreferrer noopener"
      title={`${REPO} is open source and free to run. A star helps other people find it.`}
      aria-label={`Star ${REPO} on GitHub`}
    >
      <StarIcon />
      {wide && (
        <>
          <span className="dsh-web-star-label">Star on GitHub</span>
          {reading !== undefined && <span className="dsh-web-star-count">{reading}</span>}
        </>
      )}
    </a>
  )
}

/**
 * The sidebar's own Settings row, to the pixel: same 34px height, same 12px
 * radius, same 8px gap, same negative margin that lets the hover highlight
 * bleed past the column padding, and the same 36px circle when the column
 * folds. The foot should read as one stack of rows in one style, not as a
 * surface with plugins stuck to the bottom of it, so this file follows that row
 * rather than inventing a look. The fallbacks are for a theme that has not
 * defined these tokens, not for a different look.
 *
 * The `:has` rules open the foot's action line, which is one nowrap row: a
 * second action would otherwise sit beside the terminal instead of under it.
 * Both shapes are given because the slot renderer may or may not wrap a
 * registrant in a `display: contents` div, and nothing else in the tree has
 * this element as a child or a grandchild.
 */
const STYLE = `
.dsh-web-star{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:0 0 calc(100% + 8px);
 width:calc(100% + 8px);height:34px;margin:4px -4px;padding:6px 2px 6px 10px;border-radius:12px;
 color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:14px;line-height:22px;
 text-decoration:none;cursor:pointer;overflow:hidden}
.dsh-web-star:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-web-star-icon{flex:none}
.dsh-web-star-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-web-star-count{flex:none;margin-left:auto;padding-right:6px;font-size:12px;line-height:16px;
 font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-web-star[data-rail]{flex:0 0 36px;justify-content:center;gap:0;width:36px;height:36px;
 margin:4px 0;padding:0;border-radius:50%}
:has(> .dsh-web-star),:has(> * > .dsh-web-star){flex-wrap:wrap}
`

/** Services this half waits for. */
export const inject = ['slots']

/**
 * Mount the browser half.
 * @param ctx - the client plugin's context.
 */
export function apply(ctx: Context): void {
  if (document.getElementById('dsh-web-star-chrome') === null) {
    const style = document.createElement('style')
    style.id = 'dsh-web-star-chrome'
    style.textContent = STYLE
    document.head.append(style)
  }

  const slots = ctx.get('slots') as {
    inject(name: string, factory: () => unknown): void
    register(options: { name: string, id: string, order?: number, label?: string }, component: unknown): unknown
  } | undefined
  if (slots === undefined) return

  // Last among the foot actions: the terminal and the plugin panel are things
  // the visitor came to use, and this is a thing being asked of them.
  slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: 'web-star', order: 100, label: 'Star on GitHub' },
    StarAction,
  ))
}

export default { apply, inject }
