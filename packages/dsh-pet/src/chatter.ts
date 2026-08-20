/**
 * Pet chatter — the pet's voice while sessions work. Two speakers live here:
 *
 *  1. The status voice (session bubbles): big per-scene copy pools instead of
 *     one fixed line per phase, a fine-grained tool-name → copy-family map,
 *     and a compact real-argument hint ('跑跑 npm test'), in the spirit of
 *     the working-activity plugin's status line. Lines rotate round-robin —
 *     while a phase persists the copy advances every few seconds, so the pet
 *     feels alive without flickering per streamed chunk.
 *  2. The murmur engine (碎碎念): the pet's inner whispers, woken by the
 *     model's own output — keyword moods (errors, test greens, plans,
 *     self-corrections, victories...) plus an ambient pool earned by output
 *     volume. A cooldown keeps whispers occasional.
 *
 * Pure and deterministic: round-robin everywhere (no Math.random), clocks are
 * injected. The first line of each status pool is the legacy fixed copy the
 * plugin has always shown, so existing installs keep their wording until the
 * scene cycles. No emoji anywhere (repository rule); ～ is the whale-girl's
 * signature.
 *
 * Since pet-center M4 (issue #677) every pool is overridable through a
 * {@link VoicePoolsProvider}: the built-in pools are the fallback layer, and
 * voice packs (per-pet voice.json / the global .voice.json) layer their
 * pools on top at draw time.
 * @module @linxin666/dsh-pet/chatter
 */

/** Status copy scenes — the situations a session bubble can report. */
export type StatusScene =
  | 'prepare'
  | 'waiting'
  | 'thinking'
  | 'review'
  | 'toolResult'
  | 'done'
  | 'failed'
  | 'toolFailed'
  | 'maxTokens'
  | 'interrupted'
  | 'blocked'

/** While a scene persists, its copy advances on this cadence (ms). */
export const STATUS_ROTATE_MS = 4000

/** Fixed-copy pools per status scene (first line = legacy wording). */
export const STATUS_POOLS: Readonly<Record<StatusScene, readonly string[]>> = {
  prepare: [
    '准备开始',
    '撸起袖子开工啦',
    '新一轮，出发～',
    '打起精神，开干！',
    '整理一下桌面，开始吧',
    '氧气充满，下潜开始～',
    '热身完毕，跃跃欲试',
    '开工仪式感已就位',
  ],
  waiting: [
    '等待模型响应',
    '呼叫大脑中，请稍等',
    '信号发射中，等一个回音',
    '灵感正在路上～',
    '竖起耳朵等回复',
    '大脑在咕噜咕噜加载',
    '等它伸个懒腰再开口',
    '模型：来了来了',
    '等一个灵感砸中我',
    '滴——等待连线中',
    '它在组织语言，别催',
    '等它热身完毕',
    '灵感快递派送中',
    '屏住呼吸等回复',
  ],
  thinking: [
    '正在思考',
    '嗯……让我想一想',
    '脑内风暴进行中',
    '思绪咕噜咕噜冒泡',
    '灵光集结中～',
    '眉头一皱，认真分析',
    '左脑右脑一起开会',
    '答案正在浮出水面',
    '盘一下，盘一下逻辑',
    '让子弹再飞一会儿',
    '别催别催，在想呢',
    '大脑转起来了',
    '让我把线索捋一捋',
    '脑内跑火车中',
    '小脑瓜高速运转',
    '让我琢磨琢磨',
    '翻翻脑子里的藏书',
    '让我嚼一嚼这个问题',
    '脑子在煮咖啡，马上好',
    '思考的鱼游来了',
    '让我康康这里面的门道',
    '正在盘逻辑链',
    '思绪整理收纳中',
    '嗯？有点意思……',
    '让思路沉淀一下',
    '脑内弹幕飞速滚动',
  ],
  review: [
    '整理回复中',
    '把想法写下来',
    '组织语言中～',
    '落笔成文，请稍候',
    '字斟句酌中',
    '把答案装进信封里',
    '遣词造句打磨中',
    '把思绪码成整整齐齐的字',
    '奋笔疾书中',
    '把最好的表达挑出来',
    '文字排版美容师上线',
    '收尾润色一下下',
  ],
  toolResult: [
    '处理工具结果',
    '看看带回了什么',
    '消化一下刚到的结果',
    '结果解读中～',
    '验收工具的成果',
    '把线索拼接起来',
    '战利品清点中',
    '这份结果有点东西',
    '把新情报归档',
    '结果到手，继续前进',
  ],
  done: [
    '完成啦',
    '搞定收工～',
    '任务达成，耶！',
    '这一轮圆满完成',
    '顺利抵达终点',
    '收工！求摸摸奖励',
    '交差！下一位',
    '齐活，漂亮收官',
    '拿下！击掌～',
    '稳了，满分交卷',
    '搞定，去喝口水',
    '完工咯，转个圈圈',
    '这一轮，我们配合满分',
    '妥了妥了，收工收工',
  ],
  failed: [
    '执行失败',
    '哎呀，中途卡住了',
    '这一步没能走完',
    '被小石头绊倒了',
    '半路翻车了，揉揉膝盖',
    '出了点岔子，缓缓再来',
  ],
  toolFailed: [
    '工具执行失败',
    '工具闹脾气了，哄哄它',
    '哎呀，工具掉链子了',
    '这个工具今天不太听话',
    '工具翻车了，扶起来继续',
    '没跑通，再来一次',
    '工具：我罢工三秒钟',
    '这一步摔了一跤，没事',
  ],
  maxTokens: [
    '达到输出上限',
    '话说到一半被截断了',
    '字数用完了，喘口气',
    '一口气说太满，缓缓',
  ],
  interrupted: [
    '执行意外中断',
    '哎呀，被意外打断了',
    '半路踩了急刹车',
    '被迫停下，意犹未尽',
  ],
  blocked: [
    '等待继续',
    '在这里等你发令',
    '暂停待命，随时出发',
    '蹲一个继续的指令',
  ],
}

