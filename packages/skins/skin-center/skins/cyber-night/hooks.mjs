/**
 * Cyber Night (cyber-night) skin hooks — the trusted escape hatch of the v2
 * skin contract (x-org.linxin666.skin-center/v1alpha1), reviewed and released
 * with this repository. Loading this module executes nothing; apply() owns
 * every DOM write and registers its retraction through ctx.onCleanup.
 *
 * The v1 backdrop (art + theme scrim) is declarative in v2: it rides
 * contributes.backgroundMedia in skin.json, owned by the skin-center. The
 * only client hook needed here is the neon favicon (cyan ring on deep ink,
 * magenta dot) served from assets/.
 */
export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const favicon = document.createElement('link')
      favicon.rel = 'icon'
      favicon.href = ctx.assetBase + '/assets/cyber-night-icon.svg'
      document.head.append(favicon)
      ctx.onCleanup(() => favicon.remove())
    },
  }
}
