/**
 * Affinity score — pure, clock-injected. The pet grows closer the more you
 * work together and care for it: every completed turn earns a small reward,
 * petting earns a tiny one (cooldown-gated), feeding earns the most.
 * Persistence lives in the service; this module only computes transitions.
 * @module @linxin666/dsh-pet/affinity
 */

/** One interaction the user can perform on the pet. */
export type PetInteraction = 'pet' | 'feed'

/** Affinity state as persisted. */
export interface AffinityState {
  /** Total affinity points, capped at AFFINITY_MAX. */
  points: number
  /** Epoch ms of the last pet interaction. */
  lastPetAt: number
  /** Epoch ms of the last feed. */
  lastFeedAt: number
  /** Total pet count (lifetime). */
  pets: number
  /** Total feed count (lifetime). */
  feeds: number
  /** Total completed turns witnessed (lifetime). */
  turns: number
}

export const AFFINITY_MAX = 100

/** Affinity ranks by points; the pet visibly grows with its rank.
 *  Marker glyphs are plain ASCII (the repo bans all emoji characters);
 *  they read as a growing star trail alongside the rank name. */
export const AFFINITY_RANKS = [
  { min: 0, name: '幼鲸', emoji: '*' },
  { min: 25, name: '伙伴', emoji: '**' },
  { min: 50, name: '挚友', emoji: '***' },
  { min: 80, name: '深海羁绊', emoji: '****' },
] as const

/** Interaction tuning (all in points / ms). */
export interface AffinityConfig {
  /** Points per completed turn. */
  turnReward: number
  /** Points per pet; applied only outside the pet cooldown. */
  petReward: number
  /** Cooldown between pets, ms. */
  petCooldownMs: number
  /** Points per feed. */
  feedReward: number
  /** Cooldown between feeds, ms. */
  feedCooldownMs: number
}

export const defaultAffinityConfig: AffinityConfig = {
  turnReward: 1,
  petReward: 1,
  petCooldownMs: 10_000,
  feedReward: 5,
  feedCooldownMs: 30_000,
}

export function emptyAffinity(): AffinityState {
  return { points: 0, lastPetAt: 0, lastFeedAt: 0, pets: 0, feeds: 0, turns: 0 }
}

/** Outcome of one interaction. */
export interface InteractionOutcome {
  /** Mutated affinity state (caller persists it). */
  affinity: AffinityState
  /** Points actually gained (0 when inside the cooldown). */
  delta: number
  /** Human-readable reaction copy the UI shows as a bubble. */
  reaction: string
  /** True when the interaction was accepted (outside cooldown). */
  accepted: boolean
}

/** Rank for a point total. */
export function rankOf(points: number): (typeof AFFINITY_RANKS)[number] {
  let rank: (typeof AFFINITY_RANKS)[number] = AFFINITY_RANKS[0]!
  for (const candidate of AFFINITY_RANKS) {
    if (points >= candidate.min) rank = candidate
  }
  return rank
}

/** Read-only affinity snapshot suited for the RPC view shape. */
export interface PetAffinityView {
  points: number
  rank: string
  rankEmoji: string
  pets: number
  feeds: number
  turns: number
  /** True while the pet interaction is inside its cooldown. */
  petCooldown: boolean
  /** True while the feed is inside its cooldown. */
  feedCooldown: boolean
}

/** Derive the read-only view of one affinity state at a wall-clock instant. */
export function affinityViewOf(
  state: AffinityState,
  nowMs: number,
  config: AffinityConfig = defaultAffinityConfig,
): PetAffinityView {
  const rank = rankOf(state.points)
  return {
    points: state.points,
    rank: rank.name,
    rankEmoji: rank.emoji,
    pets: state.pets,
    feeds: state.feeds,
    turns: state.turns,
    petCooldown: nowMs - state.lastPetAt < config.petCooldownMs,
    feedCooldown: nowMs - state.lastFeedAt < config.feedCooldownMs,
  }
}