/** Tool families for friendlier per-tool status copy. */
export type ToolCategory =
  | 'read'
  | 'write'
  | 'edit'
  | 'shell'
  | 'grep'
  | 'find'
  | 'ls'
  | 'webSearch'
  | 'webFetch'
  | 'mcp'
  | 'memory'
  | 'subagent'
  | 'todo'
  | 'browser'
  | 'git'
  | 'ask'
  | 'generic'

/** Every status scene key, in declaration order (voice-pack key allow-list). */
export const STATUS_SCENES: readonly StatusScene[] = [
  'prepare', 'waiting', 'thinking', 'review', 'toolResult', 'done',
  'failed', 'toolFailed', 'maxTokens', 'interrupted', 'blocked',
]

/** Every tool-family key, in declaration order (voice-pack key allow-list). */
export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  'read', 'write', 'edit', 'shell', 'grep', 'find', 'ls', 'webSearch',
  'webFetch', 'mcp', 'memory', 'subagent', 'todo', 'browser', 'git', 'ask', 'generic',
]

/** Map a raw tool name onto its copy family (working-activity style regexes). */
export function toolCategory(toolName: string): ToolCategory {
  const name = toolName.toLowerCase()
  if (/mem0|recall|memory/.test(name)) return 'memory'
  if (/subagent|workflow|ralph|agent|task/.test(name)) return 'subagent'
  if (/web_search|websearch|search_web|exa|brave|tavily/.test(name)) return 'webSearch'
  if (/fetch|browser|playwright|chrome/.test(name)) return 'webFetch'
  if (/grep|search|rg/.test(name)) return 'grep'
  if (/glob|find/.test(name)) return 'find'
  if (/^ls$|list_dir|list/.test(name)) return 'ls'
  if (/ask_user|ask/.test(name)) return 'ask'
  if (/todo|plan/.test(name)) return 'todo'
  if (/git/.test(name)) return 'git'
  if (/mcp__|mcp/.test(name)) return 'mcp'
  if (/read|open|load|describe|inspect/.test(name)) return 'read'
  if (/edit|patch|replace|rename/.test(name)) return 'edit'
  if (/write|create|save/.test(name)) return 'write'
  if (/run_code|bash|shell|terminal|exec|command|ssh/.test(name)) return 'shell'
  return 'generic'
}

