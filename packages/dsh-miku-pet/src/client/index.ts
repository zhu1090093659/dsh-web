// client 半侧 bundle 外壳：由 tsdown 构建为 lib/client.js。
// 必须是一个「普通副作用脚本」——加载时调用 window.__ModuleLoader__.load，
// 不能包含顶层 ESM export / import（react 由 factory 的 require 取得）。
import { makeFactory } from './app';

declare const window: {
  __ModuleLoader__: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH 全局注入的模块系统契约（f(require) => module）
    load(info: { id: string; factory: (require: (m: string) => any) => any }): void;
  };
};

window.__ModuleLoader__.load({
  id: 'miku-pet',
  factory: makeFactory(),
});

// 构建版本标记:模块每次加载(页面加载 / HMR 重载)都会打印,用于确认浏览器跑的是哪版
console.log('[miku-pet] client build b10-2026-08-23 (all buttons neutral, no blue)');
