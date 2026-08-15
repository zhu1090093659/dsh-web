import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle(
  '@linxin666/dsh-client-ui-pet-center',
  ['src/index.ts'],
  {
    lib: {
      // The host half resolves @deepseek-ai/dsh-settings + schemastery from
      // the dsh config tree at runtime, never from a local install; keep them
      // external (the same stance as dsh-live-stats / skin-center).
      external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-settings', 'schemastery'],
    },
  },
)
