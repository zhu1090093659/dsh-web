// 移动几何：纯计算（无 DOM / ref），可独立单测。
// 所有坐标归一化为视口比例（ratio），px 换算由调用方（rAF 驱动 / customPos）完成。
import { randomBetween } from './pickers';

/** 一次移动的几何参数（比例坐标） */
export interface MovePlan {
  startRatio: number;
  startYRatio: number;
  targetRatio: number;
  totalRatio: number;
}

/** 计算一次移动的起点/终点比例坐标；目标越出视口边缘（含边距）时返回 null */
export const planMove = (o: {
  cx: number;
  cy: number;
  W: number;
  H: number;
  dir: 1 | -1;
  minDist: number;
  maxDist: number;
  margin: number;
  halfW: number;
}): MovePlan | null => {
  const distance = randomBetween(o.minDist, o.maxDist);
  const target = o.cx + o.dir * distance;
  const leftBound = o.margin + o.halfW;
  const rightBound = o.W - o.margin - o.halfW;
  if (target < leftBound || target > rightBound) return null;
  return {
    startRatio: o.cx / o.W,
    startYRatio: o.cy / o.H,
    targetRatio: target / o.W,
    totalRatio: Math.abs(target - o.cx) / o.W,
  };
};