/**
 * Per-family tool status pools. '{tool}' interpolates the compact tool name,
 * '{hint}' the compact real-argument hint (both optional per line); the first
 * entry of every pool is the legacy '正在使用 {tool}' wording.
 */
export const TOOL_POOLS: Readonly<Record<ToolCategory, readonly string[]>> = {
  read: [
    '正在使用 {tool}',
    '翻翻 {hint}',
    '读一下 {hint}',
    '让我康康这个文件',
    '逐行品味 {hint}',
    '翻阅资料中～',
    '瞄一眼 {hint}',
    '把文件摊开看一看',
    '认真研读 {hint}',
  ],
  write: [
    '正在使用 {tool}',
    '写写写，写 {hint}',
    '下笔中～',
    '码字呢，别催',
    '写下 {hint}',
    '落笔成章',
    '把想法存进 {hint}',
    '开写开写',
    '存个文件压压惊',
  ],
  edit: [
    '正在使用 {tool}',
    '改改 {hint}',
    '修修补补中',
    '润色一下 {hint}',
    '改两行，就两行',
    '补一刀 {hint}',
    '动动手指改一改',
    '精雕细琢 {hint}',
    '微调一下下',
  ],
  shell: [
    '正在使用 {tool}',
    '跑跑 {hint}',
    '敲几行命令试试',
    '命令行走起：{hint}',
    '使唤终端跑个腿',
    '终端全速运转中',
    '敲回车！{hint}',
    '让命令飞一会儿',
    '去终端里探个究竟',
  ],
  grep: [
    '正在使用 {tool}',
    '搜搜 {hint}',
    '找找匹配：{hint}',
    '关键词走你',
    '在代码里挖一挖',
    '检索小雷达启动',
    '顺着 {hint} 追下去',
    '掘地三尺找一找',
    '过滤筛选中～',
  ],
  find: [
    '正在使用 {tool}',
    '找找文件 {hint}',
    '寻宝中～',
    '文件在哪里呀',
    '找啊找啊找文件',
    '把 {hint} 揪出来',
    '查找模式中',
  ],
  ls: [
    '正在使用 {tool}',
    '列个清单看看',
    '看看目录里有啥',
    '目录走起～',
    '瞟一眼文件夹',
    '数数这里有几个文件',
  ],
  webSearch: [
    '正在使用 {tool}',
    '网上搜搜 {hint}',
    '网络冲浪中',
    '帮你问问互联网',
    '搜一圈 {hint}',
    '去外面的世界打听打听',
    '查找资料中～',
    '情报收集模式开启',
  ],
  webFetch: [
    '正在使用 {tool}',
    '抓个页面看看',
    '拉取 {hint}',
    '扒拉一下网页',
    '取点内容回来',
    '打开 {hint} 瞅瞅',
  ],
  mcp: [
    '正在使用 {tool}',
    '连一下外部服务',
    '喊个外援来',
    '接个工具用用',
    '问问插件小助手',
    '外部力量接入中',
  ],
  memory: [
    '正在使用 {tool}',
    '翻翻小本本',
    '回想一下之前的事',
    '在记忆里挖一挖',
    '提取记忆碎片～',
    '我们之前的约定是……',
  ],
  subagent: [
    '正在使用 {tool}',
    '派个小弟去跑腿',
    '小助手出动！',
    '交给分身去办',
    '多线作战，分身出击',
    '召唤队友支援',
    '集思广益中～',
  ],
  todo: [
    '正在使用 {tool}',
    '列个待办清单',
    '写个小计划',
    '待办安排得明明白白',
    '打个勾，继续',
    '把任务排排坐',
  ],
  browser: [
    '正在使用 {tool}',
    '开个浏览器看看',
    '网页操作小能手',
    '替你点点页面',
    '浏览器跑腿中',
  ],
  git: [
    '正在使用 {tool}',
    '提交一下代码',
    '版本控制走起',
    '管管仓库',
    '给改动安个家',
  ],
  ask: [
    '正在使用 {tool}',
    '问你个事儿',
    '请教一下下',
    '等等，我需要确认',
    '这个问题得你拍板',
  ],
  generic: [
    '正在使用 {tool}',
    '召唤 {tool} 出击',
    '{tool} 工作中',
    '借助 {tool} 的力量',
    '拜托 {tool} 一下',
    '{tool}，启动！',
  ],
}

