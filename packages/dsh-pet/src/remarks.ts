/**
 * Pet remark (reaction copy) library — pure. Reaction bubbles the pet speaks
 * on interaction events come from two layers:
 *  - the built-in default library below (a generous pool per event kind);
 *  - per-pet custom lines declared in a manifest's 'remarks' block, which
 *    community pet contributions (PRs) use to give their pet its own voice.
 * A custom slot replaces the built-in pool for that slot only; the other
 * slots keep the built-in lines. Picks cycle round-robin within a pool so
 * repeated interactions stay varied while tests stay deterministic (no
 * randomness, no clock).
 * @module @linxin666/dsh-pet/remarks
 */

/** Interaction events a reaction line can accompany. */
export type RemarkKind = 'pet' | 'petCooldown' | 'feed' | 'feedCooldown' | 'noTreats'

/** Every remark slot, in a stable order. */
export const REMARK_KINDS: readonly RemarkKind[] = [
  'pet',
  'petCooldown',
  'feed',
  'feedCooldown',
  'noTreats',
]

/** Per-pet remark overrides (normalized shape; each slot is a line pool). */
export type PetRemarks = Partial<Record<RemarkKind, string[]>>

/** Raw manifest shape: each slot accepts one line or a pool of lines. */
export type PetRemarksManifest = Partial<Record<RemarkKind, string | string[]>>

/** Longest accepted reaction line (characters, trimmed before slicing). */
export const REMARK_LINE_MAX = 120
/** Longest accepted pool per slot. */
export const REMARK_LINES_MAX = 64

/**
 * Built-in default remark library. Every pool is plain zh copy in the
 * whale-girl voice; the first line of each pool is the legacy reaction the
 * plugin has always spoken, so existing installs and tests keep their
 * wording while the pool adds variety. No emoji characters anywhere (the
 * repo bans them); ～ is the whale-girl's signature.
 */
export const BUILTIN_REMARKS: Readonly<Record<RemarkKind, readonly string[]>> = {
  pet: [
    '咕噜咕噜～被摸摸好舒服！',
    '再摸摸这里，痒痒的～',
    '头顶温度刚刚好，安心～',
    '被摸到耳朵啦，扑通扑通！',
    '你的手掌好温暖，舍不得你走～',
    '呼噜呼噜～就靠在这里不走了！',
    '今天的摸头也收货成功！',
    '蹭蹭你的手心，这是回礼～',
    '多摸摸我，亲密度会涨哦！',
    '闭眼享受中，请勿打扰～',
  ],
  petCooldown: [
    '摸过头啦，让鲸鱼娘歇口气～',
    '羽毛都快被摸秃啦，缓一缓～',
    '呼……先让我喘口气嘛！',
    '再摸就要睡着了哦～',
    '稍微休息一下，待会儿再摸～',
    '头顶要冒烟啦，停一停！',
    '我知道你喜欢我，但也要节制呀～',
    '歇一歇，摸摸的手感会更好哦～',
    '咕……等我回个蓝～',
    '让我先消化一下刚才的爱！',
  ],
  feed: [
    '呜哇！小鱼干好好吃！',
    '咔嚓咔嚓，美味到尾巴打结～',
    '这条小鱼干是刚晒好的，好香！',
    '谢谢你，胃里暖暖的～',
    '囤粮 +1，今天也有好好被爱！',
    '好吃到想转圈圈～',
    '小鱼干最好吃了，再来亿条！',
    '饱餐一顿，马上满血复活～',
    '这个味道，是幸福的味道！',
    '吃完了还不忘舔舔爪子～',
  ],
  feedCooldown: [
    '吃饱啦，晚点再喂～',
    '肚子圆滚滚的，装不下啦～',
    '再喂就要变成球啦！',
    '让我慢慢消化这份心意～',
    '小鱼干的香气还没散呢～',
    '呼……满足得动不了了～',
    '先散步一圈再吃下一顿！',
    '肚皮已经鼓鼓的啦～',
    '好吃是好吃，可也得节制呀～',
    '等我饿了会告诉你哦～',
  ],
  noTreats: [
    '没有小鱼干了，多陪我工作一会儿吧～',
    '粮仓空空，陪我完成几轮任务就会有小鱼干啦～',
    '小鱼干在路上啦，先一起加油工作！',
    '嘴巴寂寞了……快去完成一轮任务！',
    '陪我多工作一会儿，鱼干自动到账～',
    '现在喂我也只会饿着肚子说谢谢哦～',
    '粮仓见底啦，用几轮任务换一条鱼干吧～',
    '饿着肚子等你完成下一轮任务～',
    '小鱼干藏在你的工作里，去找找看！',
    '先工作后干饭，我们的约定哦～',
  ],
}

/** The legacy first line of one kind (direct callers' fallback copy). */
export function builtinRemark(kind: RemarkKind): string {
  return BUILTIN_REMARKS[kind][0]!
}

/**
 * Normalize a manifest 'remarks' block into per-kind line pools. Unknown
 * slots and non-string entries are skipped with a warning; empty pools are
 * dropped so the built-in library takes the slot. Returns undefined when no
 * usable slot remains.
 */
export function normalizePetRemarks(
  raw: unknown,
  onWarning: (message: string) => void = () => {},
): PetRemarks | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    onWarning('remarks must be an object with pet/petCooldown/feed/feedCooldown/noTreats slots')
    return undefined
  }
  const remarks: PetRemarks = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!REMARK_KINDS.includes(key as RemarkKind)) {
      onWarning('unknown remarks slot ' + JSON.stringify(key))
      continue
    }
    const lines = (Array.isArray(value) ? value : [value])
      .filter((line): line is string => typeof line === 'string')
      .map(line => line.trim())
      .filter(line => line !== '')
      .slice(0, REMARK_LINES_MAX)
      .map(line => line.slice(0, REMARK_LINE_MAX))
    if (lines.length === 0) {
      onWarning('remarks slot ' + key + ' carries no usable lines')
      continue
    }
    remarks[key as RemarkKind] = lines
  }
  return Object.keys(remarks).length === 0 ? undefined : remarks
}

/**
 * Round-robin reaction picker over the effective pools (per-pet custom lines
 * override the built-in pool per slot). Counters are per slot, so each slot
 * cycles its own list independently and picks stay deterministic for tests.
 */
export class RemarkPicker {
  private readonly counters = new Map<RemarkKind, number>()
  private readonly pools: Record<RemarkKind, readonly string[]>

  constructor(overrides?: PetRemarks) {
    this.pools = {} as Record<RemarkKind, readonly string[]>
    for (const kind of REMARK_KINDS) {
      const custom = overrides?.[kind]
      this.pools[kind] = custom !== undefined && custom.length > 0 ? custom : BUILTIN_REMARKS[kind]
    }
  }

  /** The effective pool for one slot (custom override or built-in). */
  pool(kind: RemarkKind): readonly string[] {
    return this.pools[kind]
  }

  /** The next line for one slot (round-robin within its pool). */
  pick(kind: RemarkKind): string {
    const pool = this.pools[kind]
    const index = (this.counters.get(kind) ?? 0) % pool.length
    this.counters.set(kind, index + 1)
    return pool[index]!
  }
}
