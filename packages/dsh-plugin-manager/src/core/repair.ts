/**
 * Repair-conversation seed text. Two failure surfaces hand off to the agent
 * through the same shape: a failed install (target spec + install error) and
 * a recorded boot failure (the failure-ring row). The seeded message must be
 * self-contained — the repair session's workspace is the plugin install root,
 * so the agent's file tools reach the plugin code without leaving the
 * workspace boundary.
 *
 * Secret discipline: the seed carries only the spec, the host's truncated
 * failure message/stack, and paths. Callers must never append credentials,
 * tokens, or environment contents; the failure ring is the host's bounded,
 * pruned record and nothing else is added.
 * @module @linxin666/dsh-client-ui-plugin-manager/core
 */

import type { PluginFailureItem } from './protocol.ts'
import type { LayerState } from './patch-diff.ts'

/** Localized fragments the builders assemble. */
export interface RepairCopy {
  installTitle: string
  installSpecLabel: string
  installErrorLabel: string
  installAsk: string
  failureTitle: string
  failurePluginLabel: string
  failureKindLabel: string
  failureAtLabel: string
  failureMessageLabel: string
  failureStackLabel: string
  failurePathLabel: string
  failureAsk: string
  conflictTitle: string
  conflictPluginLabel: string
  conflictChangeLabel: string
  conflictAsk: string
  /** Localized names of the failure kinds. */
  kindNames: Record<PluginFailureItem['kind'], string>
  /** Localized names of the layer states a conflict change traverses. */
  stateNames: Record<LayerState, string>
}

/** Default copy (zh): the package's zh dictionary keys map onto these strings. */
export const DEFAULT_REPAIR_COPY: RepairCopy = {
  installTitle: '正在修复插件安装失败',
  installSpecLabel: '安装目标',
  installErrorLabel: '安装错误',
  installAsk: '请在插件安装根目录内检查插件包或依赖并修复，然后重试安装。',
  failureTitle: '正在修复插件启动失败',
  failurePluginLabel: '插件',
  failureKindLabel: '失败类型',
  failureAtLabel: '时间',
  failureMessageLabel: '错误信息',
  failureStackLabel: '堆栈',
  failurePathLabel: '安装路径',
  failureAsk: '请修复插件后重新启用并重启 dsh web。',
  conflictTitle: '正在处理插件安装冲突',
  conflictPluginLabel: '冲突条目',
  conflictChangeLabel: '状态变化',
  conflictAsk: '请检查冲突双方的入口行 id 与挂载方式，消除重复挂载后告诉我如何重新启用。',
  kindNames: {
    'load-failure': '加载失败',
    hang: '启动挂起',
    'late-rejection': '迟到拒绝',
  },
  stateNames: {
    enabled: '已开启',
    disabled: '已关闭',
    uninstalled: '已卸载',
  },
}

/**
 * Seed text for a failed install: the target and the rendered error,
 * self-contained for the agent.
 * @param spec - the install target (npm spec or git URL) that failed.
 * @param error - the rendered install error text.
 * @param copy - localized fragments.
 * @returns the repair prompt text.
 */
export function installRepairMessage(spec: string, error: string, copy: RepairCopy = DEFAULT_REPAIR_COPY): string {
  return [
    copy.installTitle,
    `${copy.installSpecLabel}: ${spec}`,
    `${copy.installErrorLabel}:\n${error}`,
    copy.installAsk,
  ].join('\n\n')
}

/**
 * Seed text for one boot-failure ring row: the failure record, so the agent
 * can attribute and fix it in place.
 * @param failure - the recorded failure row.
 * @param copy - localized fragments.
 * @returns the repair prompt text.
 */
export function failureRepairMessage(failure: PluginFailureItem, copy: RepairCopy = DEFAULT_REPAIR_COPY): string {
  const parts = [
    copy.failureTitle,
    `${copy.failurePluginLabel}: ${failure.pluginId || '-'}`,
    `${copy.failureKindLabel}: ${copy.kindNames[failure.kind] ?? failure.kind}`,
    `${copy.failureAtLabel}: ${failure.at}`,
    `${copy.failureMessageLabel}:\n${failure.message}`,
  ]
  if (failure.stack !== '') parts.push(`${copy.failureStackLabel}:\n${failure.stack}`)
  if (failure.installPath !== '') parts.push(`${copy.failurePathLabel}: ${failure.installPath}`)
  parts.push(copy.failureAsk)
  return parts.join('\n\n')
}

/**
 * Seed text for one install-conflict notice: the entry and its state change,
 * so the agent can attribute the conflict and resolve the double mount.
 * @param change - the conflict change (id, display name, from/to states).
 * @param copy - localized fragments.
 * @returns the repair prompt text.
 */
export function conflictRepairMessage(
  change: { id: string; name: string; from: LayerState; to: LayerState },
  copy: RepairCopy = DEFAULT_REPAIR_COPY,
): string {
  return [
    copy.conflictTitle,
    `${copy.conflictPluginLabel}: ${change.name} (${change.id})`,
    `${copy.conflictChangeLabel}: ${copy.stateNames[change.from] ?? change.from} -> ${copy.stateNames[change.to] ?? change.to}`,
    copy.conflictAsk,
  ].join('\n\n')
}