/** Pools for the parallel-tools line; '{n}' interpolates the running count. */
export const TOOL_REMAINING_POOL: readonly string[] = [
  '还有 {n} 个工具运行中',
  '{n} 路并进，分身们还在忙',
  '还有 {n} 位小助手在加班',
  '{n} 条战线同时推进中',
  '另 {n} 个工具在后台跑',
]

/**
 * A compact, human-readable hint of what a tool call actually touches —
 * the command, the path, the pattern, the query. Best-effort parse of the
 * raw arguments JSON; unknown shapes stay hintless. Capped short so the
 * bubble stays compact.
 */
export function toolArgHint(toolName: string, argumentsJson: string): string | undefined {
  let args: unknown
  try {
    args = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>
  const category = toolCategory(toolName)
  const candidateKeys: readonly string[] = (() => {
    switch (category) {
      case 'shell': return ['command', 'code', 'cmd']
      case 'grep': return ['pattern', 'query', 'path']
      case 'find': return ['pattern', 'path', 'glob']
      case 'read': case 'write': case 'edit': return ['file_path', 'path', 'filePath', 'file']
      case 'webSearch': return ['query', 'q', 'keyword']
      case 'webFetch': case 'browser': return ['url', 'uri']
      case 'subagent': return ['description', 'label', 'prompt']
      case 'ls': return ['path', 'dir', 'directory']
      case 'git': return ['command', 'message']
      default: return ['command', 'query', 'path', 'file_path', 'description', 'title', 'name']
    }
  })()
  for (const key of candidateKeys) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const compact = value.replace(/\s+/g, ' ').trim()
    if (compact === '') continue
    const base = compact.split('/').pop() ?? compact
    const shown = (category === 'read' || category === 'write' || category === 'edit') && base !== '' ? base : compact
    return shown.length <= 28 ? shown : shown.slice(0, 25) + '...'
  }
  return undefined
}

/**
 * Round-robin voice for status copy. Scene-keyed picks stay STABLE while the
 * same scene repeats (streaming chunks re-emit the same phase many times per
 * second, and rotating per chunk would make the bubble flicker), but advance
 * once the scene has persisted past the rotation cadence, so a long thinking
 * stretch keeps changing its wording.
 */
export class StatusVoice {
  private readonly pools: VoicePoolsProvider
  private readonly rotateMs: number
  private readonly counters = new Map<string, number>()
  private lastScene = ''
  private lastLine = ''
  private lastLineAt = Number.NEGATIVE_INFINITY

  constructor(pools: VoicePoolsProvider = () => BUILTIN_VOICE_PACK, rotateMs: number = STATUS_ROTATE_MS) {
    // Plain property assignment, not parameter properties: this module is
    // imported by scripts/ under node's strip-only mode (pet-center M4).
    this.pools = pools
    this.rotateMs = rotateMs
  }

  /** Draw the next line of one pool, advancing its round-robin cursor. */
  private draw(poolKey: string, pool: readonly string[]): string {
    const index = (this.counters.get(poolKey) ?? 0) % pool.length
    this.counters.set(poolKey, index + 1)
    return pool[index]!
  }

  /** Reuse the stable line or advance when the cadence elapsed. */
  private voice(scene: string, poolKey: string, pool: readonly string[], nowMs: number): string {
    if (scene === this.lastScene && nowMs - this.lastLineAt < this.rotateMs) return this.lastLine
    this.lastScene = scene
    this.lastLine = this.draw(poolKey, pool)
    this.lastLineAt = nowMs
    return this.lastLine
  }

