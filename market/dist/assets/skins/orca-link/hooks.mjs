
/**
 * ORCA LINK (orca-link) skin hooks — the trusted escape hatch of the v2 skin
 * contract (x-org.linxin666.skin-center/v1alpha1), reviewed and released with
 * this repository. Loading this module executes nothing; apply() owns every
 * DOM write and registers its retraction through ctx.onCleanup.
 *
 * Port of the v1 plugin effects (Small-tailqwq/dsh-deep-whale orca-link):
 *  - the scene controller (hero/active background crossfade),
 *  - the status-character actor in the sidebar art stage (8x10 atlas),
 *  - the link state projecting onto the sidebar signal chip,
 *  - the hero headline typewriter,
 *  - the composer motion (scroll-intent show/hide + hero exit ghost),
 *  - the composer collapse (drag handles, restore button, inert),
 *  - the icon redraw (rectilinear art over ~90 host glyphs),
 *  - the pricing traffic light (Beijing UTC+8 peak windows),
 *  - the terminal/AppFrame transition width locks,
 *  - the sidebar width sync, the window-resume tooltip suppression,
 *  - the settings/cordis overlay attributes and the rail-search completion.
 * Artwork ships as files under assets/ and is referenced through
 * ctx.assetBase; the v1 body inline style variables keep the same names.
 * The v1 body-scope attribute (body[data-dsh-orca-link]) is still written so
 * the migrated stylesheet rules that are anchored on it keep matching; the
 * loader-owned scope is html[data-dsh-skin="orca-link"].
 *
 * v2 contract note: the v1 customization panel (character/background/pricing
 * toggles and the SFW visibility schedule) had no v2 surface — every feature
 * ships on. The CSS anchors (body[data-dsh-whale-orca-*="hidden"]) are kept
 * for a future settings surface but are never written by this activation.
 */

const SKIN_TITLE = 'ORCA LINK · DSH'

const SKIN_OWNER = 'orca-link'

const CH = {
  darkScene: 'orca-ch-darkScene',
  darkSceneActive: 'orca-ch-darkSceneActive',
  darkSceneHero: 'orca-ch-darkSceneHero',
  darkSceneLayer: 'orca-ch-darkSceneLayer',
  dshWordmark: 'orca-ch-dshWordmark',
  lightScene: 'orca-ch-lightScene',
  lightSceneActive: 'orca-ch-lightSceneActive',
  lightSceneHero: 'orca-ch-lightSceneHero',
  lightSceneLayer: 'orca-ch-lightSceneLayer',
  pricingHousing: 'orca-ch-pricingHousing',
  pricingLabel: 'orca-ch-pricingLabel',
  pricingLamp: 'orca-ch-pricingLamp',
  pricingLampAmber: 'orca-ch-pricingLampAmber',
  pricingLampGreen: 'orca-ch-pricingLampGreen',
  pricingLampRed: 'orca-ch-pricingLampRed',
  pricingLight: 'orca-ch-pricingLight',
  pricingTooltip: 'orca-ch-pricingTooltip',
  pricingTooltipKey: 'orca-ch-pricingTooltipKey',
  pricingTooltipRow: 'orca-ch-pricingTooltipRow',
  pricingTooltipTitle: 'orca-ch-pricingTooltipTitle',
  pricingTooltipValue: 'orca-ch-pricingTooltipValue',
  signalChip: 'orca-ch-signalChip',
  signalChipLabel: 'orca-ch-signalChipLabel',
  signalDot: 'orca-ch-signalDot',
  spine: 'orca-ch-spine',
  standby: 'orca-ch-standby',
  standbyCopy: '',
  standbyLine: 'orca-ch-standbyLine',
  statusCharacter: 'orca-ch-statusCharacter',
  statusCharacterBubble: 'orca-ch-statusCharacterBubble',
  statusCharacterFrame: 'orca-ch-statusCharacterFrame',
  statusCharacterSprite: 'orca-ch-statusCharacterSprite',
}

const ART = {
  statusAtlas: 'orca-link-status-atlas.webp',
  lightHero: 'orca-link-light-hero.webp',
  lightActive: 'orca-link-light-active.webp',
  darkHero: 'orca-link-dark-hero.webp',
  darkActive: 'orca-link-dark-active.webp',
}

const LIGHT_HERO_ART_PROPERTY = '--orca-link-light-hero-art'
const LIGHT_ACTIVE_ART_PROPERTY = '--orca-link-light-active-art'
const DARK_HERO_ART_PROPERTY = '--orca-link-dark-hero-art'
const DARK_ACTIVE_ART_PROPERTY = '--orca-link-dark-active-art'
const SIDEBAR_WIDTH_PROPERTY = '--orca-sidebar-width'
const SIDEBAR_ART_WIDTH_PROPERTY = '--orca-sidebar-art-width'
const SIDEBAR_WIDE_ATTRIBUTE = 'data-orca-sidebar-wide'
const SCENE_ATTRIBUTE = 'data-orca-scene'
const BODY_SKIN_ATTRIBUTE = 'data-dsh-orca-link'
const APP_FRAME_SELECTOR = "[id='root'] > div[data-slot='root'] > div"
const SIDEBAR_PANE_SELECTOR = "[data-slot='sidebar'] > :first-child"
const SIDEBAR_LOGO_ROW_SELECTOR = "[data-slot='sidebar'] > :first-child > :first-child"
const CONVERSATION_SCROLL_SELECTOR = '[data-conversation-scroll]'
const CHAT_FLOW_SELECTOR = '[data-chat-flow]'
const COMPOSER_SEAT_SELECTOR = '[data-composer-seat]'
const COMPOSER_CARD_SELECTOR = '[data-composer-card]'
const HIGH_CHURN_SELECTOR = '.xterm, [data-input-backdrop]'

const FAVICON = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
  '<rect width="64" height="64" fill="#f7f9fc"/>',
  '<path d="M8 18c9 1 15 7 18 16 2-11 8-19 18-24-2 9 1 15 7 19 2-3 4-5 7-6-2 16-12 26-28 27-10 0-18-7-22-18-2-6-5-11-10-14Z" fill="#11151b"/>',
  '<rect x="43" y="26" width="4" height="4" fill="#086cff"/>',
  '</svg>',
].join('')

const DSH_WORDMARK = [
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M4 5H44L57 17V28L44 39H4V5ZM16 14V30H40L46 25V20L40 14H16Z" fill="currentColor"/>',
  '<path d="M70 5H119L110 14H80L76 18H108L118 27L106 39H59L68 30H101L105 26H72L62 17L70 5Z" fill="currentColor"/>',
  '<path d="M125 5H137V18H163V5H175V39H163V27H137V39H125V5Z" fill="currentColor"/>',
].join('')

/* ------------------------------------------------------------------ */
/* Link status resolution (port of link-status.ts)                     */
/* ------------------------------------------------------------------ */

const STATUS_LABELS = {
  standby: 'LINK ACTIVE',
  syncing: 'LINK SYNC',
  working: 'TASK RUNNING',
  approval: 'AUTH REQUEST',
  input: 'INPUT REQUIRED',
  review: 'PLAN REVIEW',
  complete: 'TASK COMPLETE',
  fault: 'LINK FAULT',
  offline: 'LINK OFFLINE',
  ready: 'SESSION READY',
}

const SIGNAL_SELECTOR = '[data-orca-link-signal]'
const SIGNAL_LABEL_SELECTOR = '[data-orca-link-signal-label]'

function conversationRootOf(body) {
  for (const candidate of body.querySelectorAll('[data-phase]')) {
    const scroll = candidate.querySelector('[data-conversation-scroll]')
    if (scroll !== null) return candidate
  }
  return null
}

function lastFlowRow(flow) {
  const rows = Array.from(flow.children).filter((child) => (
    child instanceof HTMLElement && child.hasAttribute('data-chat-flow-kind')
  ))
  return rows.at(-1) ?? null
}

function lastMeaningfulFlowRow(flow) {
  const rows = Array.from(flow.children).filter((child) => (
    child instanceof HTMLElement && child.dataset.chatFlowKind !== undefined
      && child.dataset.chatFlowKind !== 'turn-tail'
  ))
  return rows.at(-1) ?? null
}

function resolveLinkStatus(root) {
  if (root === null) return 'standby'
  const phase = root.dataset.phase ?? ''
  if (phase === 'hero') return 'standby'
  if (phase === 'settling') return 'syncing'
  if (phase !== 'active') return 'ready'

  if (root.querySelector('[data-approval-key]') !== null) return 'approval'
  if (root.querySelector('[data-plan-review-key]') !== null) return 'review'
  if (root.querySelector('[data-question-key]') !== null) return 'input'

  const input = root.querySelector('textarea[data-phase]')
  if (input?.dataset.phase === 'submitting' || input?.dataset.phase === 'adjudicating') return 'syncing'
  if (
    root.querySelector("svg[data-orca-link-icon='stop']") !== null
    || root.querySelector("[data-state='running']") !== null
  ) return 'working'
  if (input?.disabled === true) return 'offline'

  const flow = root.querySelector('[data-chat-flow]')
  if (flow === null) return 'ready'
  const tail = lastFlowRow(flow)
  const meaningful = lastMeaningfulFlowRow(flow)
  if (meaningful?.querySelector("[data-state='error'], [data-state='interrupted']") !== null) return 'fault'
  if (tail?.dataset.chatFlowKind === 'turn-tail') return 'complete'
  return 'ready'
}

/* ------------------------------------------------------------------ */
/* Status character atlas tables (port of status-character.ts)         */
/* ------------------------------------------------------------------ */

const FRAME_INTERVAL_MS_BY_STATUS = {
  standby: 240,
  syncing: 83,
  working: 83,
  approval: 83,
  input: 83,
  review: 83,
  complete: 83,
  fault: 83,
  offline: 83,
  ready: 83,
}

const STATUS_ROWS = {
  standby: 0,
  syncing: 1,
  working: 2,
  approval: 3,
  input: 4,
  review: 5,
  complete: 6,
  fault: 7,
  offline: 8,
  ready: 9,
}

const FRAME_SEQUENCES = {
  standby: [0, 0, 0, 0, 1, 2, 3, 2, 1],
  syncing: [0, 1, 2, 3, 4, 5, 6, 7],
  working: [0, 1, 2, 3, 4, 5, 6, 7],
  approval: [0, 1, 2, 3, 4, 5, 6, 7],
  input: [0, 1, 2, 3, 4, 5, 6, 7],
  review: [0, 1, 2, 3, 4, 5, 6, 7],
  complete: [0, 1, 2, 3, 4, 5, 6, 7],
  fault: [0, 1, 2, 3, 4, 5, 6, 7],
  offline: [0, 1, 2, 3, 4, 5, 6, 7],
  ready: [0, 1, 2, 3, 4, 5, 6, 7],
}

const FRAME_DURATIONS_MS_BY_STATUS = {
  standby: [700, 700, 700, 700, 130, 90, 110, 90, 130],
}

const ONE_SHOT_STATUSES = new Set(['approval', 'input', 'complete', 'fault', 'ready'])

const STATUS_ATLAS_CELL = 236

const STATUS_FRAME_ALIGNMENT = {
  standby: [[0, 0], [5, -0.2], [2.6, 0.1], [0.8, -0.2], [0.9, 2.2], [2.6, 2.1], [2.9, 1.9], [0, 0]],
  syncing: [[-3.5, 1], [-2.9, 0.8], [0.4, 0.6], [1.3, 0.4], [-1.1, 3.9], [-2, 4.2], [0.8, 3.4], [-3.5, 1]],
  working: [[5.4, -1.6], [5, -1.8], [5.5, -1.6], [6.2, -1.7], [5.2, 0.9], [4.5, 0.6], [6.3, 0.4], [5.4, -1.6]],
  approval: [[3.2, -1.8], [2.6, -1.6], [3.3, -0.1], [4.2, 1.3], [4.2, 1.1], [3, 1.1], [3.3, 0.6], [5.3, 1]],
  input: [[9.6, 9.8], [8.8, 9.7], [8.5, 10.7], [8.7, 12.5], [7.3, 12.6], [7.3, 12.4], [8.1, 12.5], [7.3, 12.4]],
  review: [[11.8, -2.5], [5.8, 2], [8.4, 2.1], [9.1, -0.1], [6.4, 1.1], [13.7, 1.8], [10.8, -0.2], [11.8, -2.5]],
  complete: [[1.8, -2.3], [-0.1, -2.7], [-0.9, -2.7], [0.8, -1.3], [10, -2.4], [-1.3, -1.1], [-0.8, -0.8], [8.1, -0.2]],
  fault: [[9.7, -0.8], [10.2, -0.8], [9.7, -0.4], [16.6, -0.2], [12.4, -0.1], [12.8, 0.7], [14.3, -0.7], [11.8, 1.4]],
  offline: [[10.4, -1.8], [9.7, -2], [10, -2], [11.7, -2], [11.1, -1.5], [9.5, -1.5], [10.8, -1.9], [10.4, -1.8]],
  ready: [[6.1, -0.1], [5.7, -0.4], [5.2, -1.1], [7.1, -1.2], [5.9, 0.9], [5.7, 0.8], [5.6, 0.6], [7.1, 0.6]],
}

const CHARACTER_SELECTOR = '[data-orca-link-character]'

function isLinkStatus(value) {
  return value !== undefined && Object.hasOwn(STATUS_ROWS, value)
}

function sequenceOffset(status, sequenceIndex, sequenceLength) {
  if (ONE_SHOT_STATUSES.has(status)) return Math.min(sequenceIndex, sequenceLength - 1)
  return sequenceIndex % sequenceLength
}

function statusFrame(status, sequenceIndex) {
  const sequence = FRAME_SEQUENCES[status]
  return {
    frame: sequence[sequenceOffset(status, Math.max(0, sequenceIndex), sequence.length)] ?? 0,
    row: STATUS_ROWS[status],
  }
}

function statusFrameInterval(status) {
  return FRAME_INTERVAL_MS_BY_STATUS[status]
}

function statusFrameDuration(status, sequenceIndex) {
  const sequence = FRAME_SEQUENCES[status]
  const durations = FRAME_DURATIONS_MS_BY_STATUS[status]
  if (durations === undefined) return statusFrameInterval(status)
  const offset = sequenceOffset(status, Math.max(0, sequenceIndex), sequence.length)
  return durations[offset] ?? statusFrameInterval(status)
}

/* ------------------------------------------------------------------ */
/* Headline groups (port of headline-typewriter.ts)                    */
/* ------------------------------------------------------------------ */

const HEADLINE_GROUPS = [
  ['如切如磋，如琢如磨'],
  ['不诱于誉，不恐于诽', '率道而行，端然正己'],
]

const TYPE_DELAY_MS = 105
const DELETE_DELAY_MS = 55
const OPEN_DELAY_MS = 320
const SEGMENT_GAP_MS = 420
const GROUP_GAP_MS = 640
const GROUP_HOLD_MS = 20000

const HEADLINE_SELECTOR = "[data-phase='hero'] [class*='headlineText']"

function splitGraphemes(value) {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(value), ({ segment }) => segment)
  }
  return Array.from(value)
}

function shuffledGroupOrder(previousGroup, groupCount) {
  const order = Array.from({ length: groupCount }, (_, index) => index)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const tmp = order[index]
    order[index] = order[target]
    order[target] = tmp
  }
  if (order.length > 1 && order[0] === previousGroup) {
    const tmp = order[0]
    order[0] = order[1]
    order[1] = tmp
  }
  return order
}

/* ------------------------------------------------------------------ */
/* Composer motion / collapse constants (port of composer-*.ts)        */
/* ------------------------------------------------------------------ */

