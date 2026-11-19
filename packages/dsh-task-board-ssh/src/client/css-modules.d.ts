/** CSS Modules are compiled into the bundle by the shared tsdown preset. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
