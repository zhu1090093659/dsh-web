/**
 * Aggregator for the ru dictionaries: one module per source package under
 * src/client/ru/. Files are named after the source package (stable even if a
 * package renames its locale namespace); the mapping below owns the namespace
 * ids the locale registry sees. scripts/i18n-audit.mjs loads this module to
 * verify per-namespace coverage against every package's zh keys.
 * @module @linxin666/dsh-i18n/client/ru
 */
import { ru as doctor } from './doctor.ts'
import { ru as gitGraph } from './git-graph.ts'
import { ru as liangshen } from './liangshen.ts'
import { ru as market } from './market.ts'
import { ru as modelCapabilities } from './model-capabilities.ts'
import { ru as pet } from './pet.ts'
import { ru as pluginManager } from './plugin-manager.ts'
import { ru as presetCenter } from './preset-center.ts'
import { ru as remoteWebUi } from './remote-web-ui.ts'
import { ru as sessionId } from './session-id.ts'
import { ru as sessionArchive } from './session-archive.ts'
import { ru as skillExplorer } from './skill-explorer.ts'
import { ru as ssh } from './ssh.ts'
import { ru as taskBoard } from './task-board.ts'
import { ru as describeImage } from './tool-describe-image.ts'
import { ru as usage } from './usage.ts'
import { ru as webSettings } from './web-settings.ts'

/** ru dictionaries keyed by the locale namespace each source package registers. */
export const ruDictionaries: Record<string, Record<string, string>> = {
  'doctor': doctor,
  'git-graph': gitGraph,
  'liangshen': liangshen,
  'dsh-web-ui-market': market,
  'model-caps': modelCapabilities,
  'pet': pet,
  'settings.pluginManager': pluginManager,
  'dsh-web-ui-preset-center': presetCenter,
  'remote': remoteWebUi,
  'session-id': sessionId,
  'dsh-web-ui-session-archive': sessionArchive,
  'dsh-skill-explorer': skillExplorer,
  'dsh-ssh': ssh,
  'task-board': taskBoard,
  'describe-image': describeImage,
  'dsh-web-ui-usage': usage,
  'web-ui-plugins': webSettings,
}
