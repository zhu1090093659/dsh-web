import { clientBundle } from '../../shared/tsdown.client.ts'
import { live2dVendorBundle } from './tsdown.live2d-vendor.ts'

export default clientBundle('@linxin666/dsh-pet', [
  'src/index.ts',
  'src/invariant.ts',
], {
  companions: [live2dVendorBundle()],
  libExternal: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-settings',
  ],
})
