// 画布 / 几何常量:方形帧(人物居中,脚底约 90% 高度)。
/** thumb 画布高度(比例基准) */
export const CANVAS_H = 360;
/** thumb 画布上「脚底」的 y 坐标(方形帧人物脚底约 90%) */
export const FEET_Y = 324;
/** 点击/拖拽命中矩形(方形基准 640×640 像素坐标;渲染按比例换算) */
export const HIT_BOX = { x0: 210, y0: 40, x1: 430, y1: 575 };
/** 拖拽判定阈值（px） */
export const DRAG_THRESHOLD = 5;