const MANUAL_HIDDEN_ATTRIBUTE = 'data-orca-composer-manual-hidden'
const DRAGGING_ATTRIBUTE = 'data-orca-composer-collapse-dragging'
const REBOUNDING_ATTRIBUTE = 'data-orca-composer-collapse-rebounding'
const COLLAPSING_ATTRIBUTE = 'data-orca-composer-collapsing'
const RESTORING_ATTRIBUTE = 'data-orca-composer-restoring'
const OWNED_INERT_ATTRIBUTE = 'data-orca-composer-owned-inert'
const BODY_DRAGGING_ATTRIBUTE = 'data-orca-composer-handle-dragging'
const HANDLE_ATTRIBUTE = 'data-orca-composer-handle'
const RESTORE_ATTRIBUTE = 'data-orca-composer-restore'
const RESTORE_EXIT_ATTRIBUTE = 'data-orca-composer-restore-exiting'
const TO_BOTTOM_SELECTOR = ".Md3f7G_toBottom, button[aria-label='回到底部'], button[aria-label='Back to bottom']"
const COMPOSER_CARD_SELECTOR_FILTERED = "[data-composer-card]:not([class*='cardWorkspaceTrigger'])"

const ACTIVATION_DEAD_ZONE = 8
const COMMIT_THRESHOLD = 0.56
const REBOUND_LIFETIME_MS = 280
const COLLAPSE_LIFETIME_MS = 300
const RESTORE_LIFETIME_MS = 340
const RESTORE_SIZE = 28

const COMPOSER_EXIT_ATTRIBUTE = 'data-orca-composer-exiting'
const COMPOSER_ENTER_ATTRIBUTE = 'data-orca-composer-entering'
const COMPOSER_HIDDEN_ATTRIBUTE = 'data-orca-composer-hidden'
const COMPOSER_INTERACTIVE_ATTRIBUTE = 'data-orca-composer-interactive'
const COMPOSER_GHOST_ATTRIBUTE = 'data-orca-composer-ghost'
const COMPOSER_OUTSIDE_CHAT_ATTRIBUTE = 'data-orca-composer-outside-chat'
const SCROLLPORT_SELECTOR = '[data-conversation-scroll]'
const NESTED_SCROLL_SURFACE_SELECTOR = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[data-radix-popper-content-wrapper]',
  '[data-floating-ui-portal]',
].join(',')

const SCROLL_THRESHOLD = 10
const BOTTOM_THRESHOLD = 24
const GHOST_LIFETIME_MS = 260
const ENTER_LIFETIME_MS = 560

/* ------------------------------------------------------------------ */
/* Pricing tables (port of pricing-light.ts)                           */
/* ------------------------------------------------------------------ */

const BEIJING_OFFSET_MS = 8 * 3600000
const MINUTE_MS = 60000
const HOUR_MS = 3600000
const DAY_MS = 24 * HOUR_MS
const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]]
const TRANSITION_MINUTES = 20
const PRICE_LIGHT_SELECTOR = '[data-orca-link-price-light]'
const POLL_INTERVAL_MS = 15000

const BAND_COPY = {
  low: {
    zh: { status: '空闲时段 OFF-PEAK', price: '高峰价的 50% (半价)', next: '-> 高峰 100%' },
    en: { status: 'OFF-PEAK', price: '50% of peak price (half price)', next: '-> Peak 100%' },
  },
  transition: {
    zh: { status: '提前告警', price: '高峰价的 50% (半价)', next: '-> 高峰 100%' },
    en: { status: 'Early warning', price: '50% of peak price (half price)', next: '-> Peak 100%' },
  },
  high: {
    zh: { status: '高峰时段 PEAK', price: '标准价格 100%', next: '-> 空闲 50%' },
    en: { status: 'PEAK HOURS', price: 'Standard price 100%', next: '-> Off-peak 50%' },
  },
}

const VALLEY_WINDOWS_LINE = {
  zh: '周末全天及非高峰时段, 价格为高峰的一半',
  en: 'Weekends and weekday off-peak hours at half peak price',
}

const PEAK_WINDOWS_LINE = {
  zh: '工作日 09:00-12:00 / 14:00-18:00',
  en: 'Weekdays 09:00-12:00 / 14:00-18:00',
}

