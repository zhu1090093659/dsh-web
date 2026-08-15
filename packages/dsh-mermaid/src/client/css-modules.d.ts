/** CSS Modules type shim: hashed class maps from the bundled styles. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