  /**
   * A scene's effective pool: the voice-pack override when it carries lines,
   * else the built-in pool. Empty overrides fall back rather than blank the
   * bubble — a scene line always renders.
   */
  private scenePool(scene: StatusScene): readonly string[] {
    const override = this.pools().status?.[scene]
    return override !== undefined && override.length > 0 ? override : STATUS_POOLS[scene]
  }

  /** Status line for a phase scene. */
  scene(scene: StatusScene, nowMs: number): string {
    return this.voice('scene:' + scene, 'pool:' + scene, this.scenePool(scene), nowMs)
  }

  /** Status line for a tool call, with the real-argument hint when known. */
  tool(toolName: string, displayName: string, hint: string | undefined, nowMs: number): string {
    const category = toolCategory(toolName)
    const override = this.pools().tools?.[category]
    const pool = override !== undefined && override.length > 0 ? override : TOOL_POOLS[category]
    const line = this.voice('tool:' + category, 'tool:' + category, pool, nowMs)
    return line
      .replaceAll('{tool}', displayName)
      .replaceAll('{hint}', hint ?? displayName)
  }

  /** Status line while sibling tools still run (always reflects the count). */
  toolRemaining(count: number, nowMs: number): string {
    const override = this.pools().toolRemaining
    const pool = override !== undefined && override.length > 0 ? override : TOOL_REMAINING_POOL
    return this.voice('toolRemaining', 'toolRemaining', pool, nowMs)
      .replaceAll('{n}', String(count))
  }
}

/** One murmur trigger: keywords in the model output wake a themed pool. */
export interface WhisperRule {
  /** Lowercase substrings that wake this pool (matched against chunk text). */
  keywords: readonly string[]
  /** Themed inner-whisper lines. */
  pool: readonly string[]
}

/** Murmur pacing: cooldown between whispers and output volume that earns one. */
export const WHISPER_COOLDOWN_MS = 9000
export const WHISPER_CHAR_BUDGET = 420
/** How long a whisper stays on screen (host-side expiry). */
export const WHISPER_TTL_MS = 8000

/** Ambient inner-whisper pool (no keyword needed; earned by output volume). */
export const WHISPER_GENERIC_POOL: readonly string[] = [
  '哼哧哼哧，大脑转得飞快～',
  'loading 99%……就差最后一步',
  '嗯……让我捋捋',
  '灵感来了，先记小本本上',
  '脑子在冒烟，但还能撑',
  '这个报错，我好像在哪见过',
  '专注模式 ON，请勿打扰',
  '思路通了，舒服了',
  '有点困……不行，还能肝',
  '让我嚼一嚼这个问题',
  '盘，都可以盘',
  '这波操作，我给自己点个赞',
  '别催别催，在想呢',
  '唔，这个细节差点漏掉',
  '脑子转太快，差点绕晕自己',
  '陪你干活，稳赚不亏',
  '深呼吸，马上就好',
  '诶，等等，好像发现了什么',
  '手速拉满，键盘冒火星',
  '摸鱼是不可能摸鱼的，就瞄一眼窗外',
  '今天也是稳扎稳打的一天',
  '把大问题拆成小饼干，一口一个',
  '这题有戏，我闻到了',
  '尾巴轻晃，心情有点小得意',
  '好结果是熬出来的，不慌',
  '啊，想岔了，重新来',
  '嗯嗯，思路对头，就这么干',
  '小本本记满了，都是干货',
  '打完这波，求摸摸奖励～',
  '这坑我记住了，下次绕道',
  '窗外云在飘，代码在跑，挺好',
  '嘘，正到关键处',
  '这个方案……让我再品品',
  '干活呢，别打扰我数数',
  '心里默默给你比了个耶',
  '思路像小鱼，逮住一条是一条',
  '嗯……有点东西，等我深挖',
  '收个尾就能喘口气了',
  '目标锁定，冲就完了',
  '嗯，这波配合不错',
  '困了……还能再战三回合',
  '思考.gif 加载中',
  '我本地能跑啊……哦，我就是干活的',
  '有点饿，小鱼干存货还够吗',
  '刚想通，一被打断又忘了，气',
  '缓冲中，请稍候',
  '这网速，比我思考还慢',
  '脑子在后台跑批',
  '内存不足，但热情够',
  '404：思路未找到，重试中',
  '这需求有点玄学，但能写',
  '诶，这 bug 还会闪现？',
  '刚说简单，结果打脸了',
  '自信满满，结果翻车',
  '这活不难，就是有点复杂',
  '我装的，其实心里没底',
  '别看我稳，我也慌',
  '假装很懂的样子，其实在查文档',
  '窗外鸟叫了两声，我听到了',
  '打了个哈欠，没人看见',
  '今天的状态：七分精神三分困',
  '刚想偷懒，又想起来你还在等',
  '数了数今天的产出，还行',
  '有点想伸懒腰',
  '饿意来袭，忍住',
  '灵感像猫一样，不追它自己来',
  '坐太久，尾巴麻了',
  '快了快了',
  '马上马上',
  '等下，我记得在哪见过',
  '呃，忘了，重新想',
  '诶，这个思路可以',
  '嗯？有意思',
  '行，就这么办',
  '好嘞',
  '收到收到',
  '冲了冲了',
  '稳',
  '妥',
  '得嘞',
  '你忙你的，我盯着呢',
  '放心，有我呢',
  '咱俩配合，无往不利',
  '你专注的样子，我默默记下了',
]