const WEEKDAY_LABELS = {
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

const TOOLTIP_ROWS = [
  ['状态', 'Status', 'status'],
  ['当前', 'Price', 'price'],
  ['下次', 'Next', 'next'],
  ['高峰', 'Peak', 'peak-windows'],
  ['空闲', 'Valley', 'valley-windows'],
]

function beijingMinutesOfDay(date) {
  return new Date(date.getTime() + BEIJING_OFFSET_MS).getUTCHours() * 60
    + new Date(date.getTime() + BEIJING_OFFSET_MS).getUTCMinutes()
}

function formatBeijingTime(date) {
  const beijing = new Date(date.getTime() + BEIJING_OFFSET_MS)
  const hour = String(beijing.getUTCHours()).padStart(2, '0')
  const minute = String(beijing.getUTCMinutes()).padStart(2, '0')
  return hour + ':' + minute
}

function beijingDayNumber(date) {
  return Math.floor((date.getTime() + BEIJING_OFFSET_MS) / DAY_MS)
}

function beijingWeekday(date) {
  return new Date(date.getTime() + BEIJING_OFFSET_MS).getUTCDay()
}

function isBeijingWeekend(date) {
  const weekday = beijingWeekday(date)
  return weekday === 0 || weekday === 6
}

function priceBandAt(date) {
  if (isBeijingWeekend(date)) return 'low'
  const minutes = beijingMinutesOfDay(date)
  const upcoming = PEAK_WINDOWS.some(([start]) => (
    minutes >= start - TRANSITION_MINUTES && minutes < start
  ))
  if (upcoming) return 'transition'
  if (PEAK_WINDOWS.some(([start, end]) => minutes >= start && minutes < end)) return 'high'
  return 'low'
}

function beijingWeekdayOfDayStart(dayStart) {
  return (Math.round(dayStart / DAY_MS) + 4) % 7
}

function nextPriceChangeAt(date) {
  const beijingEpoch = date.getTime() + BEIJING_OFFSET_MS
  let dayStart = Math.floor(beijingEpoch / DAY_MS) * DAY_MS
  for (let day = 0; day <= 7; day += 1) {
    const weekday = beijingWeekdayOfDayStart(dayStart)
    if (weekday === 0 || weekday === 6) {
      dayStart += DAY_MS
      continue
    }
    let found = false
    for (const hour of [9, 12, 14, 18]) {
      if (dayStart + hour * HOUR_MS > beijingEpoch) {
        found = true
        return new Date(dayStart + hour * HOUR_MS - BEIJING_OFFSET_MS)
      }
    }
    if (!found) {
      dayStart += DAY_MS
      continue
    }
  }
  return new Date(dayStart + 9 * HOUR_MS - BEIJING_OFFSET_MS)
}

function minutesUntilNextPeak(date) {
  const minutes = beijingMinutesOfDay(date)
  const upcoming = PEAK_WINDOWS.find(([start]) => minutes < start)
  return upcoming === undefined ? TRANSITION_MINUTES : upcoming[0] - minutes
}

function priceScheduleAt(date, chinese) {
  const band = priceBandAt(date)
  const copy = chinese ? BAND_COPY[band].zh : BAND_COPY[band].en
  const next = nextPriceChangeAt(date)
  let nextTime = formatBeijingTime(next)
  const dayGap = beijingDayNumber(next) - beijingDayNumber(date)
  if (dayGap === 1) {
    nextTime = chinese ? nextTime + ' 明日' : nextTime + ' tomorrow'
  } else if (dayGap > 1) {
    const weekday = chinese
      ? WEEKDAY_LABELS.zh[beijingWeekday(next)]
      : WEEKDAY_LABELS.en[beijingWeekday(next)]
    nextTime = weekday + ' ' + nextTime
  }
  const statusLine = isBeijingWeekend(date)
    ? (chinese ? '周末全天半价' : 'Weekend half price all day')
    : band === 'transition'
      ? (chinese
          ? '提前告警 · ' + minutesUntilNextPeak(date) + ' 分钟后进入高峰'
          : 'Early warning: peak in ' + minutesUntilNextPeak(date) + ' min')
      : copy.status
  return {
    band,
    label: band === 'low' ? 'LOW' : 'HIGH',
    statusLine,
    priceLine: copy.price,
    nextChangeLine: nextTime + ' ' + copy.next,
  }
}

/* ------------------------------------------------------------------ */
/* Icon redraw tables (port of icons.ts)                               */
/* ------------------------------------------------------------------ */

const SVG_NS = 'http://www.w3.org/2000/svg'
const ICON_ATTRIBUTE = 'data-orca-link-icon'
const ICON_ART_ATTRIBUTE = 'data-orca-link-icon-art'
const USAGE_KEY = 'JObwrW_track'
const USAGE_CELLS = 36
const USAGE_COLS = 6
const USAGE_CELL_SIZE = 1
const USAGE_PITCH = 1.5
const USAGE_X0 = 3.75
const USAGE_Y_BOTTOM = 12.25
const USAGE_EMPTY_OPACITY = 0.12
const USAGE_MIN_PARTIAL = 0.28

const ICON_ART = {
  'panel-collapse': [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<path d="M2.25 2.25h3.75v11.5H2.25z" fill="currentColor" stroke="none"/>',
    '<path d="M11.75 8H7.75M9.75 5.5 7.25 8l2.5 2.5"/>',
  ].join(''),
  'panel-expand': [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<path d="M10 2.25h3.75v11.5H10z" fill="currentColor" stroke="none"/>',
    '<path d="M4.25 8h4M6.25 5.5 8.75 8l-2.5 2.5"/>',
  ].join(''),
  'panel-bottom': [
    '<path d="M1.75 2h12.5v12H1.75z"/>',
    '<path d="M3.25 10h9.5v2.5H3.25z" fill="currentColor" stroke="none"/>',
  ].join(''),
  'new-session': [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<path d="M8 5.25v5.5M5.25 8h5.5"/>',
  ].join(''),
  search: [
    '<path d="M2.25 2.25h7.5v7.5h-7.5z"/>',
    '<path d="M10.25 10.25 13.75 13.75"/>',
  ].join(''),
  sliders: [
    '<path d="M2 4.75h12M2 8h12M2 11.25h12"/>',
    '<path d="M4.75 4h2.5v1.5h-2.5zM8.75 7.25h2.5v1.5h-2.5zM6.25 10.5h2.5v1.5h-2.5z" fill="currentColor" stroke="none"/>',
  ].join(''),
  folder: ['<path d="M2 3.5h4.25L8 5.25h6V13.5H2z"/>'].join(''),
  'folder-closed': [
    '<path d="M2 3.5h4.25L8 5.25h6v8.25H2z"/>',
    '<path d="M4 8h8"/>',
  ].join(''),
  'folder-open': [
    '<path d="M2 6V3.5h4.25L8 5.25h6V7"/>',
    '<path d="M2.5 7h11.75l-2 6.5H1.75z"/>',
    '<path d="M5 10.25h6"/>',
  ].join(''),
  'add-workspace': [
    '<path d="M2 3.5h4.25L8 5.25h6V13.5H2z"/>',
    '<path d="M12.5 1.5v2.25M11.375 2.625h2.25"/>',
  ].join(''),
  gear: [
    '<path d="M4.75 4.75h6.5v6.5h-6.5z"/>',
    '<path d="M6.5 2.25h3v2.5h-3zM6.5 11.25h3v2.5h-3zM2.25 6.5h2.5v3h-2.5zM11.25 6.5h2.5v3h-2.5z" fill="currentColor" stroke="none"/>',
    '<path d="M7 7h2v2H7z" fill="currentColor" stroke="none"/>',
  ].join(''),
  sparkle: [
    '<path d="M8 1.5v3.25M8 11.25v3.25M1.5 8h3.25M11.25 8h3.25"/>',
    '<path d="M6.5 6.5h3v3h-3z" fill="currentColor" stroke="none"/>',
  ].join(''),
  data: [
    '<rect x="2.5" y="2.5" width="11" height="4"/>',
    '<rect x="2.5" y="9" width="11" height="4"/>',
  ].join(''),
  'agent-preset': [
    '<path d="M6.75 1.75h2.5v2.5h-2.5zM1.75 11.75h2.5v2.5h-2.5zM11.75 11.75h2.5v2.5h-2.5z" fill="currentColor" stroke="none"/>',
    '<path d="M8 4.25 3 11.75M8 4.25l5 7.5"/>',
  ].join(''),
  plus: ['<path d="M8 1.75v12.5M1.75 8h12.5"/>'].join(''),
  check: ['<path d="M3 8.5 6.5 12 13 4.5"/>'].join(''),
  shield: [
    '<path d="M8 1.75 13.75 3.6v3.65c0 4.1-2.9 5.9-5.75 7-2.85-1.1-5.75-2.9-5.75-7V3.6z"/>',
    '<path d="M5.6 7.9l1.7 1.7 3.1-3.4"/>',
  ].join(''),
  'permission-read': [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<path d="M4.5 5.25h7M4.5 8h7M4.5 10.75h4.25"/>',
    '<path d="M10.25 10.25h1.5v1.5h-1.5z" fill="currentColor" stroke="none"/>',
  ].join(''),
  'permission-write': [
    '<path d="M2.25 3.25h4.25L8 4.75h5.75v4.5"/>',
    '<path d="M2.25 3.25v10.5h6"/>',
    '<path d="M8.25 12.5 12 8.75l1.75 1.75L10 14.25H8.25z"/>',
    '<path d="m11.75 9 1.75 1.75"/>',
  ].join(''),
  'permission-full': [
    '<path d="M2.25 6V2.25H6M10 2.25h3.75V6M13.75 10v3.75H10M6 13.75H2.25V10"/>',
    '<path d="M5.75 5.75h4.5v4.5h-4.5z" fill="currentColor" stroke="none"/>',
  ].join(''),
  send: [
    '<path d="M8 12.5V2.75M3.75 7 8 2.75 12.25 7"/>',
    '<path d="M4 13.75h8"/>',
  ].join(''),
  close: ['<path d="M3.75 3.75l8.5 8.5M12.25 3.75l-8.5 8.5"/>'].join(''),
  'chevron-down': ['<path d="M3.75 5.5 8 9.75 12.25 5.5"/>'].join(''),
  'chevron-up': ['<path d="M3.75 10.25 8 6l4.25 4.25"/>'].join(''),
  'chevron-left': ['<path d="M10.25 3.75 5.75 8l4.5 4.25"/>'].join(''),
  'chevron-right': ['<path d="M5.75 3.75 10.25 8l-4.5 4.25"/>'].join(''),
  'caret-right': ['<path d="M4.5 3 11.75 8 4.5 13z" fill="currentColor" stroke="none"/>'].join(''),
  ellipsis: [
    '<path d="M2.25 6.5h3v3h-3zM6.5 6.5h3v3h-3zM10.75 6.5h3v3h-3z" fill="currentColor" stroke="none"/>',
  ].join(''),
  think: [
    '<path d="M2.5 2.5h11v11h-11z"/>',
    '<path d="M8 4.75v2M8 9.25v2M4.75 8h2M9.25 8h2"/>',
    '<path d="M7 7h2v2H7z" fill="currentColor" stroke="none"/>',
  ].join(''),
  terminal: [
    '<path d="M1.75 2.5h12.5v11H1.75z"/>',
    '<path d="M4 6.5 6.25 8.75 4 11M8.75 11h3.5"/>',
  ].join(''),
  globe: [
    '<path d="M2.5 2.5h11v11h-11z"/>',
    '<path d="M2.5 8h11M8 2.5v11"/>',
  ].join(''),
  copy: [
    '<path d="M5.5 5.5h8v8h-8z"/>',
    '<path d="M10.5 2.5h-8v8"/>',
  ].join(''),
  edit: [
    '<path d="M2.5 13.5l.8-3.2 7.3-7.3 2.4 2.4-7.3 7.3z"/>',
    '<path d="M2.5 13.5l.8-3.2 2.4 2.4z" fill="currentColor" stroke="none"/>',
  ].join(''),
  'thumb-up': [
    '<path d="M2.25 6.75h2.5v7h-2.5z" fill="currentColor" stroke="none"/>',
    '<path d="M6 13.75V7.6L8.7 3.2l1.8 1-1.6 3.4h4.35v3.15l-1.2 3z" fill="currentColor" stroke="none"/>',
  ].join(''),
  'thumb-down': [
    '<g transform="rotate(180 8 8)">',
    '<path d="M2.25 6.75h2.5v7h-2.5z" fill="currentColor" stroke="none"/>',
    '<path d="M6 13.75V7.6L8.7 3.2l1.8 1-1.6 3.4h4.35v3.15l-1.2 3z" fill="currentColor" stroke="none"/>',
    '</g>',
  ].join(''),
  branch: [
    '<path d="M4.5 3.75v8.5M4.5 8h7v4.25"/>',
    '<path d="M3.25 1.25h2.5v2.5h-2.5zM3.25 12.25h2.5v2.5h-2.5zM10.25 12.25h2.5v2.5h-2.5z" fill="currentColor" stroke="none"/>',
  ].join(''),
  refresh: [
    '<path d="M2.5 13.25V4.5L4.75 2.25h6.5L13.5 4.5v4"/>',
    '<path d="M12.25 7.25 13.5 8.5 14.75 7.25"/>',
  ].join(''),
  loading: ['<path d="M8 2.25H2.25v11.5h11.5V8"/>'].join(''),
  code: [
    '<path d="M6.5 2.5 5 13.5M11.5 2.5 10 13.5M2.5 6.25h11M2 10h11"/>',
  ].join(''),
  browse: [
    '<path d="M2.25 2.5h11.5v11H2.25z"/>',
    '<path d="M4.75 5.75h6.5M4.75 8.75h4.5"/>',
  ].join(''),
  queue: [
    '<path d="M2.25 2.5h11.5v8.25H8.6l-3.1 2.75v-2.75H2.25z"/>',
    '<path d="M5 5.25h6M5 7.75h6"/>',
  ].join(''),
  trash: [
    '<path d="M2.25 3.75h11.5M6.25 3.5V2.25h3.5V3.5"/>',
    '<path d="M4 3.75v10.25h8V3.75M6.75 6.75v4.5M9.25 6.75v4.5"/>',
  ].join(''),
  warning: [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<path d="M8 5v3.5"/>',
    '<path d="M7.375 10h1.25v1.25h-1.25z" fill="currentColor" stroke="none"/>',
  ].join(''),
  user: [
    '<path d="M6.25 2.25h3.5v3.5h-3.5z" fill="currentColor" stroke="none"/>',
    '<path d="M2.5 13.75v-2l1.75-2.5h7.5l1.75 2.5v2"/>',
  ].join(''),
  stop: ['<path d="M3.75 3.75h8.5v8.5h-8.5z" fill="currentColor" stroke="none"/>'].join(''),
  paperclip: ['<path d="M4.75 13.75V4.25h6.5v7.5M7.25 13.75V6.75"/>'].join(''),
  download: [
    '<path d="M8 2.25v7.5M5.25 7 8 9.75 10.75 7"/>',
    '<path d="M2.5 11.25v2.5h11v-2.5"/>',
  ].join(''),
  share: ['<path d="M2.5 8h9.75M9 4.75 12.75 8 9 11.25"/>'].join(''),
  'right-up': ['<path d="M3 13.25 13.25 3M6.5 3h6.75v6.75"/>'].join(''),
  enhance: ['<path d="M2 2.75h12M2 6.75h12M2 10.75h12M2 14h8.5"/>'].join(''),
  link: [
    '<path d="M5.25 5.25h5.5v5.5h-5.5z"/>',
    '<path d="M2.5 8.25V2.5h5.75M7.75 13.5h5.75V7.75"/>',
  ].join(''),
  play: [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<path d="M6.75 5.5 10.75 8l-4 2.5z" fill="currentColor" stroke="none"/>',
  ].join(''),
  pause: [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<path d="M5.75 5h1.5v6h-1.5zM8.75 5h1.5v6h-1.5z" fill="currentColor" stroke="none"/>',
  ].join(''),
  fullscreen: ['<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>'].join(''),
  checklist: [
    '<path d="M2 2h3.5v3.5H2zM2 10h3.5v3.5H2z"/>',
    '<path d="M7.5 3.75h6M7.5 11.75h6"/>',
  ].join(''),
  'todo-pending': [
    '<path d="M2.25 6V2.25H6M10 2.25h3.75V6M13.75 10v3.75H10M6 13.75H2.25V10"/>',
  ].join(''),
  'todo-progress': [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<rect data-orca-link-todo-progress-cell="0" x="4" y="10" width="2" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-todo-progress-cell="1" x="7" y="10" width="2" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-todo-progress-cell="2" x="10" y="10" width="2" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-todo-progress-cell="3" x="4" y="7" width="2" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-todo-progress-cell="4" x="7" y="7" width="2" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-todo-progress-cell="5" x="10" y="7" width="2" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-todo-progress-cell="6" x="4" y="4" width="2" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-todo-progress-cell="7" x="7" y="4" width="2" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-todo-progress-cell="8" x="10" y="4" width="2" height="2" fill="currentColor" stroke="none"/>',
  ].join(''),
  'todo-completed': [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<path d="M4.75 8.25 7 10.5l4.5-5"/>',
  ].join(''),
  'list-pen': [
    '<path d="M2.25 2h8L13.5 5.25V7.5"/>',
    '<path d="M4.75 5.5h6M4.75 9h4.5"/>',
    '<path d="M8.5 13.75 12.75 9.5l1.5 1.5-4.25 4.25H8.5z"/>',
  ].join(''),
  goal: [
    '<path d="M2.5 2.5h11v11h-11z"/>',
    '<path d="M6 6h4v4H6z"/>',
    '<path d="M13.75 2.25 8.5 7M11 7.5H8.5V5"/>',
  ].join(''),
  inspect: [
    '<path d="M6.25 4.75 2.75 8l3.5 3.25M9.75 4.75 13.25 8l-3.5 3.25M10 2.5 6 13.5"/>',
  ].join(''),
  skill: [
    '<path d="M2.25 1.75h8L13.5 5v9.25H2.25z"/>',
    '<path d="M4.75 5.75h5.5M4.75 8.75h5.5"/>',
    '<path d="M9.75 10.75v3M8.25 12.25h3"/>',
  ].join(''),
  question: [
    '<path d="M2.25 2.25h11.5v11.5H2.25z"/>',
    '<path d="M5.25 4.75h5.5v3H8.5v1.5"/>',
    '<path d="M7.375 10.75h1.25v1.25h-1.25z" fill="currentColor" stroke="none"/>',
  ].join(''),
  archive: [
    '<path d="M1.75 1.75h12.5V5H1.75zM2.75 5v9.25h10.5V5"/>',
    '<path d="M5.75 8h4.5v2.5h-4.5z"/>',
  ].join(''),
  usage: ['<rect x="2.5" y="2.5" width="11" height="11"/>'].join(''),
  /**
   * Busy spinner: replaces the host's orbiting-dot loader with a square
   * outline whose four edges light up clockwise in hard steps (animated by
   * the stylesheet via the sequence attributes).
   */
  spinner: [
    '<rect data-orca-link-spinner-seq="0" x="2" y="2" width="12" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-spinner-seq="1" x="12" y="2" width="2" height="12" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-spinner-seq="2" x="2" y="12" width="12" height="2" fill="currentColor" stroke="none"/>',
    '<rect data-orca-link-spinner-seq="3" x="2" y="2" width="2" height="12" fill="currentColor" stroke="none"/>',
  ].join(''),}

const ICON_KEYS = [
  // Sidebar and shell chrome.
  ['M9.67272 0.522841C10.8339', 'panel-collapse'],
  ['M8.00003 0.3237C3.76075', 'new-session'],
  ['M11.894845 6.647401C11.894845 3.725463', 'search'],
  ['M3.55246 0L3.55246 2.44252', 'add-workspace'],
  ['M5.19629 1.57104C5.81144', 'folder-open'],
  ['M5.05582 0.518756L4.50669 0.86654', 'folder-closed'],
  ['x="3.25" y="10"', 'panel-bottom'],
  ['x="10.5" y="3.25"', 'panel-expand'],
  // Settings dialog.
  ['clip0_1450_63327', 'gear'],
  ['clip0_2580_121189', 'gear'],
  ['M10.3232 9.18164C11.2868', 'sliders'],
  ['mask0_agent_preset_16', 'agent-preset'],
  ['M11.3496 8C11.3496 6.14985', 'sun'],
  ['M13.2764 9.52324C12.5607', 'moon'],
  ['M12.1665 13.5811V14.7803H3.66651', 'monitor'],
  ['M12.0997 8.54554C12.2905', 'data'],
  // Composer and message actions. Send16 appears with two float-drift
  // revisions (0.980183 deployed build, 0.981587 primitives source).
  ['M8.3125 0.980183C8.66767', 'send'],
  ['M8.3125 0.981587C8.66767', 'send'],
  ['M7.24707 1.01771C7.52897', 'send'],
  ['M7.00049 0.199829C3.24488', 'queue'],
  ['M8.64453 1.5V7.34961H14.5V8.65039', 'plus'],
  ['M12.1654 5.7552L8.9447', 'permission-read'],
  ['M8.08887 0.251709C8.20479', 'permission-write'],
  ['M9.10094 4.5V8.75939', 'permission-full'],
  ['M8.20554 0.899994L14.7901 3.36857', 'shield'],
  ['M4 4l8 8M12 4l-8 8', 'close'],
  ['M10.6074 4.40278L8.00975', 'close'],
  ['M14.1168 13.197L13.197 14.1167', 'close'],
  ['M6.14929 4.02032C7.11197', 'copy'],
  ['M9.94076 1.34942C10.7047', 'edit'],
  ['M14.4782 4.84067L14.2138 10.1152', 'trash'],
  ['M7.92136 0.349152C10.3744', 'refresh'],
  ['M1.272 6.21348C1.70645 3.08888', 'refresh'],
  ['M8.27868 0.811572C8.81991', 'thumb-up'],
  ['M14.0593 12.922L15.0976 10.1247', 'thumb-up'],
  ['M7.72451 15.1086C7.18929', 'thumb-down'],
  ['M1.92838 3.06811L0.88799 5.87104', 'thumb-down'],
  ['M13.0762 1.37207C14.0846', 'branch'],
  ['M12.3368 1.53569L11.931 4.43172', 'code'],
  ['M11.2426 4.80473V6.10551H4.75819', 'browse'],
  ['M7.06431 5.93342C7.68763', 'think'],
  ['M8.00192 6.64454C8.75026', 'think'],
  ['x="3" y="3" width="10" height="10" rx="3"', 'stop'],
  ['M2 4.88C2 3.68009', 'stop'],
  ['M15.3695 11.411L15.1234 12.8866', 'download'],
  ['M5.5498 9.75V5H6.9502', 'paperclip'],
  ['M2.871 13.1286', 'loading'],
  // Agent protocol nodes: todo, question, goal, skills.
  ['M13.3277 9.69629V10.976H7.28086', 'checklist'],
  ['stroke-dasharray="2.4 2.4"', 'todo-pending'],
  ['x1="2.5" y1="12" x2="10.5" y2="3.5"', 'todo-progress'],
  ['M10.9631 5.71411L7.70154 8.97571', 'todo-completed'],
  ['M12.5757 7.00012C12.5757 3.92085', 'question'],
  ['M8 0C8.31451 0 8.62464', 'goal'],
  ['M10.8239 3.54733V4.78443H4.63437', 'list-pen'],
  ['M6.1 3.1Q6.6 7.8 11.3 8.3', 'sparkle'],
  ['M16 8L10.8571 12V10.552', 'inspect'],
  ['M12.5113 15.4067C12.4395 15.6249', 'skill'],
  ['M15.8659 2.05975C17.2603', 'archive'],
  // Generic affordances.
  ['M4.55146 8.00001C4.55146 8.63513', 'ellipsis'],
  ['M4.25 2.82782L4.25 11.1722', 'caret-right'],
  ['M11.8486 5.5L11.4238 5.92383', 'chevron-down'],
  ['M2.15137 8.5L2.57617 8.07617L5.30273 5.34863', 'chevron-up'],
  ['M8.5 2.15137L8.07617 2.57617', 'chevron-left'],
  ['M5.5 2.15137L5.92383 2.57617', 'chevron-right'],
  ['M15.0498 3.92579', 'check'],
  ['M11.5635 4.58984', 'check'],
  ['M4.5 6.25 6.75 8 4.5 9.75', 'terminal'],
  ['M11.4818 5.57813C11.4818 4.45301', 'terminal'],
  ['ellipse cx="8" cy="8" rx="2.8" ry="6.5"', 'globe'],
  ['M8.19727 5.86969', 'link'],
  ['M9.94133 6.50173', 'link'],
  ['M7.95889 1.52285C7.95888 0.826234', 'share'],
  ['M6.54199 8.62824', 'right-up'],
  ['M13.588429 5.147807', 'right-up'],
  ['M14.9943 1.92389V3.32428H1.00598', 'enhance'],
  ['M14.1446 8C14.1446 4.6062', 'play'],
  ['M14.1448 8.00024', 'pause'],
  ['M2.58875 12.3407L6.59167 8.33777', 'fullscreen'],
  ['M6.3002 3.32843L7.69986 3.32843', 'warning'],
  ['M11.0307 5.46369C11.0305 3.78995', 'user'],
  [USAGE_KEY, 'usage'],
  ['_cell_10orb', 'spinner'],
]



/* ------------------------------------------------------------------ */
/* apply(): everything below is per-activation state                   */
/* ------------------------------------------------------------------ */

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const asset = (name) => ctx.assetBase + '/assets/' + name
      const body = document.body
      const doc = document
      const view = window
      const Element = view?.Element ?? doc.defaultView?.Element ?? globalThis.Element
      const HTMLElement = view?.HTMLElement ?? doc.defaultView?.HTMLElement ?? globalThis.HTMLElement
      const SVGElement = view?.SVGElement ?? doc.defaultView?.SVGElement ?? globalThis.SVGElement
      const SVGGElement = view?.SVGGElement ?? doc.defaultView?.SVGGElement ?? globalThis.SVGGElement
      const HTMLInputElement = view?.HTMLInputElement ?? doc.defaultView?.HTMLInputElement ?? globalThis.HTMLInputElement
      const HTMLTextAreaElement = view?.HTMLTextAreaElement ?? doc.defaultView?.HTMLTextAreaElement ?? globalThis.HTMLTextAreaElement

      const originalTitle = doc.title
      const styleProperties = [
        LIGHT_HERO_ART_PROPERTY,
        LIGHT_ACTIVE_ART_PROPERTY,
        DARK_HERO_ART_PROPERTY,
        DARK_ACTIVE_ART_PROPERTY,
        SIDEBAR_WIDTH_PROPERTY,
        SIDEBAR_ART_WIDTH_PROPERTY,
      ]
      const previousStyles = new Map(styleProperties.map((property) => [property, body.style.getPropertyValue(property)]))
      const hadStyleAttribute = body.hasAttribute('style')
      const takenAttributes = [
        BODY_SKIN_ATTRIBUTE,
        SCENE_ATTRIBUTE,
        SIDEBAR_WIDE_ATTRIBUTE,
        'data-orca-link-status',
        'data-orca-settings-open',
        'data-orca-cordis-panel-open',
        'data-orca-lamp',
        'data-orca-window-resuming',
      ]
      const previousAttributes = new Map(takenAttributes.map((attribute) => [attribute, body.getAttribute(attribute)]))

      const ownedNodes = new Set()
      const disposers = []
      let cleaned = false
      ctx.onCleanup(() => {
        if (cleaned) return
        cleaned = true
        for (const dispose of disposers.reverse()) {
          try {
            dispose()
          } catch (error) {
            console.warn('[orca-link] cleanup error:', error)
          }
        }
        for (const node of ownedNodes) node.remove()
        for (const [attribute, value] of previousAttributes) {
          if (value === null) body.removeAttribute(attribute)
          else body.setAttribute(attribute, value)
        }
        for (const [property, value] of previousStyles) {
          if (value === '') body.style.removeProperty(property)
          else body.style.setProperty(property, value)
        }
        if (!hadStyleAttribute && body.style.length === 0) body.removeAttribute('style')
        if (doc.title === SKIN_TITLE) doc.title = originalTitle
      })

      const isSkinChrome = (node) => (
        node instanceof Element && node.getAttribute('data-skin-owner') === SKIN_OWNER
      )

      const hasMutationOutsideTerminal = (records) => {
        const belongs = (node) => {
          if (node instanceof Element) {
            return node.matches(HIGH_CHURN_SELECTOR) || node.closest(HIGH_CHURN_SELECTOR) !== null
          }
          return (node.parentElement?.closest(HIGH_CHURN_SELECTOR) ?? null) !== null
        }
        const isHighChurnOnly = (record) => {
          if (belongs(record.target)) return true
          if (record.type !== 'childList') return false
          const changed = [...record.addedNodes, ...record.removedNodes]
          return changed.length > 0 && changed.every(belongs)
        }
        return records.some((record) => !isHighChurnOnly(record))
      }

      /* ------------------------- pinned chrome ------------------------- */

      const favicon = doc.createElement('link')
      favicon.rel = 'icon'
      favicon.href = 'data:image/svg+xml;utf8,' + encodeURIComponent(FAVICON)
      favicon.dataset.skinChrome = 'favicon'
      favicon.dataset.skinOwner = SKIN_OWNER
      ownedNodes.add(favicon)
      doc.head.append(favicon)
      doc.title = SKIN_TITLE

      body.setAttribute(BODY_SKIN_ATTRIBUTE, '')
      body.style.setProperty(LIGHT_HERO_ART_PROPERTY, 'url(' + asset(ART.lightHero) + ')')
      body.style.setProperty(LIGHT_ACTIVE_ART_PROPERTY, 'url(' + asset(ART.lightActive) + ')')
      body.style.setProperty(DARK_HERO_ART_PROPERTY, 'url(' + asset(ART.darkHero) + ')')
      body.style.setProperty(DARK_ACTIVE_ART_PROPERTY, 'url(' + asset(ART.darkActive) + ')')

      const makeScene = (name, chrome) => {
        const scene = doc.createElement('div')
        scene.className = CH[name]
        scene.dataset.skinChrome = chrome
        scene.dataset.skinOwner = SKIN_OWNER
        scene.setAttribute('aria-hidden', 'true')
        // The v1 stylesheet sizes the crossfade layers via the Layer class and
        // paints the art via Hero/Active on the SAME element (one node carries
        // both classes) — a separate Layer wrapper would be static and 0-high.
        for (const variant of ['Hero', 'Active']) {
          const layer = doc.createElement('div')
          layer.className = CH[name + 'Layer'] + ' ' + CH[name + variant]
          scene.append(layer)
        }
        ownedNodes.add(scene)
        return scene
      }

      const lightScene = makeScene('lightScene', 'light-scene')
      const darkScene = makeScene('darkScene', 'dark-scene')
      const spine = doc.createElement('div')
      spine.className = CH.spine
      spine.dataset.skinChrome = 'spine'
      spine.dataset.skinOwner = SKIN_OWNER
      spine.setAttribute('aria-hidden', 'true')
      ownedNodes.add(spine)
      const standby = doc.createElement('div')
      standby.className = CH.standby
      standby.dataset.skinChrome = 'standby'
      standby.dataset.skinOwner = SKIN_OWNER
      standby.setAttribute('aria-hidden', 'true')
      for (const textContent of ['', 'ORCA LINK STANDBY', '']) {
        const line = doc.createElement('span')
        line.className = CH.standbyLine
        line.textContent = textContent
        standby.append(line)
      }
      ownedNodes.add(standby)
      body.append(lightScene, darkScene, spine, standby)

      const text = (tag, className, value) => {
        const element = doc.createElement(tag)
        element.className = className
        element.textContent = value
        return element
      }

      /* ------------------------ wordmark + signal ---------------------- */

      const ownedWordmarkNodes = []
      const mountDshWordmark = () => {
        const row = doc.querySelector(SIDEBAR_LOGO_ROW_SELECTOR)
        if (!(row instanceof HTMLElement)) return false
        const buttons = Array.from(row.querySelectorAll(':scope > button'))
        const brand = buttons.find((button, index) => {
          const label = button.getAttribute('aria-label') ?? ''
          return index === 0 && (buttons.length > 1 || !/sidebar|侧边栏/i.test(label))
        })
        if (brand) brand.dataset.orcaLinkBrand = ''
        if (!row.querySelector(':scope > [data-orca-link-wordmark]')) {
          const wordmark = doc.createElementNS(SVG_NS, 'svg')
          wordmark.classList.add(CH.dshWordmark)
          wordmark.dataset.orcaLinkWordmark = ''
          wordmark.dataset.skinChrome = 'wordmark'
          wordmark.dataset.skinOwner = SKIN_OWNER
          wordmark.setAttribute('viewBox', '0 0 180 44')
          wordmark.setAttribute('aria-hidden', 'true')
          wordmark.innerHTML = DSH_WORDMARK
          row.append(wordmark)
          ownedWordmarkNodes.push(wordmark)
        }
        if (!row.querySelector(':scope > [data-orca-link-signal]')) {
          const chip = doc.createElement('span')
          chip.className = CH.signalChip
          chip.dataset.orcaLinkSignal = ''
          chip.dataset.skinChrome = 'signal'
          chip.dataset.skinOwner = SKIN_OWNER
          chip.setAttribute('aria-hidden', 'true')
          const dot = doc.createElement('span')
          dot.className = CH.signalDot
          const label = text('span', CH.signalChipLabel, 'LINK ACTIVE')
          label.dataset.orcaLinkSignalLabel = ''
          chip.append(dot, label)
          row.append(chip)
          ownedWordmarkNodes.push(chip)
        }
        return true
      }

      /* --------------------------- scene sync --------------------------- */

      // Shared cache for the conversation root lookup. The root is only
      // rebuilt on session switches; between switches the phase lives on the
      // same node, so every observer callback can reuse the cached element
      // instead of re-walking the whole [data-phase] tree (the dominant
      // per-mutation cost during active chat streaming).
      let memoConversationRoot = null
      const conversationRootMemo = () => {
        if (memoConversationRoot !== null && memoConversationRoot.isConnected) return memoConversationRoot
        memoConversationRoot = conversationRootOf(body)
        return memoConversationRoot
      }

      const sceneDisposer = (() => {
        const sync = () => {
          const root = conversationRootMemo()
          const phase = root?.dataset.phase
          const scene = phase === 'settling' || phase === 'active' ? 'active' : 'hero'
          if (body.getAttribute(SCENE_ATTRIBUTE) !== scene) body.setAttribute(SCENE_ATTRIBUTE, scene)
        }
        const observer = new MutationObserver((records) => {
          if (hasMutationOutsideTerminal(records)) sync()
        })
        observer.observe(body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-phase'],
        })
        sync()
        return () => observer.disconnect()
      })()

      /* ------------------------- link status ---------------------------- */

      const linkStatusDisposer = (() => {
        const synchronize = () => {
          const status = resolveLinkStatus(conversationRootMemo())
          if (body.getAttribute('data-orca-link-status') !== status) body.setAttribute('data-orca-link-status', status)
          const chip = body.querySelector(SIGNAL_SELECTOR)
          if (chip === null) return
          const label = chip.querySelector(SIGNAL_LABEL_SELECTOR)
          if (chip.getAttribute('data-orca-link-status') !== status) chip.setAttribute('data-orca-link-status', status)
          if (label !== null && label.textContent !== STATUS_LABELS[status]) label.textContent = STATUS_LABELS[status]
        }
        const observer = new MutationObserver((records) => {
          if (hasMutationOutsideTerminal(records)) synchronize()
        })
        observer.observe(body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            'aria-selected',
            'data-phase',
            'data-state',
            'data-orca-link-icon',
            'disabled',
          ],
        })
        synchronize()
        return () => {
          observer.disconnect()
          const chip = body.querySelector(SIGNAL_SELECTOR)
          chip?.removeAttribute('data-orca-link-status')
          const label = chip?.querySelector(SIGNAL_LABEL_SELECTOR)
          if (label !== null && label !== undefined) label.textContent = STATUS_LABELS.standby
        }
      })()

      /* ---------------------- status character -------------------------- */

      const statusCharacterDisposer = (() => {
        const characterRootSelector = '[data-orca-link-character]'
        const createCharacter = () => {
          const character = doc.createElement('div')
          character.className = CH.statusCharacter
          character.dataset.orcaLinkCharacter = ''
          character.dataset.skinChrome = 'status-character'
          character.dataset.skinOwner = SKIN_OWNER
          character.setAttribute('aria-hidden', 'true')
          const frame = doc.createElement('div')
          frame.className = CH.statusCharacterFrame
          const sprite = doc.createElement('div')
          sprite.className = CH.statusCharacterSprite
          sprite.dataset.orcaLinkCharacterSprite = ''
          character.style.setProperty('--orca-link-status-atlas', 'url(' + asset(ART.statusAtlas) + ')')
          sprite.style.setProperty('--orca-link-status-atlas', 'url(' + asset(ART.statusAtlas) + ')')
          frame.append(sprite)
          character.append(frame, createBubble())
          return character
        }
        const createBubble = () => {
          const bubble = doc.createElement('span')
          bubble.className = CH.statusCharacterBubble
          bubble.dataset.orcaLinkCharacterBubble = ''
          const glyph = doc.createElement('span')
          glyph.dataset.orcaLinkCharacterBubbleGlyph = ''
          glyph.setAttribute('aria-hidden', 'true')
          bubble.append(glyph)
          return bubble
        }

        let character = null
        let sprite = null
        let status = 'standby'
        let sequenceIndex = 0
        let timeout

        const mount = () => {
          const pane = body.querySelector(SIDEBAR_PANE_SELECTOR)
          if (pane === null) return
          const existing = pane.querySelector(characterRootSelector)
          if (existing !== null) {
            character = existing
            sprite = existing.querySelector('[data-orca-link-character-sprite]')
            return
          }
          character = createCharacter()
          sprite = character.querySelector('[data-orca-link-character-sprite]')
          pane.append(character)
          ownedNodes.add(character)
        }

        const render = () => {
          mount()
          const nextStatus = isLinkStatus(body.getAttribute('data-orca-link-status')) ? body.getAttribute('data-orca-link-status') : 'standby'
          if (nextStatus !== status) {
            status = nextStatus
            sequenceIndex = 0
          }
          const current = statusFrame(status, sequenceIndex)
          if (character !== null && character.getAttribute('data-orca-link-status') !== status) {
            character.setAttribute('data-orca-link-status', status)
          }
          // 性能契约 R3: 每个 setProperty 都是一次样式重算面。样式表消费的只有
          // sprite 的 x/y(background-position); column/row 与容器级副本没有任何消费
          // 者(全仓审计), data-orca-link-frame 同样无读者 —— 这些面一律不写。
          const nextX = (current.frame / 7) * 100 + '%'
          const nextY = (current.row / 9) * 100 + '%'
          if (sprite !== null) {
            if (sprite.style.getPropertyValue('--orca-status-x') !== nextX) sprite.style.setProperty('--orca-status-x', nextX)
            if (sprite.style.getPropertyValue('--orca-status-y') !== nextY) sprite.style.setProperty('--orca-status-y', nextY)
            const alignment = STATUS_FRAME_ALIGNMENT[status]?.[current.frame]
            if (alignment !== undefined) {
              sprite.style.transform = 'translate(' + (alignment[0] / STATUS_ATLAS_CELL) * 100 + '%, ' + (alignment[1] / STATUS_ATLAS_CELL) * 100 + '%)'
            } else {
              sprite.style.transform = ''
            }
          }
        }

        const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)')
        const tick = () => {
          if (reducedMotion?.matches !== true) sequenceIndex += 1
          render()
          scheduleTick()
        }
        const scheduleTick = () => {
          if (timeout !== undefined) clearTimeout(timeout)
          timeout = setTimeout(tick, statusFrameDuration(status, sequenceIndex))
        }
        // A hidden tab must not keep the frame loop and the gate-weave
        // animation burning. The page-visible state mirrors onto body so the
        // stylesheet can pause the weave; on return the loop resumes from the
        // current frame without resetting the sequence.
        const onVisibilityChange = () => {
          const hidden = doc.visibilityState === 'hidden'
          body.toggleAttribute('data-orca-page-hidden', hidden)
          if (hidden) {
            if (timeout !== undefined) clearTimeout(timeout)
            timeout = undefined
          } else if (timeout === undefined) {
            scheduleTick()
          }
        }
        doc.addEventListener('visibilitychange', onVisibilityChange)
        onVisibilityChange()
        const observer = new MutationObserver((records) => {
          if (!hasMutationOutsideTerminal(records)) return
          const previousStatus = status
          render()
          if (status !== previousStatus) scheduleTick()
        })
        observer.observe(body, {
          attributes: true,
          attributeFilter: ['data-orca-link-status'],
          childList: true,
          subtree: true,
        })
        render()
        scheduleTick()
        return () => {
          if (timeout !== undefined) clearTimeout(timeout)
          doc.removeEventListener('visibilitychange', onVisibilityChange)
          observer.disconnect()
          body.removeAttribute('data-orca-page-hidden')
          body.querySelectorAll(characterRootSelector).forEach((element) => element.remove())
        }
      })()

      /* ------------------------- headline typewriter -------------------- */

      const typewriterDisposer = (() => {
        const timers = new Set()
        const reducedMotion = body.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
        let headline = null
        let originalText = ''
        let renderedText = ''
        let generation = 0
        let headlineGroups = HEADLINE_GROUPS
        let groupOrder = []
        let previousGroup = -1

        const clearTimers = () => {
          timers.forEach((timer) => clearTimeout(timer))
          timers.clear()
        }
        const schedule = (callback, delay, token = generation) => {
          const timer = setTimeout(() => {
            timers.delete(timer)
            if (token === generation && headline?.isConnected) callback()
          }, delay)
          timers.add(timer)
        }
        const renderText = (value) => {
          renderedText = value
          if (headline) headline.textContent = value
        }
        const typeText = (value, complete) => {
          if (reducedMotion) {
            renderText(value)
            complete()
            return
          }
          const graphemes = splitGraphemes(value)
          let length = 0
          const typeNext = () => {
            length += 1
            renderText(graphemes.slice(0, length).join(''))
            if (length < graphemes.length) schedule(typeNext, TYPE_DELAY_MS)
            else complete()
          }
          typeNext()
        }
        const deleteText = (complete) => {
          if (reducedMotion) {
            renderText('')
            complete()
            return
          }
          const graphemes = splitGraphemes(renderedText)
          let length = graphemes.length
          const deleteNext = () => {
            length -= 1
            renderText(graphemes.slice(0, length).join(''))
            if (length > 0) schedule(deleteNext, DELETE_DELAY_MS)
            else complete()
          }
          schedule(deleteNext, DELETE_DELAY_MS)
        }
        const takeNextGroup = () => {
          if (groupOrder.length === 0) groupOrder = shuffledGroupOrder(previousGroup, headlineGroups.length)
          return groupOrder.shift() ?? 0
        }
        const playNextGroup = () => {
          const groupIndex = takeNextGroup()
          const group = headlineGroups[groupIndex]
          const segmentHold = GROUP_HOLD_MS / group.length
          const playSegment = (segmentIndex) => {
            typeText(group[segmentIndex], () => {
              schedule(() => {
                deleteText(() => {
                  if (segmentIndex + 1 < group.length) {
                    schedule(() => playSegment(segmentIndex + 1), SEGMENT_GAP_MS)
                    return
                  }
                  previousGroup = groupIndex
                  schedule(playNextGroup, GROUP_GAP_MS)
                })
              }, segmentHold)
            })
          }
          playSegment(0)
        }
        const start = (element) => {
          clearTimers()
          generation += 1
          headline = element
          originalText = element.textContent ?? ''
          headlineGroups = originalText === '' ? HEADLINE_GROUPS : [[originalText], ...HEADLINE_GROUPS]
          groupOrder = []
          previousGroup = -1
          element.setAttribute('data-orca-headline-typewriter', '')
          renderText('')
          schedule(playNextGroup, OPEN_DELAY_MS)
        }
        const stop = (restore) => {
          clearTimers()
          generation += 1
          if (headline) {
            headline.removeAttribute('data-orca-headline-typewriter')
            if (restore && headline.isConnected) headline.textContent = originalText
          }
          headline = null
          renderedText = ''
        }
        const sync = () => {
          const found = body.querySelector(HEADLINE_SELECTOR)
          if (found !== headline) {
            stop(true)
            if (found) start(found)
            return
          }
          if (headline && headline.textContent !== renderedText) {
            const externalText = headline.textContent ?? ''
            if (externalText !== '') {
              originalText = externalText
              headlineGroups = [[originalText], ...HEADLINE_GROUPS]
            }
            clearTimers()
            generation += 1
            renderText('')
            schedule(playNextGroup, OPEN_DELAY_MS)
          }
        }
        const observer = new MutationObserver((records) => {
          if (hasMutationOutsideTerminal(records)) sync()
        })
        observer.observe(body, { attributes: true, childList: true, characterData: true, subtree: true })
        sync()
        return () => {
          observer.disconnect()
          stop(true)
        }
      })()

      /* --------------------------- composer motion ---------------------- */

      const composerMotionDisposer = (() => {
        const timers = new Set()
        const phases = new WeakMap()
        const scrollBindings = new Map()
        let hasSeenHero = false

        const schedule = (callback, delay) => {
          const timer = setTimeout(() => {
            timers.delete(timer)
            callback()
          }, delay)
          timers.add(timer)
        }
        const phaseRootOf = (element) => {
          let candidate = element
          while (candidate !== null) {
            if (
              candidate instanceof HTMLElement
              && candidate.hasAttribute('data-phase')
              && candidate.querySelector('[data-conversation-scroll]') !== null
            ) return candidate
            candidate = candidate.parentElement
          }
          return null
        }
        const seatOf = (element) => {
          if (element.matches(COMPOSER_SEAT_SELECTOR)) return element
          return element.querySelector(COMPOSER_SEAT_SELECTOR)
        }
        const activeSeatOf = (scrollport) => {
          const root = phaseRootOf(scrollport)
          if (root?.dataset.phase !== 'active') return null
          const seat = scrollport.querySelector(COMPOSER_SEAT_SELECTOR)
          if (seat?.hasAttribute(COMPOSER_OUTSIDE_CHAT_ATTRIBUTE)) return null
          return seat
        }
        const composerBelongsToConversation = (root) => {
          const phase = root.dataset.phase ?? ''
          if (phase === 'hero' || phase === 'settling') return true
          return phase === 'active' && root.querySelector(CHAT_FLOW_SELECTOR) !== null
        }
        const wheelBelongsToNestedSurface = (event, scrollport) => {
          for (const candidate of event.composedPath()) {
            if (candidate === scrollport) break
            if (!(candidate instanceof HTMLElement)) continue
            if (candidate.matches(NESTED_SCROLL_SURFACE_SELECTOR)) return true
            const style = getComputedStyle(candidate)
            if (!/(auto|scroll)/.test(style.overflowY) || candidate.scrollHeight <= candidate.clientHeight) continue
            if (event.deltaY < 0 && candidate.scrollTop > 0) return true
            if (event.deltaY > 0 && candidate.scrollTop + candidate.clientHeight < candidate.scrollHeight) return true
          }
          return false
        }
        const removeMotionAttributes = (seat) => {
          seat.removeAttribute(COMPOSER_EXIT_ATTRIBUTE)
          seat.removeAttribute(COMPOSER_ENTER_ATTRIBUTE)
          seat.removeAttribute(COMPOSER_HIDDEN_ATTRIBUTE)
          seat.removeAttribute(COMPOSER_INTERACTIVE_ATTRIBUTE)
          seat.removeAttribute(COMPOSER_OUTSIDE_CHAT_ATTRIBUTE)
        }
        const blurSeat = (seat) => {
          const active = doc.activeElement
          if (active instanceof HTMLElement && seat.contains(active)) active.blur()
        }
        const showSeat = (seat) => {
          if (seat.hasAttribute(MANUAL_HIDDEN_ATTRIBUTE)) return
          seat.removeAttribute(COMPOSER_HIDDEN_ATTRIBUTE)
        }
        const hideSeat = (seat) => {
          if (seat.hasAttribute(MANUAL_HIDDEN_ATTRIBUTE)) return
          seat.removeAttribute(COMPOSER_INTERACTIVE_ATTRIBUTE)
          blurSeat(seat)
          seat.removeAttribute(COMPOSER_ENTER_ATTRIBUTE)
          seat.setAttribute(COMPOSER_HIDDEN_ATTRIBUTE, '')
        }
        const activateSeat = (seat) => {
          if (seat.hasAttribute(MANUAL_HIDDEN_ATTRIBUTE)) return
          showSeat(seat)
          seat.removeAttribute(COMPOSER_ENTER_ATTRIBUTE)
          seat.setAttribute(COMPOSER_INTERACTIVE_ATTRIBUTE, '')
        }
        const enterSeat = (seat) => {
          if (seat.hasAttribute(MANUAL_HIDDEN_ATTRIBUTE)) return
          seat.removeAttribute(COMPOSER_EXIT_ATTRIBUTE)
          seat.removeAttribute(COMPOSER_HIDDEN_ATTRIBUTE)
          seat.setAttribute(COMPOSER_ENTER_ATTRIBUTE, '')
          schedule(() => { seat.removeAttribute(COMPOSER_ENTER_ATTRIBUTE) }, ENTER_LIFETIME_MS)
        }
        const copyLiveFieldValues = (source, clone) => {
          const sourceFields = source.querySelectorAll('input, textarea')
          const cloneFields = clone.querySelectorAll('input, textarea')
          sourceFields.forEach((field, index) => {
            const clonedField = cloneFields.item(index)
            if (clonedField !== null) clonedField.value = field.value
          })
        }
        const mountExitGhost = (card) => {
          const rect = card.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          const ghost = card.cloneNode(true)
          if (!(ghost instanceof HTMLElement)) return
          copyLiveFieldValues(card, ghost)
          ghost.setAttribute(COMPOSER_GHOST_ATTRIBUTE, '')
          ghost.setAttribute('aria-hidden', 'true')
          ghost.setAttribute('inert', '')
          ghost.querySelectorAll('[id]').forEach((element) => { element.removeAttribute('id') })
          ghost.querySelectorAll('button, input, textarea, select, [tabindex]').forEach((element) => {
            element.tabIndex = -1
          })
          ghost.style.left = rect.left + 'px'
          ghost.style.top = rect.top + 'px'
          ghost.style.width = rect.width + 'px'
          ghost.style.height = rect.height + 'px'
          body.append(ghost)
          ghost.addEventListener('animationend', () => { ghost.remove() }, { once: true })
          schedule(() => { ghost.remove() }, GHOST_LIFETIME_MS)
        }
        const stageHeroExit = (root) => {
          const seat = seatOf(root)
          const card = root.querySelector(COMPOSER_CARD_SELECTOR_FILTERED)
          if (seat === null || card === null || seat.hasAttribute(COMPOSER_EXIT_ATTRIBUTE)) return
          mountExitGhost(card)
          seat.setAttribute(COMPOSER_EXIT_ATTRIBUTE, '')
        }
        const primaryButtonOf = (card) => {
          const buttons = card.querySelectorAll('button')
          return buttons.item(buttons.length - 1)
        }
        const onKeyDown = (event) => {
          const target = event.target
          if (!(target instanceof HTMLTextAreaElement)) return
          const root = phaseRootOf(target)
          if (root?.dataset.phase === 'active') {
            const seat = target.closest(COMPOSER_SEAT_SELECTOR)
            if (seat !== null) activateSeat(seat)
            return
          }
          if (root?.dataset.phase !== 'hero') return
          if (event.key !== 'Enter' || event.shiftKey || event.repeat || event.isComposing || event.keyCode === 229) return
          const card = target.closest(COMPOSER_CARD_SELECTOR)
          if (card === null || card.matches("[class*='cardWorkspaceTrigger']")) return
          if (card.querySelector("[aria-expanded='true']") !== null) return
          const primary = primaryButtonOf(card)
          if (primary === null || primary.disabled) return
          stageHeroExit(root)
        }
        const onFocusIn = (event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          const seat = target.closest(COMPOSER_SEAT_SELECTOR)
          if (seat !== null && phaseRootOf(seat)?.dataset.phase === 'active') activateSeat(seat)
        }
        const onFocusOut = (event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          const seat = target.closest(COMPOSER_SEAT_SELECTOR)
          if (seat === null) return
          queueMicrotask(() => {
            if (!seat.contains(doc.activeElement)) seat.removeAttribute(COMPOSER_INTERACTIVE_ATTRIBUTE)
          })
        }
        const onClick = (event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          const button = target.closest('button')
          const card = button?.closest(COMPOSER_CARD_SELECTOR)
          const root = card === null || card === undefined ? null : phaseRootOf(card)
          if (button === null || card === null || card === undefined || root?.dataset.phase !== 'hero') return
          if (button.disabled || primaryButtonOf(card) !== button) return
          stageHeroExit(root)
        }
        const bindScrollport = (scrollport) => {
          if (scrollBindings.has(scrollport)) return
          const binding = { lastTop: null, dispose: () => {} }
          const onWheel = (event) => {
            if (wheelBelongsToNestedSurface(event, scrollport)) return
            if (binding.lastTop === null) binding.lastTop = scrollport.scrollTop
            const seat = activeSeatOf(scrollport)
            if (seat === null || Math.abs(event.deltaY) <= SCROLL_THRESHOLD) return
            if (event.deltaY < 0) hideSeat(seat)
            else showSeat(seat)
          }
          const onScroll = () => {
            const top = scrollport.scrollTop
            const previousTop = binding.lastTop
            binding.lastTop = top
            const seat = activeSeatOf(scrollport)
            if (seat !== null) {
              const distanceToBottom = scrollport.scrollHeight - top - scrollport.clientHeight
              if (distanceToBottom <= BOTTOM_THRESHOLD) showSeat(seat)
              else if (previousTop !== null && top > previousTop + SCROLL_THRESHOLD) showSeat(seat)
              else if (previousTop !== null && top < previousTop - SCROLL_THRESHOLD) hideSeat(seat)
            }
          }
          scrollport.addEventListener('wheel', onWheel, { passive: true })
          scrollport.addEventListener('scroll', onScroll, { passive: true })
          binding.dispose = () => {
            scrollport.removeEventListener('wheel', onWheel)
            scrollport.removeEventListener('scroll', onScroll)
          }
          scrollBindings.set(scrollport, binding)
        }
        const synchronize = () => {
          doc.querySelectorAll(SCROLLPORT_SELECTOR).forEach((scrollport) => {
            bindScrollport(scrollport)
            const root = phaseRootOf(scrollport)
            if (root === null) return
            const phase = root.dataset.phase ?? ''
            const previous = phases.get(root)
            phases.set(root, phase)
            if (phase === 'hero') hasSeenHero = true
            const seat = seatOf(root)
            if (seat === null) return
            const wasOutsideChat = seat.hasAttribute(COMPOSER_OUTSIDE_CHAT_ATTRIBUTE)
            const belongsToConversation = composerBelongsToConversation(root)
            seat.toggleAttribute(COMPOSER_OUTSIDE_CHAT_ATTRIBUTE, !belongsToConversation)
            if (!belongsToConversation) {
              seat.removeAttribute(COMPOSER_EXIT_ATTRIBUTE)
              seat.removeAttribute(COMPOSER_ENTER_ATTRIBUTE)
              seat.removeAttribute(COMPOSER_INTERACTIVE_ATTRIBUTE)
              blurSeat(seat)
              return
            }
            if (phase === 'active') {
              if (
                wasOutsideChat
                || seat.hasAttribute(COMPOSER_EXIT_ATTRIBUTE)
                || previous === 'hero'
                || previous === 'settling'
                || (previous === undefined && hasSeenHero)
              ) enterSeat(seat)
            } else {
              if (!seat.hasAttribute(MANUAL_HIDDEN_ATTRIBUTE)) seat.removeAttribute(COMPOSER_HIDDEN_ATTRIBUTE)
              if (phase === 'hero') seat.removeAttribute(COMPOSER_ENTER_ATTRIBUTE)
            }
          })
        }
        const observer = new MutationObserver((records) => {
          if (hasMutationOutsideTerminal(records)) synchronize()
        })
        observer.observe(body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-phase'],
        })
        doc.addEventListener('keydown', onKeyDown, true)
        doc.addEventListener('click', onClick, true)
        doc.addEventListener('focusin', onFocusIn, true)
        doc.addEventListener('focusout', onFocusOut, true)
        synchronize()
        return () => {
          observer.disconnect()
          doc.removeEventListener('keydown', onKeyDown, true)
          doc.removeEventListener('click', onClick, true)
          doc.removeEventListener('focusin', onFocusIn, true)
          doc.removeEventListener('focusout', onFocusOut, true)
          scrollBindings.forEach((binding) => { binding.dispose() })
          scrollBindings.clear()
          timers.forEach((timer) => { clearTimeout(timer) })
          timers.clear()
          doc.querySelectorAll(COMPOSER_SEAT_SELECTOR).forEach(removeMotionAttributes)
          doc.querySelectorAll('[' + COMPOSER_GHOST_ATTRIBUTE + ']').forEach((ghost) => { ghost.remove() })
        }
      })()

      /* -------------------------- composer collapse --------------------- */

      const composerCollapseDisposer = (() => {
        const bindings = new Map()
        const timers = new Set()
        let activeDrag = null
        const prefersChinese = (doc.documentElement.lang || view?.navigator.language || 'en').toLowerCase().startsWith('zh')

        const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
        const schedule = (callback, delay) => {
          const timer = setTimeout(() => {
            timers.delete(timer)
            callback()
          }, delay)
          timers.add(timer)
        }
        const phaseRootOf = (element) => {
          let candidate = element
          while (candidate !== null) {
            if (
              candidate instanceof HTMLElement
              && candidate.hasAttribute('data-phase')
              && candidate.querySelector('[data-conversation-scroll]') !== null
            ) return candidate
            candidate = candidate.parentElement
          }
          return null
        }
        const composerBelongsToConversation = (root) => {
          const phase = root.dataset.phase ?? ''
          return phase === 'active' && root.querySelector(CHAT_FLOW_SELECTOR) !== null
        }
        const isPrimaryPointer = (event) => event.button === 0 && event.isPrimary !== false
        const clearDragProperties = (seat) => {
          seat.style.removeProperty('--orca-composer-drag-width')
          const binding = bindings.get(seat)
          if (binding !== undefined) {
            binding.dragFullWidth = 0
            binding.dragMinWidth = 0
          }
        }
        const blurSeat = (seat) => {
          const active = doc.activeElement
          if (active instanceof HTMLElement && seat.contains(active)) active.blur()
        }
        const setOwnedInert = (seat, inert) => {
          if (inert) {
            if (!seat.hasAttribute('inert')) {
              seat.setAttribute('inert', '')
              seat.setAttribute(OWNED_INERT_ATTRIBUTE, '')
            }
            return
          }
          if (seat.hasAttribute(OWNED_INERT_ATTRIBUTE)) {
            seat.removeAttribute('inert')
            seat.removeAttribute(OWNED_INERT_ATTRIBUTE)
          }
        }
        const applyDragProgress = (binding, progress) => {
          const seat = binding.seat
          const rect = binding.card.getBoundingClientRect()
          if (binding.dragFullWidth <= 0) binding.dragFullWidth = rect.width
          if (binding.dragMinWidth <= 0) {
            binding.dragMinWidth = Math.min(binding.dragFullWidth, clamp(rect.height, 96, 128))
          }
          const width = binding.dragFullWidth - (binding.dragFullWidth - binding.dragMinWidth) * progress
          seat.style.setProperty('--orca-composer-drag-width', width + 'px')
        }
        const anchorRestore = (binding, cardRect) => {
          const rootRect = binding.root.getBoundingClientRect()
          const rect = cardRect ?? binding.card.getBoundingClientRect()
          if (rootRect.width <= 0 || rootRect.height <= 0 || rect.width <= 0 || rect.height <= 0) return
          const left = clamp(rect.right - 16 - RESTORE_SIZE, rootRect.left + 8, rootRect.right - RESTORE_SIZE - 8)
          const top = clamp(rect.top - 36, rootRect.top + 8, rootRect.bottom - RESTORE_SIZE - 8)
          binding.anchor = {
            leftRatio: (left - rootRect.left) / rootRect.width,
            topRatio: (top - rootRect.top) / rootRect.height,
          }
          positionRestore(binding, rect)
        }
        const positionRestore = (binding, sourceRect) => {
          const button = binding.restore
          const anchor = binding.anchor
          if (button === null || anchor === null) return
          const rootRect = binding.root.getBoundingClientRect()
          const toBottom = binding.root.querySelector(TO_BOTTOM_SELECTOR)
          const toBottomRect = toBottom?.getBoundingClientRect()
          const belowToBottom = toBottomRect !== undefined && toBottomRect.width > 0 && toBottomRect.height > 0
          const left = belowToBottom
            ? clamp(toBottomRect.left + (toBottomRect.width - RESTORE_SIZE) / 2, rootRect.left + 8, rootRect.right - RESTORE_SIZE - 8)
            : clamp(rootRect.left + rootRect.width * anchor.leftRatio, rootRect.left + 8, rootRect.right - RESTORE_SIZE - 8)
          const top = belowToBottom
            ? clamp(toBottomRect.bottom + 8, rootRect.top + 8, rootRect.bottom - RESTORE_SIZE - 8)
            : clamp(rootRect.top + rootRect.height * anchor.topRatio, rootRect.top + 8, rootRect.bottom - RESTORE_SIZE - 8)
          button.style.left = left + 'px'
          button.style.top = top + 'px'
          if (sourceRect !== undefined) {
            const sourceX = sourceRect.left + sourceRect.width / 2
            const sourceY = sourceRect.top + sourceRect.height / 2
            button.style.setProperty('--orca-composer-restore-from-x', (sourceX - left - RESTORE_SIZE / 2) + 'px')
            button.style.setProperty('--orca-composer-restore-from-y', (sourceY - top - RESTORE_SIZE / 2) + 'px')
          }
        }
        const removeRestore = (binding) => {
          binding.restore?.remove()
          binding.restore = null
        }
        const restoreComposer = (binding) => {
          const seat = binding.seat
          if (!seat.hasAttribute(MANUAL_HIDDEN_ATTRIBUTE)) return
          binding.restore?.setAttribute(RESTORE_EXIT_ATTRIBUTE, '')
          seat.removeAttribute(MANUAL_HIDDEN_ATTRIBUTE)
          seat.removeAttribute('data-orca-composer-hidden')
          seat.removeAttribute(COLLAPSING_ATTRIBUTE)
          seat.removeAttribute(REBOUNDING_ATTRIBUTE)
          seat.setAttribute(RESTORING_ATTRIBUTE, '')
          setOwnedInert(seat, false)
          schedule(() => {
            seat.removeAttribute(RESTORING_ATTRIBUTE)
            clearDragProperties(seat)
            removeRestore(binding)
          }, RESTORE_LIFETIME_MS)
        }
        const mountRestore = (binding, cardRect) => {
          removeRestore(binding)
          const button = doc.createElement('button')
          button.type = 'button'
          button.setAttribute(RESTORE_ATTRIBUTE, '')
          button.setAttribute('aria-label', prefersChinese ? '显示输入框' : 'Show composer')
          const core = doc.createElement('span')
          core.setAttribute('data-orca-composer-restore-core', '')
          core.setAttribute('aria-hidden', 'true')
          button.append(core)
          button.addEventListener('click', () => { restoreComposer(binding) })
          body.append(button)
          binding.restore = button
          anchorRestore(binding, cardRect)
        }
        const commitCollapse = (binding) => {
          const seat = binding.seat
          if (seat.hasAttribute(MANUAL_HIDDEN_ATTRIBUTE)) return
          const cardRect = binding.card.getBoundingClientRect()
          applyDragProgress(binding, 1)
          blurSeat(seat)
          seat.removeAttribute(DRAGGING_ATTRIBUTE)
          seat.removeAttribute(REBOUNDING_ATTRIBUTE)
          seat.removeAttribute(RESTORING_ATTRIBUTE)
          seat.removeAttribute('data-orca-composer-entering')
          seat.removeAttribute('data-orca-composer-interactive')
          seat.removeAttribute('data-orca-composer-hidden')
          seat.setAttribute(MANUAL_HIDDEN_ATTRIBUTE, '')
          seat.setAttribute(COLLAPSING_ATTRIBUTE, '')
          setOwnedInert(seat, true)
          body.removeAttribute(BODY_DRAGGING_ATTRIBUTE)
          mountRestore(binding, cardRect)
          schedule(() => {
            seat.removeAttribute(COLLAPSING_ATTRIBUTE)
            clearDragProperties(seat)
          }, COLLAPSE_LIFETIME_MS)
        }
        const reboundComposer = (binding) => {
          const seat = binding.seat
          seat.removeAttribute(DRAGGING_ATTRIBUTE)
          seat.setAttribute(REBOUNDING_ATTRIBUTE, '')
          body.removeAttribute(BODY_DRAGGING_ATTRIBUTE)
          schedule(() => {
            seat.removeAttribute(REBOUNDING_ATTRIBUTE)
            clearDragProperties(seat)
          }, REBOUND_LIFETIME_MS)
        }
        const finishDrag = (commit) => {
          const drag = activeDrag
          if (drag === null) return
          activeDrag = null
          drag.binding.suppressClickUntil = Date.now() + 420
          if (drag.handle.hasPointerCapture?.(drag.pointerId)) {
            drag.handle.releasePointerCapture(drag.pointerId)
          }
          if (!drag.activated) {
            body.removeAttribute(BODY_DRAGGING_ATTRIBUTE)
            clearDragProperties(drag.binding.seat)
            return
          }
          if (commit) commitCollapse(drag.binding)
          else reboundComposer(drag.binding)
        }
        const onPointerMove = (event) => {
          const drag = activeDrag
          if (drag === null || event.pointerId !== drag.pointerId) return
          if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
            finishDrag(false)
            return
          }
          const inward = drag.side === 'left' ? event.clientX - drag.startX : drag.startX - event.clientX
          if (!drag.activated) {
            if (inward <= ACTIVATION_DEAD_ZONE) return
            drag.activated = true
            drag.binding.seat.removeAttribute(REBOUNDING_ATTRIBUTE)
            drag.binding.seat.setAttribute(DRAGGING_ATTRIBUTE, '')
            body.setAttribute(BODY_DRAGGING_ATTRIBUTE, drag.side)
          }
          drag.progress = clamp((inward - ACTIVATION_DEAD_ZONE) / (drag.distance - ACTIVATION_DEAD_ZONE), 0, 1)
          applyDragProgress(drag.binding, drag.progress)
          event.preventDefault()
        }
        const onPointerUp = (event) => {
          const drag = activeDrag
          if (drag === null || event.pointerId !== drag.pointerId) return
          finishDrag(drag.progress >= COMMIT_THRESHOLD)
        }
        const onPointerCancel = (event) => {
          if (activeDrag === null || event.pointerId !== activeDrag.pointerId) return
          finishDrag(false)
        }
        const onWindowBlur = () => {
          if (activeDrag !== null) finishDrag(false)
        }
        const onVisibilityChange = () => {
          if (doc.visibilityState === 'hidden' && activeDrag !== null) finishDrag(false)
        }
        const beginDrag = (event, binding, side, handle) => {
          if (!isPrimaryPointer(event) || activeDrag !== null) return
          if (binding.seat.hasAttribute(MANUAL_HIDDEN_ATTRIBUTE)) return
          const phase = binding.root.dataset.phase ?? ''
          if (phase !== 'active' || binding.root.querySelector(CHAT_FLOW_SELECTOR) === null) return
          const rect = binding.card.getBoundingClientRect()
          const width = rect.width
          binding.dragFullWidth = width
          binding.dragMinWidth = Math.min(width, clamp(rect.height, 96, 128))
          activeDrag = {
            binding,
            handle,
            pointerId: event.pointerId,
            side,
            startX: event.clientX,
            distance: clamp(width * 0.34, 88, 168),
            progress: 0,
            activated: false,
          }
          handle.setPointerCapture?.(event.pointerId)
          event.preventDefault()
        }
        const createHandle = (binding, side) => {
          const handle = doc.createElement('button')
          handle.type = 'button'
          handle.setAttribute(HANDLE_ATTRIBUTE, side)
          const label = prefersChinese
            ? (side === 'left' ? '向右' : '向左') + '拖动以收起输入框'
            : 'Drag ' + (side === 'left' ? 'right' : 'left') + ' to hide composer'
          handle.setAttribute('aria-label', label)
          handle.addEventListener('pointerdown', (event) => { beginDrag(event, binding, side, handle) })
          handle.addEventListener('lostpointercapture', (event) => {
            if (activeDrag === null || event.pointerId !== activeDrag.pointerId) return
            finishDrag(false)
          })
          handle.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            commitCollapse(binding)
          })
          handle.addEventListener('click', (event) => {
            if (Date.now() < binding.suppressClickUntil) return
            if (event.detail === 0) commitCollapse(binding)
          })
          return handle
        }
        const mountBinding = (seat) => {
          const root = phaseRootOf(seat)
          const card = seat.querySelector(COMPOSER_CARD_SELECTOR_FILTERED)
          if (root === null || card === null) return
          const phase = root.dataset.phase ?? ''
          let binding = bindings.get(seat)
          if (
            binding !== undefined && binding.card === card && binding.root === root
            && binding.mountedPhase === phase && binding.handles.length > 0
          ) {
            // The seat is fully mounted and untouched (only sibling DOM churn):
            // skip phase/compose checks entirely. A collapsed seat still
            // re-anchors its restore button because the mutation may have
            // moved the card.
            if (binding.restore !== null) positionRestore(binding)
            return
          }
          if (binding === undefined) {
            binding = { seat, card, root, handles: [], restore: null, anchor: null, suppressClickUntil: 0, dragFullWidth: 0, dragMinWidth: 0, mountedPhase: phase }
            bindings.set(seat, binding)
          } else {
            binding.root = root
            binding.mountedPhase = phase
            if (binding.card !== card) {
              binding.handles.forEach((handle) => { handle.remove() })
              binding.handles = []
              binding.card = card
            }
          }
          if (!composerBelongsToConversation(root)) {
            if (activeDrag?.binding === binding) finishDrag(false)
            binding.handles.forEach((handle) => { handle.remove() })
            binding.handles = []
            removeRestore(binding)
            setOwnedInert(seat, false)
            seat.removeAttribute(MANUAL_HIDDEN_ATTRIBUTE)
            seat.removeAttribute(DRAGGING_ATTRIBUTE)
            seat.removeAttribute(REBOUNDING_ATTRIBUTE)
            seat.removeAttribute(COLLAPSING_ATTRIBUTE)
            seat.removeAttribute(RESTORING_ATTRIBUTE)
            clearDragProperties(seat)
            return
          }
          if (binding.handles.length === 0) {
            const left = createHandle(binding, 'left')
            const right = createHandle(binding, 'right')
            card.append(left, right)
            binding.handles = [left, right]
          }
          if (binding.restore !== null) positionRestore(binding)
        }
        const removeBinding = (binding) => {
          binding.handles.forEach((handle) => { handle.remove() })
          binding.handles = []
          removeRestore(binding)
          setOwnedInert(binding.seat, false)
          binding.seat.removeAttribute(MANUAL_HIDDEN_ATTRIBUTE)
          binding.seat.removeAttribute(DRAGGING_ATTRIBUTE)
          binding.seat.removeAttribute(REBOUNDING_ATTRIBUTE)
          binding.seat.removeAttribute(COLLAPSING_ATTRIBUTE)
          binding.seat.removeAttribute(RESTORING_ATTRIBUTE)
          clearDragProperties(binding.seat)
        }
        const synchronize = () => {
          doc.querySelectorAll(COMPOSER_SEAT_SELECTOR).forEach(mountBinding)
          bindings.forEach((binding, seat) => {
            if (seat.isConnected) return
            removeBinding(binding)
            bindings.delete(seat)
          })
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || activeDrag === null) return
          event.preventDefault()
          finishDrag(false)
        }
        const onResize = () => {
          bindings.forEach((binding) => { positionRestore(binding) })
        }
        const observer = new MutationObserver((records) => {
          if (hasMutationOutsideTerminal(records)) synchronize()
        })
        observer.observe(body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-phase'],
        })
        doc.addEventListener('pointermove', onPointerMove, { passive: false })
        doc.addEventListener('pointerup', onPointerUp, true)
        doc.addEventListener('pointercancel', onPointerCancel, true)
        doc.addEventListener('keydown', onKeyDown, true)
        doc.addEventListener('visibilitychange', onVisibilityChange)
        view?.addEventListener('blur', onWindowBlur)
        view?.addEventListener('resize', onResize)
        synchronize()
        return () => {
          observer.disconnect()
          doc.removeEventListener('pointermove', onPointerMove)
          doc.removeEventListener('pointerup', onPointerUp, true)
          doc.removeEventListener('pointercancel', onPointerCancel, true)
          doc.removeEventListener('keydown', onKeyDown, true)
          doc.removeEventListener('visibilitychange', onVisibilityChange)
          view?.removeEventListener('blur', onWindowBlur)
          view?.removeEventListener('resize', onResize)
          if (activeDrag !== null) finishDrag(false)
          body.removeAttribute(BODY_DRAGGING_ATTRIBUTE)
          bindings.forEach(removeBinding)
          bindings.clear()
          timers.forEach((timer) => { clearTimeout(timer) })
          timers.clear()
          doc.querySelectorAll('[' + RESTORE_ATTRIBUTE + '], [' + HANDLE_ATTRIBUTE + ']').forEach((element) => { element.remove() })
        }
      })()

      /* ------------------------------ icons ----------------------------- */

      const iconsDisposer = (() => {
        const usageObservers = new Map()
        const normalizeHtml = (html) => html.replace(/\s+/g, ' ').trim()
        // Compile the fingerprint table into one alternation regex used as a
        // boolean pre-scan: during large DOM inserts (session load / switch,
        // skill pickers) most svgs are unrelated host glyphs, and one regex
        // test per svg replaces ~90 includes() calls. The ordered loop below
        // still decides the name, preserving the original first-key-in-table
        // precedence; the regex only answers "does any fingerprint appear?".
        const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, (match) => '\\' + match)
        const iconKeyRegex = new RegExp(ICON_KEYS.map(([key]) => escapeRegex(key)).join('|'))
        const hostHtml = (svg) => {
          const preexistingArt = svg.querySelector('[' + ICON_ART_ATTRIBUTE + ']')
          // A fresh, unreconciled svg carries only host markup: snapshot the
          // live innerHTML and skip the clone/remove dance entirely.
          if (preexistingArt === null) return normalizeHtml(svg.innerHTML)
          const clone = svg.cloneNode(true)
          clone.querySelectorAll('[' + ICON_ART_ATTRIBUTE + ']').forEach((node) => node.remove())
          return normalizeHtml(clone.innerHTML)
        }
        const matchIcon = (html) => {
          if (!iconKeyRegex.test(html)) return null
          for (const [key, name] of ICON_KEYS) {
            if (html.includes(key)) return name
          }
          return null
        }
        const artTransform = (svg) => {
          const viewBox = svg.getAttribute('viewBox')
          if (!viewBox) return ''
          const parts = viewBox.trim().split(/[\s,]+/).map(Number.parseFloat)
          const x = parts[0] ?? 0
          const y = parts[1] ?? 0
          const width = parts[2] ?? 0
          const height = parts[3] ?? 0
          if (!(width > 0) || !(height > 0)) return ''
          const scale = Math.min(width, height) / 16
          const offsetX = x + (width - 16 * scale) / 2
          const offsetY = y + (height - 16 * scale) / 2
          if (scale === 1 && offsetX === 0 && offsetY === 0) return ''
          return 'translate(' + offsetX + ' ' + offsetY + ') scale(' + scale + ')'
        }
        const buildUsageCells = () => {
          const cells = doc.createElementNS(SVG_NS, 'g')
          for (let index = 0; index < USAGE_CELLS; index += 1) {
            const rect = doc.createElementNS(SVG_NS, 'rect')
            const col = index % USAGE_COLS
            const row = Math.floor(index / USAGE_COLS)
            rect.setAttribute('data-orca-link-usage-cell', String(index))
            rect.setAttribute('x', String(USAGE_X0 + col * USAGE_PITCH))
            rect.setAttribute('y', String(USAGE_Y_BOTTOM - USAGE_CELL_SIZE - row * USAGE_PITCH))
            rect.setAttribute('width', String(USAGE_CELL_SIZE))
            rect.setAttribute('height', String(USAGE_CELL_SIZE))
            rect.setAttribute('fill', 'var(--orca-blue, currentColor)')
            rect.setAttribute('stroke', 'none')
            rect.setAttribute('opacity', String(USAGE_EMPTY_OPACITY))
            cells.append(rect)
          }
          return cells
        }
        const buildArt = (name, svg) => {
          const art = doc.createElementNS(SVG_NS, 'g')
          const transform = artTransform(svg)
          art.setAttribute(ICON_ART_ATTRIBUTE, '')
          art.setAttribute('fill', 'none')
          art.setAttribute('stroke', 'currentColor')
          art.setAttribute('stroke-width', /scale\(0\.[0-7]/.test(transform) ? '1.7' : '1.5')
          art.setAttribute('stroke-linejoin', 'miter')
          art.setAttribute('stroke-linecap', 'square')
          if (transform) art.setAttribute('transform', transform)
          art.innerHTML = ICON_ART[name] ?? ''
          if (name === 'usage') art.append(buildUsageCells())
          return art
        }
        const usageCircle = (svg) => (
          Array.from(svg.querySelectorAll('circle')).find((circle) => circle.hasAttribute('stroke-dasharray')) ?? null
        )
        const usageFraction = (circle) => {
          const parts = (circle.getAttribute('stroke-dasharray') ?? '').match(/[\d.]+/g)
          if (!parts || parts.length < 2) return null
          const dash = Number.parseFloat(parts[0] ?? '0')
          const total = dash + Number.parseFloat(parts[1] ?? '0')
          if (!Number.isFinite(total) || total <= 0) return null
          return Math.min(Math.max(dash / total, 0), 1)
        }
        const syncUsageFill = (svg, art) => {
          const cells = art.querySelectorAll('rect[data-orca-link-usage-cell]')
          const circle = usageCircle(svg)
          if (cells.length === 0 || !circle) return
          const fraction = usageFraction(circle)
          if (fraction === null) return
          const level = fraction * USAGE_CELLS
          const solid = Math.floor(level + 1e-9)
          const partial = level - solid
          cells.forEach((cell, index) => {
            let opacity = USAGE_EMPTY_OPACITY
            if (index < solid) opacity = 1
            else if (index === solid && partial > 0) opacity = Math.max(partial, USAGE_MIN_PARTIAL)
            cell.setAttribute('opacity', String(Math.round(opacity * 100) / 100))
          })
        }
        const observeUsage = (svg, art) => {
          syncUsageFill(svg, art)
          const circle = usageCircle(svg)
          if (circle === null || usageObservers.has(circle)) return
          const observer = new MutationObserver(() => syncUsageFill(svg, art))
          observer.observe(circle, { attributes: true, attributeFilter: ['stroke-dasharray'] })
          usageObservers.set(circle, observer)
        }
        const syncPermissionHost = (svg, name) => {
          if (!name.startsWith('permission-')) return
          const host = svg.closest('button, [role="menuitem"]')
          if (host instanceof HTMLElement) host.dataset.orcaPermission = name.slice('permission-'.length)
        }
        const applyToSvg = (svg) => {
          const name = matchIcon(hostHtml(svg))
          if (!name) return false
          svg.setAttribute(ICON_ATTRIBUTE, name)
          const art = buildArt(name, svg)
          if (name === 'usage') observeUsage(svg, art)
          svg.append(art)
          syncPermissionHost(svg, name)
          return true
        }
        const reconcileSvg = (svg) => {
          if (!svg.isConnected) return
          const art = svg.querySelector('[' + ICON_ART_ATTRIBUTE + ']')
          if (!(art instanceof SVGGElement)) {
            applyToSvg(svg)
            return
          }
          const currentName = svg.getAttribute(ICON_ATTRIBUTE)
          const nextName = matchIcon(hostHtml(svg))
          if (nextName !== null && nextName !== currentName) {
            if (currentName?.startsWith('permission-') && !nextName.startsWith('permission-')) {
              svg.closest('button, [role="menuitem"]')?.removeAttribute('data-orca-permission')
            }
            art.remove()
            svg.removeAttribute(ICON_ATTRIBUTE)
            applyToSvg(svg)
            return
          }
          if (currentName === 'usage') observeUsage(svg, art)
        }
        const collectContainingSvg = (node, found) => {
          if (!(node instanceof Element)) return
          const containing = node.closest('svg')
          if (containing instanceof SVGElement) found.add(containing)
        }
        const collectSvgSubtree = (node, found) => {
          if (!(node instanceof Element)) return
          collectContainingSvg(node, found)
          node.querySelectorAll('svg').forEach((svg) => {
            if (svg instanceof SVGElement) found.add(svg)
          })
        }
        const belongsToArt = (node) => (
          node instanceof Element && node.closest('[' + ICON_ART_ATTRIBUTE + ']') !== null
        )
        const pruneUsageObservers = () => {
          for (const [circle, observer] of usageObservers) {
            if (circle.isConnected) continue
            observer.disconnect()
            usageObservers.delete(circle)
          }
        }
        body.querySelectorAll('svg').forEach((svg) => {
          if (svg instanceof SVGElement) reconcileSvg(svg)
        })
        const mountObserver = new MutationObserver((records) => {
          if (!hasMutationOutsideTerminal(records)) return
          const changed = new Set()
          for (const record of records) {
            const nodes = [...record.addedNodes, ...record.removedNodes]
            if (nodes.length > 0 && nodes.every(belongsToArt)) continue
            collectContainingSvg(record.target, changed)
            record.addedNodes.forEach((node) => collectSvgSubtree(node, changed))
          }
          changed.forEach(reconcileSvg)
          pruneUsageObservers()
        })
        mountObserver.observe(body, { childList: true, subtree: true })
        return () => {
          mountObserver.disconnect()
          for (const observer of usageObservers.values()) observer.disconnect()
          usageObservers.clear()
          body.querySelectorAll('[' + ICON_ART_ATTRIBUTE + ']').forEach((node) => node.remove())
          body.querySelectorAll('[' + ICON_ATTRIBUTE + ']').forEach((node) => node.removeAttribute(ICON_ATTRIBUTE))
          body.querySelectorAll('[data-orca-permission]').forEach((node) => node.removeAttribute('data-orca-permission'))
        }
      })()

      /* -------------------------- pricing light ------------------------- */

      const pricingLightDisposer = (() => {
        const detectChinese = () => (doc.documentElement.lang || view.navigator.language || 'en').toLowerCase().startsWith('zh')
        const createLight = () => {
          const light = doc.createElement('div')
          light.className = CH.pricingLight
          light.dataset.orcaLinkPriceLight = ''
          light.dataset.skinChrome = 'pricing-light'
          light.dataset.skinOwner = SKIN_OWNER
          const housing = doc.createElement('div')
          housing.className = CH.pricingHousing
          housing.setAttribute('aria-hidden', 'true')
          housing.append(
            text('span', CH.pricingLamp + ' ' + CH.pricingLampRed, ''),
            text('span', CH.pricingLamp + ' ' + CH.pricingLampAmber, ''),
            text('span', CH.pricingLamp + ' ' + CH.pricingLampGreen, ''),
          )
          const label = text('span', CH.pricingLabel, 'LOW')
          label.dataset.orcaLinkPriceLabel = ''
          const tooltip = doc.createElement('div')
          tooltip.className = CH.pricingTooltip
          tooltip.dataset.orcaLinkPriceTooltip = ''
          const title = text('div', CH.pricingTooltipTitle, '')
          title.dataset.orcaLinkPriceTooltipTitle = ''
          tooltip.append(title)
          for (const [keyZh, , slot] of TOOLTIP_ROWS) {
            const row = text('div', CH.pricingTooltipRow, '')
            row.dataset.orcaLinkPriceRow = slot
            const key = text('span', CH.pricingTooltipKey, keyZh)
            key.dataset.orcaLinkPriceKey = slot
            const value = text('strong', CH.pricingTooltipValue, '')
            value.dataset.orcaLinkPriceValue = slot
            row.append(key, value)
            tooltip.append(row)
          }
          light.append(housing, label, tooltip)
          return light
        }
        let light = null
        let label = null
        let tooltip = null
        const mount = () => {
          const pane = body.querySelector(SIDEBAR_PANE_SELECTOR)
          if (pane === null) return
          const existing = pane.querySelector(':scope > ' + PRICE_LIGHT_SELECTOR)
          if (existing !== null) {
            light = existing
            label = existing.querySelector('[data-orca-link-price-label]')
            tooltip = existing.querySelector('[data-orca-link-price-tooltip]')
            return
          }
          const created = createLight()
          pane.append(created)
          ownedNodes.add(created)
          light = created
          label = created.querySelector('[data-orca-link-price-label]')
          tooltip = created.querySelector('[data-orca-link-price-tooltip]')
        }
        const render = () => {
          mount()
          if (light === null) return
          const zh = detectChinese()
          const schedule = priceScheduleAt(new Date(), zh)
          if (light.getAttribute('data-orca-link-price') !== schedule.band) light.setAttribute('data-orca-link-price', schedule.band)
          if (label !== null && label.textContent !== schedule.label) label.textContent = schedule.label
          light.setAttribute('aria-label', zh ? '定价状态：' + schedule.statusLine : 'Pricing status: ' + schedule.statusLine)
          if (tooltip !== null) {
            const titleElement = tooltip.querySelector('[data-orca-link-price-tooltip-title]')
            if (titleElement !== null) {
              const titleCopy = zh ? '定价信号 · 北京时区 UTC+8' : 'PRICING SIGNAL · BEIJING TZ UTC+8'
              if (titleElement.textContent !== titleCopy) titleElement.textContent = titleCopy
            }
            for (const [keyZh, keyEn, slot] of TOOLTIP_ROWS) {
              const keyElement = tooltip.querySelector("[data-orca-link-price-key='" + slot + "']")
              if (keyElement === null) continue
              const keyCopy = zh ? keyZh : keyEn
              if (keyElement.textContent !== keyCopy) keyElement.textContent = keyCopy
            }
            const lines = {
              status: schedule.statusLine,
              price: schedule.priceLine,
              next: schedule.nextChangeLine,
              'peak-windows': zh ? PEAK_WINDOWS_LINE.zh : PEAK_WINDOWS_LINE.en,
              'valley-windows': zh ? VALLEY_WINDOWS_LINE.zh : VALLEY_WINDOWS_LINE.en,
            }
            for (const [slot, value] of Object.entries(lines)) {
              const element = tooltip.querySelector("[data-orca-link-price-value='" + slot + "']")
              if (element !== null && element.textContent !== value) element.textContent = value
            }
          }
        }
        const observer = new MutationObserver((records) => {
          if (!hasMutationOutsideTerminal(records)) return
          if (light !== null && light.isConnected) return
          render()
        })
        observer.observe(body, { childList: true, subtree: true })
        const langObserver = new MutationObserver(() => {
          if (light !== null && light.isConnected) render()
        })
        langObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] })
        const interval = view.setInterval(render, POLL_INTERVAL_MS)
        render()
        return () => {
          view.clearInterval(interval)
          observer.disconnect()
          langObserver.disconnect()
          body.querySelectorAll(PRICE_LIGHT_SELECTOR).forEach((element) => element.remove())
        }
      })()

      /* ----------------------- terminal performance --------------------- */

      const terminalPerformanceDisposer = (() => {
        const TERMINAL_SELECTOR = '[data-dsh-better-sidebar] .xterm'
        const TERMINAL_WIDTH_LOCK_ATTRIBUTE = 'data-orca-terminal-width-locked'
        const TERMINAL_WIDTH_PROPERTY = '--orca-terminal-locked-width'
        const RESPONSIVE_SURFACE_SELECTOR = '[data-produced-files-row]'
        const RESPONSIVE_WIDTH_LOCK_ATTRIBUTE = 'data-orca-responsive-width-locked'
        const RESPONSIVE_WIDTH_PROPERTY = '--orca-responsive-locked-width'
        const TRANSITION_FALLBACK_MS = 380
        let frame = null
        let lockedHost = null
        let responsiveSurfaceLocks = []
        let unlockTimer
        const unlockTerminal = () => {
          if (unlockTimer !== undefined) view.clearTimeout(unlockTimer)
          unlockTimer = undefined
          lockedHost?.removeAttribute(TERMINAL_WIDTH_LOCK_ATTRIBUTE)
          lockedHost?.style.removeProperty(TERMINAL_WIDTH_PROPERTY)
          lockedHost = null
        }
        const unlockResponsiveSurfaces = () => {
          const locks = responsiveSurfaceLocks
          responsiveSurfaceLocks = []
          for (const { surface, hadAttribute, originalWidth, lockedWidth } of locks) {
            if (surface.style.getPropertyValue(RESPONSIVE_WIDTH_PROPERTY) !== lockedWidth) continue
            if (originalWidth === '') surface.style.removeProperty(RESPONSIVE_WIDTH_PROPERTY)
            else surface.style.setProperty(RESPONSIVE_WIDTH_PROPERTY, originalWidth)
            if (!hadAttribute && surface.hasAttribute(RESPONSIVE_WIDTH_LOCK_ATTRIBUTE)) {
              surface.removeAttribute(RESPONSIVE_WIDTH_LOCK_ATTRIBUTE)
            }
          }
        }
        const unlockTransitionSurfaces = () => {
          unlockTerminal()
          unlockResponsiveSurfaces()
        }
        const scheduleUnlock = () => {
          if (unlockTimer !== undefined) view.clearTimeout(unlockTimer)
          unlockTimer = view.setTimeout(unlockTransitionSurfaces, TRANSITION_FALLBACK_MS)
        }
        const lockTerminal = () => {
          if (frame?.hasAttribute('data-dragging') === true) {
            unlockTransitionSurfaces()
            return
          }
          const terminal = body.querySelector(TERMINAL_SELECTOR)
          const host = terminal?.parentElement
          if (!(host instanceof HTMLElement)) return
          if (host !== lockedHost) {
            unlockTerminal()
            const width = host.getBoundingClientRect().width
            if (width <= 0) return
            lockedHost = host
            host.style.setProperty(TERMINAL_WIDTH_PROPERTY, width + 'px')
            host.setAttribute(TERMINAL_WIDTH_LOCK_ATTRIBUTE, '')
          }
        }
        const lockResponsiveSurfaces = () => {
          if (responsiveSurfaceLocks.length > 0) return
          for (const surface of body.querySelectorAll(RESPONSIVE_SURFACE_SELECTOR)) {
            const width = surface.getBoundingClientRect().width
            if (width <= 0) continue
            const lockedWidth = width + 'px'
            responsiveSurfaceLocks.push({
              surface,
              hadAttribute: surface.hasAttribute(RESPONSIVE_WIDTH_LOCK_ATTRIBUTE),
              originalWidth: surface.style.getPropertyValue(RESPONSIVE_WIDTH_PROPERTY),
              lockedWidth,
            })
            surface.style.setProperty(RESPONSIVE_WIDTH_PROPERTY, lockedWidth)
            surface.setAttribute(RESPONSIVE_WIDTH_LOCK_ATTRIBUTE, '')
          }
        }
        const lockTransitionSurfaces = () => {
          if (frame?.hasAttribute('data-dragging') === true) {
            unlockTransitionSurfaces()
            return
          }
          lockTerminal()
          lockResponsiveSurfaces()
          scheduleUnlock()
        }
        const onTransitionEnd = (event) => {
          if (event.target === frame && event.propertyName === 'grid-template-columns') unlockTransitionSurfaces()
        }
        const frameObserver = new MutationObserver((records) => {
          if (frame?.hasAttribute('data-dragging') === true) {
            unlockTransitionSurfaces()
            return
          }
          if (records.some((record) => record.attributeName !== 'data-dragging')) lockTransitionSurfaces()
        })
        const mountFrame = () => {
          const next = body.querySelector(APP_FRAME_SELECTOR)
          if (next === frame) return
          frameObserver.disconnect()
          frame?.removeEventListener('transitionend', onTransitionEnd)
          unlockTransitionSurfaces()
          frame = next
          frame?.addEventListener('transitionend', onTransitionEnd)
          if (frame !== null) {
            frameObserver.observe(frame, {
              attributes: true,
              attributeFilter: ['style', 'data-sidebar-collapsed', 'data-details-collapsed', 'data-dragging'],
            })
          }
        }
        const observer = new MutationObserver((records) => {
          if (hasMutationOutsideTerminal(records)) mountFrame()
        })
        observer.observe(body, { childList: true, subtree: true })
        mountFrame()
        return () => {
          observer.disconnect()
          frameObserver.disconnect()
          frame?.removeEventListener('transitionend', onTransitionEnd)
          unlockTransitionSurfaces()
        }
      })()

      /* -------------------------- window resume ------------------------- */

      const windowResumeDisposer = (() => {
        const WINDOW_RESUMING_ATTRIBUTE = 'data-orca-window-resuming'
        const POINTER_RELEASE_DISTANCE_PX = 2
        const originallyResuming = body.hasAttribute(WINDOW_RESUMING_ATTRIBUTE)
        let lastPointer = null
        const suppress = () => body.setAttribute(WINDOW_RESUMING_ATTRIBUTE, '')
        const release = () => body.removeAttribute(WINDOW_RESUMING_ATTRIBUTE)
        const onPointerMove = (event) => {
          const previous = lastPointer
          lastPointer = { x: event.clientX, y: event.clientY }
          if (!body.hasAttribute(WINDOW_RESUMING_ATTRIBUTE) || previous === null) return
          const distance = Math.abs(event.clientX - previous.x) + Math.abs(event.clientY - previous.y)
          if (distance >= POINTER_RELEASE_DISTANCE_PX) release()
        }
        const onVisibilityChange = () => suppress()
        doc.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
        doc.addEventListener('pointerdown', release, true)
        doc.addEventListener('keydown', release, true)
        doc.addEventListener('visibilitychange', onVisibilityChange)
        view?.addEventListener('blur', suppress)
        view?.addEventListener('focus', suppress)
        return () => {
          doc.removeEventListener('pointermove', onPointerMove, true)
          doc.removeEventListener('pointerdown', release, true)
          doc.removeEventListener('keydown', release, true)
          doc.removeEventListener('visibilitychange', onVisibilityChange)
          view?.removeEventListener('blur', suppress)
          view?.removeEventListener('focus', suppress)
          body.toggleAttribute(WINDOW_RESUMING_ATTRIBUTE, originallyResuming)
        }
      })()

      /* ------------------------- settings overlay ----------------------- */

      const settingsOverlayDisposer = (() => {
        const SETTINGS_DIALOG_SELECTOR = "[data-slot='sidebar.settings'] [role='dialog']"
        const SETTINGS_OPEN_ATTRIBUTE = 'data-orca-settings-open'
        const CORDIS_PANEL_SELECTOR = "[data-slot='sidebar.footer.action'] [data-cordis-panel]"
        const CORDIS_OPEN_ATTRIBUTE = 'data-orca-cordis-panel-open'
        const LAMP_ATTRIBUTE = 'data-orca-lamp'
        const LAMP_FLICKER_MS = 1000
        const originallyOpen = body.hasAttribute(SETTINGS_OPEN_ATTRIBUTE)
        const originallyCordisOpen = body.hasAttribute(CORDIS_OPEN_ATTRIBUTE)
        const originalLamp = body.getAttribute(LAMP_ATTRIBUTE)
        let lampTimer
        let wasDark = body.hasAttribute('data-ds-dark-theme')
        const triggerLamp = () => {
          if (body.hasAttribute('data-ds-dark-theme') !== true) return
          body.setAttribute(LAMP_ATTRIBUTE, 'flicker')
          if (lampTimer !== undefined) clearTimeout(lampTimer)
          lampTimer = setTimeout(() => {
            if (body.getAttribute(LAMP_ATTRIBUTE) === 'flicker') body.removeAttribute(LAMP_ATTRIBUTE)
          }, LAMP_FLICKER_MS)
        }
        const synchronizeTheme = () => {
          const isDark = body.hasAttribute('data-ds-dark-theme')
          if (wasDark && !isDark) {
            if (lampTimer !== undefined) clearTimeout(lampTimer)
            body.removeAttribute(LAMP_ATTRIBUTE)
          }
          wasDark = isDark
        }
        const synchronize = () => {
          const wasOpen = body.hasAttribute(SETTINGS_OPEN_ATTRIBUTE)
          body.toggleAttribute(SETTINGS_OPEN_ATTRIBUTE, body.querySelector(SETTINGS_DIALOG_SELECTOR) !== null)
          const isOpen = body.hasAttribute(SETTINGS_OPEN_ATTRIBUTE)
          if (wasOpen && !isOpen) triggerLamp()
          body.toggleAttribute(CORDIS_OPEN_ATTRIBUTE, body.querySelector(CORDIS_PANEL_SELECTOR) !== null)
        }
        const observer = new MutationObserver((records) => {
          if (hasMutationOutsideTerminal(records)) synchronize()
          synchronizeTheme()
        })
        observer.observe(body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-ds-dark-theme'],
        })
        synchronize()
        synchronizeTheme()
        return () => {
          observer.disconnect()
          if (lampTimer !== undefined) clearTimeout(lampTimer)
          body.toggleAttribute(SETTINGS_OPEN_ATTRIBUTE, originallyOpen)
          body.toggleAttribute(CORDIS_OPEN_ATTRIBUTE, originallyCordisOpen)
          if (originalLamp === null) body.removeAttribute(LAMP_ATTRIBUTE)
          else body.setAttribute(LAMP_ATTRIBUTE, originalLamp)
        }
      })()

      /* --------------------------- rail search -------------------------- */

      const railSearchDisposer = (() => {
        const SEARCH_INPUT_SELECTOR = "[data-slot='sidebar'] input[class*='searchInput']"
        const SEARCH_BUTTON_SELECTOR = "button[class*='searchButton']"
        const RECHECK_DELAY_MS = 320
        const pending = new Map()
        const searchContextOf = (target) => {
          if (!(target instanceof HTMLInputElement)) return null
          if (!target.matches(SEARCH_INPUT_SELECTOR)) return null
          let node = target.parentElement
          for (let depth = 0; depth < 3 && node instanceof HTMLElement; depth += 1) {
            if (node.querySelector(SEARCH_BUTTON_SELECTOR)) return { row: node, input: target }
            node = node.parentElement
          }
          return null
        }
        const onFocusIn = (event) => {
          const context = searchContextOf(event.target)
          if (!context) return
          const { row, input } = context
          const previous = pending.get(input)
          if (previous !== undefined) clearTimeout(previous)
          const timer = setTimeout(() => {
            pending.delete(input)
            if (doc.activeElement !== input) return
            const button = row.querySelector(SEARCH_BUTTON_SELECTOR)
            if (!button || button.getAttribute('aria-expanded') !== 'false') return
            if (!body.hasAttribute(SIDEBAR_WIDE_ATTRIBUTE)) return
            button.click()
          }, RECHECK_DELAY_MS)
          pending.set(input, timer)
        }
        body.addEventListener('focusin', onFocusIn)
        body.addEventListener('focus', onFocusIn, true)
        return () => {
          body.removeEventListener('focusin', onFocusIn)
          body.removeEventListener('focus', onFocusIn, true)
          for (const timer of pending.values()) clearTimeout(timer)
          pending.clear()
        }
      })()

      /* ------------------------- sidebar width sync --------------------- */

      const syncSidebarWidth = (pane) => {
        const measuredWidth = pane.getBoundingClientRect().width
        if (measuredWidth <= 0) return 0
        const frame = body.querySelector(APP_FRAME_SELECTOR)
        const firstTrack = frame?.style.gridTemplateColumns.trim().match(/^(-?(?:\d+|\d*\.\d+))px(?:\s|$)/)?.[1]
        const targetWidth = firstTrack === undefined ? measuredWidth : Number.parseFloat(firstTrack)
        const width = Number.isFinite(targetWidth) && targetWidth > 0 ? targetWidth : measuredWidth
        const serializedWidth = width + 'px'
        if (body.style.getPropertyValue(SIDEBAR_WIDTH_PROPERTY) !== serializedWidth) {
          body.style.setProperty(SIDEBAR_WIDTH_PROPERTY, serializedWidth)
        }
        const wide = width > 96
        if (body.hasAttribute(SIDEBAR_WIDE_ATTRIBUTE) !== wide) {
          body.toggleAttribute(SIDEBAR_WIDE_ATTRIBUTE, wide)
        }
        return width
      }

      const sidebarSyncDisposer = (() => {
        let observedSidebar = null
        let sidebarArtWidthTimer
        const syncObservedSidebar = (pane) => {
          const width = syncSidebarWidth(pane)
          if (sidebarArtWidthTimer !== undefined) clearTimeout(sidebarArtWidthTimer)
          sidebarArtWidthTimer = undefined
          if (width <= 96) return
          if (body.style.getPropertyValue(SIDEBAR_ART_WIDTH_PROPERTY) === '') {
            body.style.setProperty(SIDEBAR_ART_WIDTH_PROPERTY, width + 'px')
            return
          }
          sidebarArtWidthTimer = setTimeout(() => {
            const stableWidth = Number.parseFloat(body.style.getPropertyValue(SIDEBAR_WIDTH_PROPERTY))
            if (stableWidth > 96) body.style.setProperty(SIDEBAR_ART_WIDTH_PROPERTY, stableWidth + 'px')
            sidebarArtWidthTimer = undefined
          }, 180)
        }
        const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
          if (observedSidebar) syncObservedSidebar(observedSidebar)
        })
        const mountSidebarObserver = () => {
          const pane = doc.querySelector(SIDEBAR_PANE_SELECTOR)
          if (!pane) return false
          if (pane !== observedSidebar) {
            resizeObserver?.disconnect()
            observedSidebar = pane
            resizeObserver?.observe(pane)
          }
          syncObservedSidebar(pane)
          return true
        }
        let sidebarMountObserver = null
        if (!mountSidebarObserver()) {
          sidebarMountObserver = new MutationObserver(() => {
            if (mountSidebarObserver()) sidebarMountObserver?.disconnect()
          })
          sidebarMountObserver.observe(body, { childList: true, subtree: true })
        }
        return () => {
          sidebarMountObserver?.disconnect()
          resizeObserver?.disconnect()
          if (sidebarArtWidthTimer !== undefined) clearTimeout(sidebarArtWidthTimer)
        }
      })()

      /* ------------------------ wordmark observer ----------------------- */

      const wordmarkObserver = new MutationObserver((records) => {
        if (!hasMutationOutsideTerminal(records)) return
        mountDshWordmark()
      })

      /* ---------------------------- assembly ---------------------------- */

      disposers.push(
        sceneDisposer,
        composerMotionDisposer,
        composerCollapseDisposer,
        typewriterDisposer,
        iconsDisposer,
        railSearchDisposer,
        windowResumeDisposer,
        terminalPerformanceDisposer,
        settingsOverlayDisposer,
        linkStatusDisposer,
        statusCharacterDisposer,
        pricingLightDisposer,
        sidebarSyncDisposer,
      )
      mountDshWordmark()
      // Register both the nodes mounted now and any the observer re-mounts
      // later; re-created chrome is swept by the orphan cleanup below.
      for (const node of ownedWordmarkNodes) ownedNodes.add(node)
      wordmarkObserver.observe(body, { childList: true, subtree: true })
      disposers.push(() => {
        wordmarkObserver.disconnect()
        doc.querySelectorAll('[data-orca-link-wordmark], [data-orca-link-signal]').forEach((node) => node.remove())
        doc.querySelectorAll('[data-orca-link-brand]').forEach((node) => node.removeAttribute('data-orca-link-brand'))
      })
    },
  }
}
