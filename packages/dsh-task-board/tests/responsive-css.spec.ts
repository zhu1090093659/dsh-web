/**
 * Constrained-layout guard: the board must preserve readable columns and let
 * the board scroll horizontally instead of compressing cards into slivers.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/board.module.css', import.meta.url), 'utf8')

describe('board responsive css', () => {
  it('keeps the columns container horizontally scrollable', () => {
    const columnsBlock = css.match(/\.columns\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(columnsBlock).toContain('overflow-x: auto')
    expect(columnsBlock).toContain('overflow-y: hidden')
  })

  it('preserves a readable minimum width for every rendered column', () => {
    const columnsBlock = css.match(/\.columns\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(columnsBlock).toContain('grid-auto-flow: column')
    expect(columnsBlock).toContain('grid-auto-columns: minmax(220px, 1fr)')
  })

  it('renders a visible horizontal scrollbar affordance', () => {
    expect(css).toMatch(/\.columns::-webkit-scrollbar\s*\{[^}]*height:\s*10px/s)
    expect(css).toMatch(/\.columns::-webkit-scrollbar-track\s*\{[^}]*background:/s)
    expect(css).toMatch(/\.columns::-webkit-scrollbar-thumb\s*\{[^}]*background:/s)
    expect(css).toContain('scrollbar-width: thin')
  })

  it('keeps the bottom scrollbar inside the board viewport', () => {
    const boardBlock = css.match(/\.board\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(boardBlock).toContain('box-sizing: border-box')
    expect(boardBlock).toContain('height: 100%')
  })

  it('responds to the board container rather than only the viewport', () => {
    expect(css).toMatch(/\[data-dsh-taskboard-view\]\s*\{[^}]*container-name:\s*task-board-view/s)
    expect(css).toContain('@container task-board-view (max-width: 768px)')
    expect(css).toContain('@container task-board-view (max-width: 720px)')
    expect(css).toContain('@container task-board-view (max-width: 600px)')
    expect(css).toMatch(/\.boardHeader\s*\{[^}]*flex-wrap:\s*wrap/s)
    expect(css).toMatch(/\.search\s*\{[^}]*flex:\s*1 0 100%/s)
  })

  it('turns phone columns into one-card-per-swipe snap points', () => {
    expect(css).toMatch(/@container task-board-view \(max-width: 768px\)[\s\S]*?\.columns\s*\{[^}]*grid-auto-columns:\s*86cqw/s)
    expect(css).toMatch(/@container task-board-view \(max-width: 768px\)[\s\S]*?\.columns\s*\{[^}]*scroll-snap-type:\s*inline mandatory/s)
    expect(css).toMatch(/\.column\s*\{[^}]*scroll-snap-align:\s*start[^}]*scroll-snap-stop:\s*always/s)
  })

  it('uses the dynamic viewport and safe areas for phone overlays', () => {
    expect(css).toContain('@media (max-width: 768px)')
    expect(css).toMatch(/\.modalBackdrop\s*\{[^}]*height:\s*100dvh/s)
    expect(css).toMatch(/\.modal,\s*\.detail\s*\{[^}]*height:\s*100dvh[^}]*max-height:\s*none/s)
    expect(css).toContain('env(safe-area-inset-top)')
    expect(css).toContain('env(safe-area-inset-bottom)')
  })

  it('keeps phone actions reachable with touch-sized controls', () => {
    expect(css).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.primaryButton,[\s\S]*?\.scheduleToggle\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.modalFooter\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/s)
    expect(css).toMatch(/\.detailFooter\s*\{[^}]*flex-wrap:\s*wrap/s)
  })
})

describe('task form regions (create/edit dialogs)', () => {
  it('user opening a task dialog gets a shell that itself never scrolls', () => {
    // Given the task board stylesheet
    // When a task dialog shell renders its body
    const modal = css.match(/^\.modal\s*\{([^}]*)\}/m)?.[1] ?? ''
    const body = css.match(/^\.modalBody\s*\{([^}]*)\}/m)?.[1] ?? ''

    // Then the shell keeps its height fixed and only the body owns the fallback
    expect(modal).toContain('overflow: hidden')
    expect(modal).toContain('max-height: calc(100vh - 96px)')
    expect(body).toContain('overflow-y: auto')
    expect(body).toContain('min-height: 0')
  })

  it('user expanding a region gets a chevron drawn from borders rather than a glyph', () => {
    // Given the task board stylesheet
    // When a form region renders its header
    const chevron = css.match(/^\.formSectionChevron\s*\{([^}]*)\}/m)?.[1] ?? ''

    // Then the chevron is drawn with borders and rotated when the region opens
    expect(chevron).toContain('border-left: 5px solid')
    expect(css).toMatch(/\.formSection\[data-open='true'\] \.formSectionChevron\s*\{[^}]*transform: rotate\(90deg\)/s)
  })
})


describe('task detail panel layout and type hierarchy', () => {
  /** The detail view's own stylesheet region (layout, rows, badges, footer). */
  const detailRegion = css.slice(
    css.indexOf('/* --- detail ---'),
    css.indexOf('/* --- constrained board containers ---'),
  )

  it('user on a wide viewport reads the card in two columns on one baseline', () => {
    // Given the detail region of the stylesheet
    // When the viewport can carry two reading tracks
    // Then the panel is wide enough for them and splits on one start line
    expect(detailRegion).toMatch(/\.detail \{[^}]*width: min\(960px, calc\(100vw - 48px\)\)/s)
    expect(detailRegion).toMatch(/\.detailColumns \{[^}]*align-items: start/s)
    expect(detailRegion).toMatch(/@media \(min-width: 1024px\) \{\s*\.detailColumns \{\s*grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, 0\.85fr\);\s*\}\s*\}/)
  })

  it('user on a phone falls back to one column with an 8px spacing rhythm', () => {
    // Given the phone treatment of the overlay
    const phone = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('* Polish pass'))

    // When the viewport is too narrow to carry two tracks
    // Then the grid collapses to one column and the panel keeps one rhythm of
    // 8px multiples on both tracks
    expect(phone).toMatch(/\.detailColumns \{[^}]*grid-template-columns: minmax\(0, 1fr\)/s)
    expect(phone).toMatch(/\.detailColumn \{[^}]*gap: 16px/s)
    expect(detailRegion).toMatch(/\.detailColumn \{[^}]*gap: 16px/s)
    expect(detailRegion).toMatch(/\.detailSection \{[^}]*gap: 8px/s)
  })

  it('user reading the panel never meets an 11px label, because the view has three sizes', () => {
    // Given every declared font size in the detail region
    const sizes = [...detailRegion.matchAll(/font-size:\s*([0-9.]+px)/g)].map(match => match[1])

    // When the panel paints its labels and body copy
    // Then none of them is 11px, and the view stays inside the three-step
    // budget of 15 title / 13 body / 12 meta
    expect(sizes).not.toContain('11px')
    expect(new Set(sizes)).toEqual(new Set(['12px', '13px', '15px']))
  })

  it('user scanning execution rows sees one filled badge slot per outcome', () => {
    // Given the badge rules of the history
    const base = detailRegion.match(/^\.executionBadge \{([^}]*)\}/m)?.[1] ?? ''
    const succeeded = detailRegion.match(/\.executionBadge\[data-result='succeeded'\] \{([^}]*)\}/)?.[1] ?? ''
    const failed = detailRegion.match(/\.executionBadge\[data-result='failed'\] \{([^}]*)\}/)?.[1] ?? ''
    const cancelled = detailRegion.match(/\.executionBadge\[data-result='cancelled'\] \{([^}]*)\}/)?.[1] ?? ''

    // When each outcome paints its badge
    // Then every outcome paints a surface of its own instead of mixing a filled
    // running badge with unfilled settled ones
    for (const rules of [base, succeeded, failed, cancelled]) {
      expect(rules).toContain('background: var(--dsw-alias-')
      expect(rules).not.toContain('background: transparent')
    }
    expect(base).toContain('var(--dsw-alias-state-warn-secondary)')
    expect(succeeded).toContain('var(--dsw-alias-state-success-secondary)')
    expect(failed).toContain('var(--dsw-alias-state-error-secondary)')
  })

  it('user in any theme sees tokens only, never a literal colour', () => {
    // Given the detail region the redesign owns
    // When a skin or a light/dark switch resolves the panel
    // Then no literal colour is written, so every theme keeps working by
    // construction
    expect(detailRegion).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(detailRegion).not.toMatch(/\b(rgba?|hsla?|oklch|lab)\(/)
  })

  it('user folding history or acceptance sees the same motion reversed, and only a fade under reduced motion', () => {
    // Given the two folded regions of the panel
    // When either one opens or closes
    // Then both legs exist on the same travel...
    expect(detailRegion).toMatch(/\.executionExtra,[\s\S]{0,200}?animation: dshTbRowsIn var\(--dsh-tb-motion-enter\)/s)
    expect(detailRegion).toMatch(/\.executionExtra\[data-execution-fold='closing'\],[\s\S]{0,240}?animation: dshTbRowsOut var\(--dsh-tb-motion-close\)/s)
    // The panel's own folds (advanced settings, schedule, history) ride the
    // same pair instead of a third disclosure style
    expect(detailRegion).toMatch(/\.detailBody \.formSectionBody \{[^}]*animation: dshTbRowsIn/s)
    expect(detailRegion).toMatch(/\.detailBody \.formSectionBody\[data-state='closing'\] \{[^}]*animation: dshTbRowsOut/s)
    expect(detailRegion).toMatch(/@keyframes dshTbRowsIn \{\s*from \{ opacity: 0; transform: translateY\(-6px\); \}\s*to \{ opacity: 1; transform: translateY\(0\); \}/)
    expect(detailRegion).toMatch(/@keyframes dshTbRowsOut \{\s*from \{ opacity: 1; transform: translateY\(0\); \}\s*to \{ opacity: 0; transform: translateY\(-6px\); \}/)
    // ...and the reduced-motion path keeps the fade while dropping the travel
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.executionExtra,[\s\S]{0,160}?animation: dshTbFadeIn/s)
    expect(reduced).toMatch(/\.executionExtra\[data-execution-fold='closing'\],[\s\S]{0,220}?animation: dshTbFadeOut/s)
  })
})

