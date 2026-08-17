import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-file-drop', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: ['@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-settings'],
})
