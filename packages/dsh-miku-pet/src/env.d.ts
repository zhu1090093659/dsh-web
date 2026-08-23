// DSH peer 依赖类型补充：这些包由 DSH 宿主在运行时提供，本地开发无 node_modules，
// 这里为它们声明最小类型，便于 tsc 通过（运行时以 DSH 提供的为准）。
declare module '@deepseek-ai/dsh-home-paths' {
  /** 解析 DSH 主目录（$DSH_HOME，默认 ~/.dsh） */
  export function resolveDshHome(): string;
}