describe('task board columns and cards share the panel visual contract', () => {
  /** One rule body of the stylesheet, by exact selector. */
  const block = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return css.match(new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^}]*)\\}', 'm'))?.[1] ?? ''
  }
  /** The board frame through the cards: the surface this phase owns. */
  const surface = css.slice(css.indexOf('/* --- board frame ---'), css.indexOf('/* --- buttons ---'))

  it('user reading a column or a card never meets an 11px label, because the surface has three sizes', () => {
    // Given every declared font size on the board frame, its columns and its cards
    const sizes = [...surface.matchAll(/font-size:\s*([0-9.]+px)/g)].map(match => match[1])

    // When a column header, a card title, its excerpt and its meta line paint
    // Then none is 11px and the surface stays inside 15 title / 13 body / 12 meta
    expect(sizes).not.toContain('11px')
    expect(new Set(sizes)).toEqual(new Set(['12px', '13px', '15px']))

    // The label chips are painted from their own section of the stylesheet.
    for (const selector of ['.cardTag', '.tagFilterLabel', '.tagChip']) {
      expect(block(selector), selector).toContain('font-size: 12px')
    }
  })

  it('user scanning a column sees the card left edge under the header content box, on one shared rail', () => {
    // Given the column header and the cards container
    const header = block('.columnHeader')
    const cards = block('.cards')

    // When both lay out inside one column
    // Then each inset reads the column's rail token instead of a pixel value,
    // and the header keeps one height with and without the density switch
    expect(header).toContain('padding: 8px var(--dsh-tb-rail)')
    expect(header).toContain('min-height: calc(var(--dsh-tb-card-row) + 18px)')
    expect(cards).toContain('padding: 2px var(--dsh-tb-rail) 10px')
    // The rail is declared once on the board root, so the columns, the filter
    // row and the panel's label list all resolve the same value
    expect(block('.board')).toContain('--dsh-tb-rail: 12px')
    expect(block('.cardGroupHeader')).toContain('padding: 4px 0 0')
  })

  it('user sees every card element on one content track, because the card is a two-track grid', () => {
    // Given the card and its outcome stripe
    const card = block('.card')
    const stripe = block('.card::before')

    // When a card paints its stripe, title row, excerpt, meta line, labels and actions
    // Then the stripe owns the first track and one placement rule puts every
    // child on the second, so no element can drift off the rail
    expect(card).toContain('grid-template-columns: var(--dsh-tb-card-stripe) minmax(0, 1fr)')
    expect(card).toContain('column-gap: var(--dsh-tb-card-inset)')
    expect(card).toContain('align-content: start')
    expect(stripe).toContain('width: var(--dsh-tb-card-stripe)')
    expect(block('.card > :not(.cardOpen)')).toContain('grid-column: 2')
    // Compact density changes the rhythm only; the track geometry stays.
    expect(block('.card[data-compact]')).not.toMatch(/(?:^|\s)gap:/)
  })

  it('user hovering, focusing or following a run never sees the card resize', () => {
    // Given the card's state and interaction rules
    const stateRules = [
      '.card:hover',
      '.card:active',
      ".card[data-status='running']",
      '.cardOpen:focus-visible',
      '.cardAction:focus-visible',
      '.densityToggle:focus-visible',
      '.tagChip:focus-visible',
    ]

    // When each state paints
    // Then only paint properties change: a state rule never re-declares a box
    // size, a padding, a gap or a type size
    for (const selector of stateRules) {
      const rules = block(selector)
      expect(rules, selector).not.toBe('')
      expect(rules, selector).not.toMatch(/(?:^|[\s;])(padding|font-size|height|min-height|line-height|border-width|gap|row-gap|column-gap|margin):/)
    }
  })

  it('user sees the spinner, the result badge and the stamp inside reserved slots, so a state change cannot move the card', () => {
    // Given the card's rows and every transient box on them
    // When a card paints its status, its result badge or a running stamp
    // Then each row reserves one slot height and every box inside takes it
    expect(block('.cardMeta')).toContain('min-height: var(--dsh-tb-card-row)')
    expect(block('.cardStatus')).toContain('min-height: var(--dsh-tb-card-row)')
    expect(block('.cardStatus')).toContain('font-size: 12px')
    expect(block('.cardResult')).toContain('line-height: var(--dsh-tb-card-row)')
    expect(block('.cardSchedule')).toContain('height: var(--dsh-tb-card-row)')
    expect(block('.cardSubtask')).toContain('line-height: var(--dsh-tb-card-row)')
    expect(block('.cardSession')).toContain('height: var(--dsh-tb-card-row)')
    expect(block('.cardSpinnerSlot')).toContain('width: var(--dsh-tb-card-row)')
    expect(block('.cardSpinnerSlot')).toContain('height: var(--dsh-tb-card-row)')
    // The stamp keeps its width while it ticks.
    expect(block('.cardTime')).toContain('font-variant-numeric: tabular-nums')
    // An empty label list paints no row at all.
    expect(block('.cardTags:empty')).toContain('display: none')
    // Compact density keeps its own tighter row rhythm.
    expect(block('.card[data-compact]')).toContain('row-gap: 2px')
  })

  it('user scanning outcomes sees one filled badge slot per result, painted from tokens only', () => {
    // Given the card's result badge and its lineage badge
    const base = block('.cardResult')
    const succeeded = block(".cardResult[data-result='succeeded']")
    const failed = block(".cardResult[data-result='failed']")
    const cancelled = block(".cardResult[data-result='cancelled']")

    // When each outcome paints
    // Then every outcome paints a surface of its own, read from the same state
    // slots the detail panel's execution badge uses
    for (const rules of [base, succeeded, failed, cancelled]) {
      expect(rules).toContain('background: var(--dsw-alias-')
      expect(rules).not.toContain('background: transparent')
      expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(rules).not.toMatch(/\b(rgba?|hsla?|oklch|lab)\(/)
    }
    expect(base).toContain('var(--dsw-alias-state-warn-secondary)')
    expect(base).toContain('var(--dsw-alias-state-warn-primary)')
    expect(succeeded).toContain('var(--dsw-alias-state-success-secondary)')
    expect(failed).toContain('var(--dsw-alias-state-error-secondary)')
    expect(block(".cardSubtask[data-tone='failed']")).toContain('var(--dsw-alias-state-error-secondary)')
    expect(block(".cardSubtask[data-tone='running']")).toContain('var(--dsw-alias-state-warn-secondary)')
    expect(block(".cardSubtask[data-tone='done']")).toContain('var(--dsw-alias-state-success-secondary)')
    // The card surface itself writes no literal colour.
    expect(surface).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('user reaching a quick action, the density switch or a label chip gets a 44px pointer target', () => {
    // Given the board's hit-size token
    expect(block('.board')).toContain('--dsh-tb-hit-size: 44px')

    // When a card quick action, a column density switch or a filter chip is pointer-reached
    // Then each expands its target to that token instead of growing its visible box
    for (const selector of ['.cardAction::after', '.densityToggle::after', '.tagChip::after']) {
      expect(block(selector), selector).toContain('width: var(--dsh-tb-hit-size)')
      expect(block(selector), selector).toContain('height: var(--dsh-tb-hit-size)')
    }
    for (const selector of ['.cardAction', '.densityToggle', '.tagChip']) {
      expect(block(selector), selector).toContain('position: relative')
    }
  })
})

describe('task detail panel fold rhythm and summary track', () => {
  /** One rule body of the stylesheet, by exact selector. */
  const block = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return css.match(new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^}]*)\\}', 'm'))?.[1] ?? ''
  }
  const px = (body: string, property: string): number =>
    Number(body.match(new RegExp(property + ':\\s*(-?[0-9.]+)px'))?.[1])

  it('user reading three closed folds sees them on a 38px pitch instead of a 58px one', () => {
    // Given the fold group's gap, the section rhythm around it and the fold row
    const groupGap = px(block('.detailFolds'), 'gap')
    const sectionGap = px(block('.detailColumn'), 'gap')
    const rowBox = px(block('.detailBody .formSectionHeader'), 'min-height')
      + (/border:\s*1px solid/.test(block('.formSection')) ? 2 : 0)

    // When two folds sit next to each other
    // Then the whitespace between the rows and the row pitch are the tight ones
    expect(rowBox).toBeLessThanOrEqual(30)
    expect(groupGap).toBeLessThanOrEqual(12)
    expect(rowBox + groupGap).toBeLessThanOrEqual(44)

    // And the blocks around the group keep the panel's 16..20px section rhythm
    expect(sectionGap).toBeGreaterThanOrEqual(16)
    expect(sectionGap).toBeLessThanOrEqual(20)
  })

  it('user pointer-reaching a fold row still gets the board 44px target', () => {
    // Given the fold header and the board's hit-size token
    expect(block('.board')).toContain('--dsh-tb-hit-size: 44px')
    expect(block('.detailBody .formSectionHeader')).toContain('position: relative')

    // When the row is reached
    // Then the target expands to the same token a card quick action uses
    const target = block('.detailBody .formSectionHeader::after')
    expect(target).toContain('width: var(--dsh-tb-hit-size)')
    expect(target).toContain('height: var(--dsh-tb-hit-size)')

    // And a target that overflows the row is not clipped away by the section
    expect(block('.detailBody .formSection')).toContain('overflow: visible')
  })

  it('user reading three fold summaries sees them end on the panel one right track', () => {
    // Given the panel's own title and summary rules
    const title = block('.detailBody .formSectionTitle')
    const summary = block('.detailBody .formSectionSummary')

    // When a summary needs the room the label would otherwise take
    // Then both boxes shrink, so the label never pushes the summary off the row
    expect(title).toContain('flex: 0 1 auto')
    expect(title).toContain('min-width: 0')
    expect(summary).toContain('flex: 0 1 auto')
    expect(summary).toContain('min-width: 0')

    // And the summary's auto margin is what holds every row's line on one track
    expect(summary).toContain('margin-left: auto')

    // And what does not fit ellipsizes inside the row, never at the panel edge
    expect(title).toContain('text-overflow: ellipsis')
    expect(block('.formSectionSummary')).toContain('text-overflow: ellipsis')
    expect(block('.formSectionSummary')).toContain('white-space: nowrap')

    // The row is border-box, so 100% width plus its padding cannot spill out
    expect(block('.detailBody .formSectionHeader')).toContain('box-sizing: border-box')
  })

  it('user filling a task dialog reads the dialog spacing rhythm beside the panel folds', () => {
    // Given the region contract the dialogs share with the panel
    // When a dialog paints its fields and its folded regions
    // Then the rhythm around the regions is the dialog's own
    expect(block('.formSectionBody')).toContain('padding: 8px 10px 10px')
    expect(block('.modalBody')).toContain('gap: 8px')
  })
})

