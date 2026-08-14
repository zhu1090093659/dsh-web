/**
 * Mock pet provider used by the mechanism test: registers a Cordis `pet`
 * service exactly like dsh-pet / whale-girl do. Each instance carries the
 * `config.tag` it was created with, so tests can tell which implementation a
 * context resolves to.
 */
export default function apply(ctx, config = {}) {
  const tag = config.tag ?? 'untagged'
  ctx.effect(() => {
    ctx.provide('pet', { tag })
    return () => {}
  })
}
