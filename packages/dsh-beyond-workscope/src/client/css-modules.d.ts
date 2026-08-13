/** CSS Modules ambient declaration for the tsdown virtual loader. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