describe('task form dialogs speak the panel fold contract on one type scale', () => {
  /** One rule body of the stylesheet, by exact selector. */
  const block = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return css.match(new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^}]*)\\}', 'm'))?.[1] ?? ''
  }
  /** The dialog region of the stylesheet: the shell and every field in it. */
  const dialogRegion = css.slice(css.indexOf('/* --- modals ---'), css.indexOf('/* --- detail ---'))

  it('user reading any task dialog stays inside 16 title / 13 body / 12 meta', () => {
    // Given every declared font size in the dialog region
    const sizes = [...dialogRegion.matchAll(/font-size:\s*([0-9.]+px)/g)].map(match => match[1])

    // When the dialog paints its title, its fields and its label rows
    // Then no size falls outside the three-step budget
    expect(new Set(sizes)).toEqual(new Set(['12px', '13px', '16px']))

    // The hint line shares the budget although its rule lives with the label
    // chips it is painted from.
    expect(block('.fieldHint')).toContain('font-size: 12px')
  })

  it('user never meets an 11px or 12.5px label anywhere in the stylesheet', () => {
    // Given the whole task board stylesheet
    // When any label, hint or meta line paints
    // Then neither retired size is declared anywhere
    expect(css).not.toMatch(/font-size:\s*11px/)
    expect(css).not.toMatch(/font-size:\s*12\.5px/)
  })

  it('user collapsing a task form region gets the panel fold row contract', () => {
    // Given the dialog's region row and the rules the panel's folds use
    // When the row paints its label, its summary and its chevron
    const header = block('.formSectionHeader')
    const title = block('.formSectionTitle')
    const summary = block('.formSectionSummary')

    // Then the row is a 12px header on the dialog's control height
    expect(header).toContain('font-size: 12px')
    expect(header).toContain('min-height: 28px')
    expect(header).toContain('box-sizing: border-box')

    // And the label shrinks and ellipsizes while the summary rides the one
    // right-hand track, so a long preview never takes the row
    expect(title).toContain('flex: 0 1 auto')
    expect(title).toContain('min-width: 0')
    expect(title).toContain('text-overflow: ellipsis')
    expect(summary).toContain('flex: 0 1 auto')
    expect(summary).toContain('margin-left: auto')
    expect(summary).toContain('text-overflow: ellipsis')

    // And the chevron and the open state stay the panel's own rules
    expect(block('.formSectionChevron')).toContain('border-left: 5px solid')
    expect(css).toMatch(/\.formSection\[data-open='true'\] \.formSectionChevron\s*\{[^}]*transform: rotate\(90deg\)/s)
  })

  it('user pointer-reaching a collapsed region gets the board 44px target', () => {
    // Given the dialog region row and the board's hit-size token
    expect(block('.board')).toContain('--dsh-tb-hit-size: 44px')
    expect(block('.formSectionHeader')).toContain('position: relative')

    // When the row is reached
    // Then the target expands past the row exactly like the panel's fold row
    const target = block('.formSectionHeader::after')
    expect(target).toContain('width: var(--dsh-tb-hit-size)')
    expect(target).toContain('height: var(--dsh-tb-hit-size)')

    // And a target that overflows the row is not clipped away by the section,
    // which hands the header the section's inner radius instead
    expect(block('.formSection')).toContain('overflow: visible')
    expect(block('.formSectionHeader')).toContain('border-radius: 9px')
  })

  it('user opening a task dialog reads one title size and one meta size', () => {
    // Given the dialog's title, its confirmation copy and the label manager rows
    // When a dialog or a label row paints
    // Then the title takes the 16px step and every meta line the 12px one
    expect(block('.modalTitle')).toContain('font-size: 16px')
    expect(block('.confirmMessage')).toContain('font-size: 13px')
    expect(block('.tagManageName')).toContain('font-size: 13px')
    expect(block('.tagManageCount')).toContain('font-size: 12px')
    expect(block('.tagManageMerge')).toContain('font-size: 12px')
  })
})

