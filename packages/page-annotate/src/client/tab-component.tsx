/**
 * Tab component adapter: turns the better-sidebar tab props into the
 * AnnotatePanel props (structural narrowing at the boundary).
 * @module @linxin666/dsh-page-annotate/client/tab-component
 */

import type { ReactElement } from 'react'
import type { TabComponentPropsLike } from './better-sidebar.ts'
import { AnnotatePanel } from './panel/AnnotatePanel.tsx'

/** The tab component registered into better-sidebar. */
export function createTabComponent(props: TabComponentPropsLike): ReactElement {
  const { ctx, scope, tab, visible } = props
  return (
    <AnnotatePanel
      ctx={ctx}
      scope={{ sessionId: scope.sessionId, cwd: scope.cwd }}
      tab={{ path: tab.path, id: tab.id, type: tab.type }}
      visible={visible}
    />
  )
}
