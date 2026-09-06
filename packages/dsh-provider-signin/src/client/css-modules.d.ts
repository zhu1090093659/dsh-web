/**
 * Ambient type for CSS Module imports: the shared tsdown preset compiles
 * `*.module.css` into hashed class-map objects at bundle time.
 * @module @linxin666/dsh-provider-signin/client/css-modules
 */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
