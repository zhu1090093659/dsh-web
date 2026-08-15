/** CSS Modules type shim (lightningcss inlines them at build time). */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
