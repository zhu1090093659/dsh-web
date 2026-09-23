/** CSS Modules imports resolve to the hashed class-name map the bundle inlines. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
