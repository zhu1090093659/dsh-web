export type Dict<T = any, K extends string | symbol = string> = { [key in K]: T }
export type Get<T extends {}, K> = K extends keyof T ? T[K] : never
export type Extract<S, T, U = S> = S extends T ? U : never
export type MaybeArray<T> = [T] extends [unknown[]] ? T : T | T[]
export type Promisify<T> = Promise<T extends Promise<infer S> ? S : T>
export type Awaitable<T> = [T] extends [Promise<unknown>] ? T : T | Promise<T>
export type Intersect<U> = (U extends any ? (arg: U) => void : never) extends ((arg: infer I) => void) ? I : never

export function noop(): any {}

export function isNullable(value: any): value is null | undefined | void {
  return value === null || value === undefined
}

export function isNonNullable<T>(value: T): value is NonNullable<T> {
  return !isNullable(value)
}

export function isPlainObject(data: any) {
  return data && typeof data === 'object' && !Array.isArray(data)
}

export function filterKeys<T, K extends string, U extends K>(object: Dict<T, K>, filter: (key: K, value: T) => key is U): Dict<T, U>
export function filterKeys<T, K extends string>(object: Dict<T, K>, filter: (key: K, value: T) => boolean): Dict<T, K>
export function filterKeys(object: {}, filter: (key: string, value: any) => boolean) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)))
}

export function mapValues<U, T, K extends string>(object: Dict<T, K>, transform: (value: T, key: K) => U) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, (transform as any)(value, key)])) as Dict<U, K>
}

export { mapValues as valueMap }

export function pick<T extends object, K extends keyof T>(source: T, keys?: Iterable<K>, forced?: boolean) {
  if (!keys) return { ...source }
  const result = {} as Pick<T, K>
  for (const key of keys) {
    if (forced || source[key] !== undefined) result[key] = source[key]
  }
  return result
}

export function omit<T, K extends keyof T>(source: T, keys?: Iterable<K>) {
  if (!keys) return { ...source }
  const result = { ...source } as Omit<T, K>
  for (const key of keys) {
    Reflect.deleteProperty(result, key)
  }
  return result
}

export function defineProperty<T, K extends keyof T>(object: T, key: K, value: T[K]): T
export function defineProperty<T, K extends keyof any>(object: T, key: K, value: any): T
export function defineProperty<T, K extends keyof any>(object: T, key: K, value: any) {
  return Object.defineProperty(object, key, { writable: true, value, enumerable: false })
}