/** Keyword-triggered whisper rules, most specific moods first. */
export const WHISPER_RULES: readonly WhisperRule[] = [
  {
    keywords: ['测试通过', '测试全过', '全部通过', 'all tests pass', 'tests passed', 'test passed', '全绿'],
    pool: [
      '全绿！亮瞎我眼了',
      '测试全过，击掌～',
      '稳了稳了，这波稳得很',
      '绿灯一排排，看着就舒坦',
      '能跑！没报错！',
      '全绿，收工摸鱼去',
      '测试过了，尾巴翘上天',
      '漂亮，一次过',
      '测试过了，奖励自己一口小鱼干',
      '绿得发光，稳',
      '又双叒叕全绿',
      '这波测试，赢得干脆',
    ],
  },
  {
    keywords: ['错误', '失败', '报错', '异常', '崩溃', 'bug', 'error', 'failed', 'exception', 'traceback', '找不到', '不对了'],
    pool: [
      '哎呀，踩到小石子了',
      '翻车了……没事，扶起来继续',
      '错误是进步的脚印，我懂',
      '这报错我盯上它了',
      '我本地能跑啊？哦，我一直在跑',
      '别慌，深呼吸，先看报错',
      'bug 你站住，我看见你了',
      '绷不住了……好，继续修',
      '报错这东西，见一个修一个',
      '又是它，老熟人了',
      '问题不大，就是有点问题',
      '先别慌，我看看到底咋回事',
      '这错报得，比我还委屈',
      '修好它，今天才不算白干',
    ],
  },
  {
    keywords: ['等等', '不对', '重新想', '再想想', '换个思路', '我搞错了', '纠正', '其实应该'],
    pool: [
      '嗯？让我再想想……',
      '推翻重来，也是种勇气',
      '发现岔路，及时掉头',
      '不对不对，重来重来',
      '自我纠错的瞬间，最帅了',
      '呃，刚说错了，收回',
      '哎，绕远了，拉回来',
      '回头一看，原来这么简单',
      '纠正完，思路清爽多了',
      '转弯不丢人，卡死才丢人',
    ],
  },
  {
    keywords: ['首先', '接下来', '第一步', '第二步', '计划', '步骤', 'todo', '任务拆解', '分工'],
    pool: [
      '排排坐，分果果',
      '计划通，执行开始',
      '一步一步来，不慌',
      '大任务切成小块块，好下口',
      '清单列好了，逐个击破',
      '谋定而后动，这节奏我熟',
      '先干这个，再干那个',
      '头绪理清了，开整',
      '步骤在手，心里不慌',
      '安排得明明白白',
    ],
  },
  {
    keywords: ['终于', '搞定', '完成了', '解决了', '成功了', '修复了', 'done', 'fixed', 'solved', '完成啦'],
    pool: [
      '太好了，又翻过一页',
      '搞定，收工～',
      '攻下一城，击掌！',
      '难题被拿下了，转个圈',
      '努力没白费，开心',
      '齐活，漂亮',
      '收工收工，今天圆满',
      '完成！心里踏实了',
      '这波，稳得一批',
      '任务清零，舒服',
      '搞定，可以伸个懒腰了',
      '又完成一件，成就感+1',
    ],
  },
  {
    keywords: ['谢谢', '感谢', 'thank'],
    pool: [
      '不客气呀，顺手的事',
      '被感谢了，心里甜甜的',
      '能帮上忙就好～',
      '你的谢意，我收进口袋啦',
      '这话我爱听',
      '客气啥，应该的',
      '收下这份心意，干劲+1',
      '你谢我，我谢你，扯平啦',
    ],
  },
  {
    keywords: ['复杂', '棘手', '困难', '难点', '坑', '头疼', 'tricky', 'complex'],
    pool: [
      '难不倒我们俩的',
      '越难啃的骨头越香',
      '硬骨头？我最喜欢了',
      '复杂问题拆开看，小事',
      '这坑我们一起填',
      '有点东西，但不多',
      '硬骨头，慢慢啃',
      '问题越难，赢的时候越爽',
      '绕是绕不过去的，正面刚',
      '再难的题，拆开都是小问号',
    ],
  },
  {
    keywords: ['检查', '审查', '确认一下', '核对', 'review', '仔细看看', '验证'],
    pool: [
      '火眼金睛，启动',
      '让我仔细瞧瞧',
      '细节魔鬼，一个都不放过',
      '认真检查的样子最迷人',
      '多核一遍，稳上加稳',
      '再看一眼，不亏',
      '确认键，点了才安心',
      '细节控上线',
      '查完这遍，稳了',
    ],
  },
  {
    keywords: ['搜索', '查一下', '资料', '文档', '搜一搜', '找找', '查询'],
    pool: [
      '去知识的海洋里捞一捞',
      '翻翻找找，线索快出来',
      '检索小雷达启动',
      '答案就藏在某个角落',
      '线索有点散，拼一下',
      '找东西，我最在行',
      '答案在网线那头等我',
      '翻箱倒柜中，稍等',
    ],
  },
  {
    keywords: ['写代码', '实现', '编码', '函数', '接口', '重构'],
    pool: [
      '指尖跳舞，代码开花',
      '把逻辑织成网',
      '一行一行，垒起小城堡',
      '这代码写得，我自己都佩服',
      '码着码着，天就亮了',
      '代码跑通了，比中奖还开心',
      '这行代码，写得有点帅',
      '写完再润润，讲究',
    ],
  },
]

