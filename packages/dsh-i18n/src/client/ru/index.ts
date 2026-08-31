/**
 * Aggregator for the ru dictionaries: one module per source package under
 * src/client/ru/. Files are named after the source package (stable even if a
 * package renames its locale namespace); the mapping below owns the namespace
 * ids the locale registry sees. scripts/i18n-audit.mjs loads this module to
 * verify per-namespace coverage against every package's zh keys.
 * @module @linxin666/dsh-i18n/client/ru
 */
import { ru as desktopLauncher } from './desktop-launcher.ts'
import { ru as doctor } from './doctor.ts'
import { ru as gitGraph } from './git-graph.ts'
import { ru as market } from './market.ts'
import { ru as perf } from './perf.ts'
import { ru as pet } from './pet.ts'
import { ru as pluginManager } from './plugin-manager.ts'
import { ru as remoteWebUi } from './remote-web-ui.ts'
import { ru as sessionId } from './session-id.ts'
import { ru as skillExplorer } from './skill-explorer.ts'
import { ru as ssh } from './ssh.ts'
import { ru as taskBoard } from './task-board.ts'
import { ru as describeImage } from './tool-describe-image.ts'
import { ru as usage } from './usage.ts'
import { ru as webSettings } from './web-settings.ts'

/** ru dictionaries keyed by the locale namespace each source package registers. */
export const ruDictionaries: Record<string, Record<string, string>> = {
  'desktop-launcher': desktopLauncher,
  'doctor': doctor,
  'git-graph': gitGraph,
  'dsh-web-ui-market': market,
  'dsh-perf': perf,
  'pet': pet,
  'settings.pluginManager': pluginManager,
  'remote': remoteWebUi,
  'session-id': sessionId,
  'dsh-skill-explorer': skillExplorer,
  'dsh-ssh': ssh,
  'task-board': taskBoard,
  'describe-image': describeImage,
  'dsh-web-ui-usage': usage,
  'web-ui-plugins': webSettings,
}
