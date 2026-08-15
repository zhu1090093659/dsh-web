import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-pet-maid', [
  'src/index.ts',
  'src/invariant.ts',
], {
  libExternal: ['@deepseek-ai/dsh-settings'],
})
