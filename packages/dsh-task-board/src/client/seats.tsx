/**
 * The board's child seats, threaded from the slot registration that declares
 * them down to the components that consume them.
 *
 * The framework hands the declaring component a `renderSlot` binding; the board
 * wraps that binding in a React context so a provider's contribution can render
 * deep inside TaskDetail, the card, the settings card, or the create dialog
 * without those components knowing which providers exist.
 *
 * @module dsh-task-board/client/seats
 */
import { Component, createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import {
  TASK_BOARD_CARD_DECORATION,
  TASK_BOARD_COMPOSE_SECTION,
  TASK_BOARD_DETAIL_SECTION,
  TASK_BOARD_SETTINGS_SECTION,
  type TaskBoardCardDecorationProps,
  type TaskBoardComposeSectionProps,
  type TaskBoardDetailSectionProps,
  type TaskBoardSettingsSectionProps,
} from '../core/extension.ts'

/** The four provider seats, adapted to plain render functions. */
export interface TaskBoardSeats {
  detailSection: (props: TaskBoardDetailSectionProps) => ReactNode
  settingsSection: (props: TaskBoardSettingsSectionProps) => ReactNode
  cardDecoration: (props: TaskBoardCardDecorationProps) => ReactNode
  composeSection: (props: TaskBoardComposeSectionProps) => ReactNode
}

/** Nothing registered: every seat renders empty. */
export const EMPTY_TASK_BOARD_SEATS: TaskBoardSeats = {
  detailSection: () => null,
  settingsSection: () => null,
  cardDecoration: () => null,
  composeSection: () => null,
}

/** The framework `renderSlot` binding shape (key + owner props share). */
export type SlotRenderBinding = (key: string, owner: Record<string, unknown>) => ReactNode

/** Adapt one framework renderSlot binding to the board's seat interface. */
export function seatsFromRenderSlot(renderSlot: SlotRenderBinding | undefined): TaskBoardSeats {
  if (renderSlot === undefined) return EMPTY_TASK_BOARD_SEATS
  return {
    detailSection: props => renderSlot(TASK_BOARD_DETAIL_SECTION, props as unknown as Record<string, unknown>),
    settingsSection: props => renderSlot(TASK_BOARD_SETTINGS_SECTION, props as unknown as Record<string, unknown>),
    cardDecoration: props => renderSlot(TASK_BOARD_CARD_DECORATION, props as unknown as Record<string, unknown>),
    composeSection: props => renderSlot(TASK_BOARD_COMPOSE_SECTION, props as unknown as Record<string, unknown>),
  }
}

/**
 * Isolation for one seat whose providers render outside the framework's own
 * per-entry boundary: a provider that throws while rendering contributes
 * nothing here instead of taking the surface around the seat down with it.
 * Nothing is rendered in that case — the seat is optional, so its absence is
 * the honest state — and the failure is logged once for the provider's author.
 */
export class TaskBoardSeatBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('[dsh-task-board] a provider seat failed to render', error)
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

const TaskBoardSeatsContext = createContext<TaskBoardSeats>(EMPTY_TASK_BOARD_SEATS)

/** Provider the board's registered components wrap their subtree in. */
export const TaskBoardSeatsProvider = TaskBoardSeatsContext.Provider

/** Read the current seat set (empty when no board registration is above). */
export function useTaskBoardSeats(): TaskBoardSeats {
  return useContext(TaskBoardSeatsContext)
}