describe('task markdown renderer speaks one three-step scale', () => {
  /** The renderer's own stylesheet: the detail panel's description and prompt body. */
  const markdownCss = readFileSync(new URL('../src/client/board/task-markdown.module.css', import.meta.url), 'utf8')

  /** Every rule body of the renderer stylesheet under one exact selector. */
  const rules = (selector: string): string[] => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^}]*)\\}', 'gm')
    return [...markdownCss.matchAll(pattern)].map(match => match[1])
  }
  /**
   * One rule body by exact selector. The first match is the one that carries
   * the property the caller reads, because a selector can also be the last
   * entry of a shared list (h6 closes the heading list).
   */
  const block = (selector: string, property = 'font-size'): string =>
    rules(selector).find(body => body.includes(property + ':')) ?? rules(selector)[0] ?? ''
  /** One declaration of a rule body, or undefined when the rule leaves it to a shared block. */
  const declaration = (body: string, property: string): string | undefined =>
    body.match(new RegExp('(?:^|[\\s;])' + property + ':\\s*([^;]+);'))?.[1]?.trim()

  it('user reading a task description meets three sizes only, never a seven-rung ladder', () => {
    // Given every font size the renderer declares
    const sizes = [...markdownCss.matchAll(/font-size:\s*([0-9.]+px)/g)].map(match => match[1])

    // When a description or a prompt renders inside the detail panel
    // Then the scale is the panel's own three steps: 16 headline, 13 body, 12 meta
    expect(new Set(sizes)).toEqual(new Set(['12px', '13px', '16px']))

    // And the retired sizes are gone from the file rather than left behind
    for (const retired of ['11px', '12.5px', '14px', '15px']) {
      expect(markdownCss, retired).not.toMatch(new RegExp('font-size:\\s*' + retired.replace('.', '\\.')))
    }
  })

  it('user scanning h1-h6 sees two sizes, and the levels below them split by weight and colour', () => {
    // Given the six heading rules and the block they inherit from
    const headings = [1, 2, 3, 4, 5, 6].map(depth => block(`.heading${depth}`))
    const shared = markdownCss.match(/\.heading1,[\s\S]*?\{([^}]*)\}/)?.[1] ?? ''
    const size = (body: string): string | undefined => declaration(body, 'font-size')
    const weight = (body: string): string | undefined => declaration(body, 'font-weight')
    const colour = (body: string): string | undefined => declaration(body, 'color')

    // When every depth paints
    // Then the two top levels are the 16px step...
    expect(headings.slice(0, 2).map(size)).toEqual(['16px', '16px'])
    // ...and h3-h6 stay on the body's own 13px instead of opening a new step
    expect(headings.slice(2).map(size)).toEqual(['13px', '13px', '13px', '13px'])
    expect(size(block('.markdownRoot'))).toBe('13px')

    // And the levels the ladder used to separate by size split by weight...
    expect(headings.map(weight)).toEqual(['700', '600', '600', '600', '500', '500'])
    expect(shared).toContain('color: var(--dsw-alias-label-primary)')
    // ...and the deep levels take the secondary and tertiary label roles, so
    // nothing below h3 needs a fourth size to read as deeper
    expect(colour(headings[2])).toBeUndefined()
    expect(colour(headings[3])).toBe('var(--dsw-alias-label-secondary)')
    expect(colour(headings[4])).toBe('var(--dsw-alias-label-secondary)')
    expect(colour(headings[5])).toBe('var(--dsw-alias-label-tertiary)')
  })
})