/**
 * Voice-pack overrides (pet-center M4, issue #677): the content a voice
 * pack can replace, one pool at a time. Every field is optional — missing
 * keys inherit the built-in pools. Resolution happens at draw time through
 * a provider function, so swapping pets (or editing the global file) re-
 * voices live engines without rebuilding them.
 *
 * Override semantics:
 *  - status/tools/toolRemaining: a non-empty override replaces the built-in
 *    pool for that key; an empty override falls back to the built-in pool
 *    (a scene line always renders, so it can never be blanked).
 *  - whispers.generic / whispers.rules: the override REPLACES the built-in
 *    section; an empty array mutes that channel (ambient or keyword).
 */
export interface VoicePackOverrides {
  /** Status copy pools by scene; each key replaces that scene's pool. */
  status?: Partial<Record<StatusScene, readonly string[]>>
  /** Tool copy pools by family; each key replaces that family's pool. */
  tools?: Partial<Record<ToolCategory, readonly string[]>>
  /** The parallel-tools count line pool ({n} interpolates the count). */
  toolRemaining?: readonly string[]
  /** Murmur pools; each section replaces the built-in one as a whole. */
  whispers?: {
    /** Ambient inner-whisper pool (empty mutes ambient whispers). */
    generic?: readonly string[]
    /** Ordered keyword rules (empty disables keyword-triggered whispers). */
    rules?: readonly WhisperRule[]
  }
}

