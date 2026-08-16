import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle(
  '@linxin666/dsh-client-ui-shutdown',
  ['src/index.ts', 'src/invariant.ts'],
  {
    lib: {
      // 宿主侧会在运行时从 dsh 配置树解析这些 SDK 包，而不是本地安装；
      // 其内置声明带有 rolldown 无法跟随的 .ts 后缀相对引用，因此保持外部。
      external: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-cmdline',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-ui-settings',
        '@deepseek-ai/dsh-client-ui-sidebar',
        '@deepseek-ai/dsh-client-ui-slots',
        '@deepseek-ai/dsh-host-webserver',
        '@deepseek-ai/dsh-invariants',
        '@deepseek-ai/dsh-settings',
        '@deepseek-ai/dsh-system-prompt',
      ],
    },
  },
)
