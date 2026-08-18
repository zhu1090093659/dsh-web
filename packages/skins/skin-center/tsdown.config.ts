import { clientBundle } from '../../../shared/tsdown.client.ts'

export default clientBundle(
  '@linxin666/dsh-client-ui-skin-center',
  ['src/index.ts'],
  {
    lib: {
      // 宿主侧会在运行时从 dsh 配置树解析 dsh-settings / schemastery，而非本地安装；
      // 保持外部。
      external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-settings', 'schemastery'],
    },
  },
)