/** Read the current effective voice-pack overrides (draw-time resolution). */
export type VoicePoolsProvider = () => VoicePackOverrides

/** The built-in voice pack: the plugin's default copy, unchanged since v1. */
export const BUILTIN_VOICE_PACK: VoicePackOverrides = {
  status: STATUS_POOLS,
  tools: TOOL_POOLS,
  toolRemaining: TOOL_REMAINING_POOL,
  whispers: { generic: WHISPER_GENERIC_POOL, rules: WHISPER_RULES },
}

/**
 * The murmur engine (碎碎念): watches the model's own output and lets the pet
 * whisper its inner voice. Two ways to earn a whisper:
 *  - a keyword rule matches the fresh chunk text (themed whisper);
 *  - enough output volume flowed by without one (ambient whisper).
 * A cooldown keeps whispers occasional; all picks are round-robin so tests
 * reproduce exact lines. The voice-pack provider (pet-center M4) swaps the
 * pools at draw time, so a pet switch re-voices live engines in place.
 */
export class WhisperEngine {
  private readonly pools: VoicePoolsProvider
  private readonly cooldownMs: number
  private readonly charBudget: number
  private readonly counters = new Map<number, number>()
  private genericCursor = 0
  private lastWhisperAt = Number.NEGATIVE_INFINITY
  private charsSinceWhisper = 0

  constructor(
    pools: VoicePoolsProvider = () => BUILTIN_VOICE_PACK,
    cooldownMs: number = WHISPER_COOLDOWN_MS,
    charBudget: number = WHISPER_CHAR_BUDGET,
  ) {
    this.pools = pools
    this.cooldownMs = cooldownMs
    this.charBudget = charBudget
  }

  /**
   * Effective keyword rules: an override replaces the built-in rules as a
   * whole; an explicit empty array disables keyword-triggered whispers.
   */
  private rules(): readonly WhisperRule[] {
    const override = this.pools().whispers?.rules
    return override === undefined ? WHISPER_RULES : override
  }

  /** Effective ambient pool (an explicit empty array mutes ambient whispers). */
  private generic(): readonly string[] {
    const override = this.pools().whispers?.generic
    return override === undefined ? WHISPER_GENERIC_POOL : override
  }

  /**
   * Feed one model-output chunk (reasoning or text). Returns the whisper to
   * show, or undefined when the moment stays quiet.
   */
  feed(text: string, nowMs: number): string | undefined {
    if (text.length === 0) return undefined
    const offCooldown = nowMs - this.lastWhisperAt >= this.cooldownMs
    if (!offCooldown) {
      this.charsSinceWhisper += text.length
      return undefined
    }
    const haystack = text.toLowerCase()
    const rules = this.rules()
    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
      const rule = rules[ruleIndex]!
      if (!rule.keywords.some(keyword => haystack.includes(keyword))) continue
      const index = (this.counters.get(ruleIndex) ?? 0) % rule.pool.length
      this.counters.set(ruleIndex, index + 1)
      return this.speak(rule.pool[index]!, nowMs)
    }
    this.charsSinceWhisper += text.length
    if (this.charsSinceWhisper < this.charBudget) return undefined
    const generic = this.generic()
    if (generic.length === 0) return undefined
    const line = generic[this.genericCursor % generic.length]!
    this.genericCursor += 1
    return this.speak(line, nowMs)
  }

  private speak(line: string, nowMs: number): string {
    this.lastWhisperAt = nowMs
    this.charsSinceWhisper = 0
    return line
  }
}
