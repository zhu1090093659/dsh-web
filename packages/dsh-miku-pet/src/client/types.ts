// 与 config.jsonc 结构完全同构的类型模型（唯一事实来源 = config.jsonc 的
// animations / animationWeights / pets）。运行时（ANIM / 设置页 / PetCard）
// 直接使用这套结构，不额外造转换后的类型。

/** 支持的角落 */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** 移动动作：一个动作名 + 可选覆盖参数（未写字段取 moves.default） */
export interface MoveSpec {
  name: string;
  params?: Record<string, number>;
}

/** 移动池 */
export interface MovesConfig {
  default: Record<string, number>;
  actions: MoveSpec[];
}

/** 随机动作分类（带文字、镜像会颠倒，facing=right 时跳过） */
export interface Category {
  id: string;
  weight: number;
  noMirror?: boolean;
  actions: string[];
}

/** 动画权重 */
export interface Weights {
  idle: number;
  turn: number;
  move: number;
}

/** config.jsonc 的 animations 段 */
export interface Animations {
  idle: string[];
  turn: string[];
  drag: string[];
  /** 拖拽结束的"摔倒→站起"动作池（播一次即回 idle；缺省无此池时维持旧行为） */
  standup?: string[];
  clicks: string[];
  moves: MovesConfig;
  categories: Category[];
}

/** 一只宠物（与 jsonc pets[i] 同形，position 嵌套） */
export interface Pet {
  id: string;
  /** 显示名（悬停菜单可改；缺省不显示名字标签） */
  name?: string;
  size: number;
  position: { corner: Corner; marginX: number; marginY: number };
}

/** config.jsonc 全集——运行时直接使用（ANIM 即本类型） */
export interface ClientConfig {
  pets: Pet[];
  animations: Animations;
  animationWeights: Weights;
  /** 动作名 → 气泡台词池（点击/随机动作播放时按动作弹出对应台词） */
  phrases?: Record<string, string[]>;
}