describe('task dialog folds ride the panel fold motion pair', () => {
  /** The detail region, where the one disclosure pair is declared. */
  const detailRegion = css.slice(
    css.indexOf('/* --- detail ---'),
    css.indexOf('/* --- constrained board containers ---'),
  )

  /** The rule body of one selector inside a slice that carries an animation. */
  const animatedRule = (source: string, selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp('(?:^|\\n)[ \\t]*' + escaped + '\\s*\\{([^}]*)\\}', 'gm')
    return [...source.matchAll(pattern)].map(match => match[1]).find(body => body.includes('animation:')) ?? ''
  }
  /** The animation shorthand one rule declares. */
  const animationOf = (body: string): string => body.match(/animation:\s*([^;]+);/)?.[1]?.trim() ?? ''

  it('user folding a dialog region gets the panel pair instead of a third disclosure style', () => {
    // Given the panel's fold body and the dialog's fold body
    const panelIn = animatedRule(detailRegion, '.detailBody .formSectionBody')
    const panelOut = animatedRule(detailRegion, ".detailBody .formSectionBody[data-state='closing']")
    const dialogIn = animatedRule(css, '.formSectionBody')
    const dialogOut = animatedRule(css, ".formSectionBody[data-state='closing']")

    // When either surface opens or closes
    // Then the entry legs are one animation on one travel and one duration token
    expect(animationOf(panelIn)).toBe('dshTbRowsIn var(--dsh-tb-motion-enter) var(--dsh-tb-ease) both')
    expect(animationOf(dialogIn)).toBe(animationOf(panelIn))
    // And the exit legs are the reverse of that same pair
    expect(animationOf(panelOut)).toBe('dshTbRowsOut var(--dsh-tb-motion-close) var(--dsh-tb-ease) both')
    expect(animationOf(dialogOut)).toBe(animationOf(panelOut))

    // And the pair stays the one keyframe pair the stylesheet declares
    expect(css.match(/@keyframes dshTbRowsIn \{/g)).toHaveLength(1)
    expect(css.match(/@keyframes dshTbRowsOut \{/g)).toHaveLength(1)
    expect(css).toMatch(/@keyframes dshTbRowsIn \{\s*from \{ opacity: 0; transform: translateY\(-6px\); \}/)
    expect(css).toMatch(/@keyframes dshTbRowsOut \{\s*from \{ opacity: 1; transform: translateY\(0\); \}/)
  })

  it('user with reduced motion sees both folds fade only, and unmount waits the close duration', () => {
    // Given the reduced-motion block the pair degrades to
    const reduced = detailRegion.slice(detailRegion.indexOf('@media (prefers-reduced-motion: reduce)'))
    const panelIn = animatedRule(reduced, '.detailBody .formSectionBody')
    const panelOut = animatedRule(reduced, ".detailBody .formSectionBody[data-state='closing']")
    const dialogIn = animatedRule(reduced, '.formSectionBody')
    const dialogOut = animatedRule(reduced, ".formSectionBody[data-state='closing']")

    // When either fold opens or closes without motion
    // Then both keep the same opacity-only fade...
    expect(animationOf(panelIn)).toBe('dshTbFadeIn var(--dsh-tb-motion-close) linear both')
    expect(animationOf(dialogIn)).toBe(animationOf(panelIn))
    expect(animationOf(panelOut)).toBe('dshTbFadeOut var(--dsh-tb-motion-close) linear both')
    expect(animationOf(dialogOut)).toBe(animationOf(panelOut))
    // ...and the dialog's exit leg still runs on the close duration the
    // presence timer waits on, since only the travel was dropped
    expect(animationOf(dialogOut)).toContain('var(--dsh-tb-motion-close)')
    expect(css).toMatch(/--dsh-tb-motion-close:\s*140ms/)
    expect(animationOf(dialogOut)).not.toContain('translateY')
  })
})
