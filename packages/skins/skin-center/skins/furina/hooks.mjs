export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const favicon = document.createElement('link')
      favicon.rel = 'icon'
      favicon.type = 'image/png'
      favicon.href = ctx.assetBase + '/assets/furina-icon.png'
      document.head.append(favicon)
      ctx.onCleanup(() => favicon.remove())
    },
  }
}