function clamp(points: number): number {
  return Math.min(AFFINITY_MAX, Math.max(0, points))
}

/**
 * Reaction pools (plain strings; the repo bans emoji). The interaction picks
 * one line deterministically by rotating on the lifetime interaction count,
 * so repeated petting/feeding stays lively and the choice is testable.
 */
export const PET_REACTIONS: string[] = [
  '咕噜咕噜～被摸摸好舒服！',
  '蹭蹭你的手心～',
  '唔…这里也要摸摸！',
  '尾巴开心地翘起来啦～',
  '被摸得眯起了眼睛…',
  '哼～再摸一下下就原谅你',
  '好温暖…不想动了…',
]

/** Pet cooldown pool, rotated by the lifetime pet count. */
export const PET_COOLDOWN_REACTIONS: string[] = [
  '摸过头啦，让鲸鱼娘歇口气～',
  '头有点晕晕的…先停一下！',
  '毛都要被摸秃啦！',
  '让鱼鳍先缓缓…',
  '呜…再摸就要咬你了！',
]

/** Feed success pool, rotated by the lifetime feed count. */
export const FEED_REACTIONS: string[] = [
  '呜哇！小鱼干好好吃！',
  '咔嚓咔嚓～尾巴都翘起来啦！',
  '好吃到眯起了眼睛～',
  '再多给一点嘛！',
  '今天的鱼干格外香！',
]

/** Feed cooldown pool, rotated by the lifetime feed count. */
export const FEED_COOLDOWN_REACTIONS: string[] = [
  '吃饱啦，晚点再喂～',
  '肚子圆滚滚的了…',
  '鱼干先留着，待会再吃！',
  '嗝～真的吃不下了！',
  '省着点吃，明天还有！',
]

/**
 * Apply one interaction to a copy of the state (immutable style: returns a
 * new object; the caller replaces the persisted state). Cooldowns only
 * apply once the pet has been interacted with at least once (last*At === 0
 * means "never", so the first pet/feed always lands).
 */
export function applyInteraction(
  state: AffinityState,
  kind: PetInteraction,
  nowMs: number,
  config: AffinityConfig = defaultAffinityConfig,
): InteractionOutcome {
  const next = { ...state }
  if (kind === 'pet') {
    if (state.lastPetAt !== 0 && nowMs - state.lastPetAt < config.petCooldownMs) {
      return {
        affinity: state,
        delta: 0,
        reaction: PET_COOLDOWN_REACTIONS[state.pets % PET_COOLDOWN_REACTIONS.length]!,
        accepted: false,
      }
    }
    next.lastPetAt = nowMs
    next.pets += 1
    next.points = clamp(state.points + config.petReward)
    return {
      affinity: next,
      delta: config.petReward,
      reaction: PET_REACTIONS[state.pets % PET_REACTIONS.length]!,
      accepted: true,
    }
  }
  if (kind === 'feed') {
    if (state.lastFeedAt !== 0 && nowMs - state.lastFeedAt < config.feedCooldownMs) {
      return {
        affinity: state,
        delta: 0,
        reaction: FEED_COOLDOWN_REACTIONS[state.feeds % FEED_COOLDOWN_REACTIONS.length]!,
        accepted: false,
      }
    }
    next.lastFeedAt = nowMs
    next.feeds += 1
    next.points = clamp(state.points + config.feedReward)
    return {
      affinity: next,
      delta: config.feedReward,
      reaction: FEED_REACTIONS[state.feeds % FEED_REACTIONS.length]!,
      accepted: true,
    }
  }
  return { affinity: state, delta: 0, reaction: '', accepted: false }
}

/** Reward one completed turn (called by the host on `done`). */
export function applyTurnReward(
  state: AffinityState,
  config: AffinityConfig = defaultAffinityConfig,
): AffinityState {
  const next = { ...state }
  next.turns += 1
  next.points = clamp(state.points + config.turnReward)
  return next
}
