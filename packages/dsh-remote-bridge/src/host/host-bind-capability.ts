/**
 * What the installed webserver accepts as a bind address, plus the address
 * classes the LAN-bind decision needs (issue #1893).
 *
 * The managed LAN-bind block used to pin `host: '0.0.0.0'`. Since
 * `@deepseek-ai/dsh-host-webserver@0.2.1-rc.2` the webserver `Config` schema
 * rejects the unspecified (wildcard) address, so such a block is refused at
 * config validation and every later `dsh web` start fails. This module is the
 * one place that asks the installed package instead of assuming, and the block
 * planner reads its answer.
 *
 * The value import below is a devDependency of this package and must stay
 * external in the published bundle: the host process resolves it from the
 * profile tree, which is exactly the module it is about to compose. A host this
 * module cannot interrogate is never assumed permissive - every failure path
 * answers "no wildcard", because an unreadable package must not make the block
 * pin a literal that refuses to boot.
 *
 * @module dsh-remote-bridge/host/host-bind-capability
 */

import * as webserver from '@deepseek-ai/dsh-host-webserver'

/** A schemastery-style schema: call the factory, throw on refusal. */
export type ConfigSchemaFactory = (value: unknown) => unknown

/** The bind value this probe validates: the wildcard literal and a fixed port. */
const PROBE_BIND = { host: '0.0.0.0', port: 3080 } as const

/**
 * Whether a value can hold a `Config` factory. The package exports the
 * WebServer class itself, a namespace object holding it, and a default export;
 * a class is a function, so both kinds count.
 */
function isHolder(value: unknown): boolean {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

/**
 * The schema factory of whatever module shape was loaded. The package exposes
 * `WebServer` both as a named export and as the default, and the default may
 * itself be a namespace, so the lookup walks those two links. Anything without
 * a callable `Config` is treated as an unusable shape.
 * @param moduleNamespace - the loaded module object (or any nested holder).
 * @returns the schema factory, or undefined when the shape is unusable.
 */
export function configSchemaOf(moduleNamespace: unknown): ConfigSchemaFactory | undefined {
  const seen = new Set<unknown>()
  const queue: unknown[] = [moduleNamespace]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!isHolder(current) || seen.has(current)) continue
    seen.add(current)
    let config: unknown
    try {
      config = (current as { Config?: unknown }).Config
    } catch {
      continue
    }
    if (typeof config === 'function') return config as ConfigSchemaFactory
    try {
      const holder = current as { default?: unknown; WebServer?: unknown }
      queue.push(holder.default, holder.WebServer)
    } catch {
      // A throwing accessor is not a shape this probe can read.
    }
  }
  return undefined
}

/**
 * Validate the wildcard bind against one schema factory.
 * @param configOf - the schema factory to interrogate (undefined = unusable shape).
 * @returns true only when the schema accepts the wildcard bind.
 */
export function probeWildcardBindSupport(configOf: ConfigSchemaFactory | undefined): boolean {
  if (typeof configOf !== 'function') return false
  try {
    configOf({ host: PROBE_BIND.host, port: PROBE_BIND.port })
    return true
  } catch {
    return false
  }
}

/**
 * Memoized answers, keyed by the schema factory itself: the installed module
 * hands over the same function every call, so the schema is interrogated once
 * per process, and an injected factory answers per factory.
 */
const probeAnswers = new WeakMap<ConfigSchemaFactory, boolean>()

/**
 * Whether the host this plugin runs on accepts the wildcard bind. Grounded in
 * the installed package's own schema, so it cannot drift away from the host
 * whatever the version is called; false when the package cannot be read.
 * @param configOf - schema factory override (test seam); by default the
 * installed package's own `WebServer.Config`.
 * @returns true only when the wildcard bind validates.
 */
export function wildcardBindSupported(configOf?: ConfigSchemaFactory): boolean {
  const factory = configOf ?? configSchemaOf(webserver)
  // A non-callable shape cannot key the WeakMap below; it answers "no
  // wildcard" like every other unreadable path in this module.
  if (typeof factory !== 'function') return false
  const cached = probeAnswers.get(factory)
  if (cached !== undefined) return cached
  const supported = probeWildcardBindSupport(factory)
  probeAnswers.set(factory, supported)
  return supported
}

/**
 * Validate one bind literal against one schema factory, the way the host
 * validates a profile's webserver row.
 * @param configOf - the schema factory to interrogate (undefined = unusable shape).
 * @param host - the bind literal to validate.
 * @returns true only when the schema accepts that literal on a fixed port.
 */
export function probeBindAccepted(configOf: ConfigSchemaFactory | undefined, host: string): boolean {
  if (typeof configOf !== 'function' || typeof host !== 'string' || host === '') return false
  try {
    configOf({ host, port: PROBE_BIND.port })
    return true
  } catch {
    return false
  }
}

/**
 * Answers already measured per schema factory, keyed by the bind literal: the
 * installed module hands over the same function every call, so each literal is
 * interrogated once per process, and an injected factory answers per factory.
 * The inner map is bounded by the literals a boot can ask about - the CLI flag
 * and the sampled interface addresses.
 */
const acceptedHostAnswers = new WeakMap<ConfigSchemaFactory, Map<string, boolean>>()

/**
 * Whether the running host accepts one bind literal. This is the rule the
 * managed block must follow instead of "is it a wildcard": the block REPLACES
 * the webserver row's config wholesale, so nothing else validates the CLI
 * `--host` that reaches it, and a literal the schema refuses bricks the next
 * start with a block that cannot be fixed from the settings card (issue #1893).
 * @param host - the bind literal to validate (an absent or empty value is never accepted).
 * @param configOf - schema factory override (test seam); by default the
 * installed package's own `WebServer.Config`.
 * @returns true only when the schema accepts the literal; false on every
 * unreadable shape, and never throws.
 */
export function bindAccepted(host: string | undefined, configOf?: ConfigSchemaFactory): boolean {
  if (typeof host !== 'string' || host === '') return false
  const factory = configOf ?? configSchemaOf(webserver)
  // The shape check sits ahead of the cache: a non-callable value is not a key
  // a WeakMap accepts, and a probe that throws on an unreadable shape would
  // take the boot path down instead of answering "not accepted".
  if (typeof factory !== 'function') return false
  let answers = acceptedHostAnswers.get(factory)
  if (answers === undefined) {
    answers = new Map<string, boolean>()
    acceptedHostAnswers.set(factory, answers)
  }
  const cached = answers.get(host)
  if (cached !== undefined) return cached
  const accepted = probeBindAccepted(factory, host)
  answers.set(host, accepted)
  return accepted
}

/**
 * The host package's own predicate, when it exports a callable one.
 * @param name - the exported predicate's name.
 * @param host - the bind value to classify.
 * @returns its verdict, or undefined when the package cannot answer.
 */
function hostPredicate(name: 'isWildcardHost' | 'isLoopbackHost', host: string): boolean | undefined {
  try {
    const fn = (webserver as unknown as Record<string, unknown>)[name]
    if (typeof fn !== 'function') return undefined
    return (fn as (value: string) => boolean)(host) === true
  } catch {
    return undefined
  }
}

/** Local fallback for the wildcard classes: IPv4 any, IPv6 any, mapped IPv4 any. */
function localWildcard(token: string): boolean {
  return token === '0.0.0.0'
    || token === '::'
    || token === '0:0:0:0:0:0:0:0'
    || token === '::ffff:0.0.0.0'
}

/** Local fallback for the loopback classes: 127/8, ::1, mapped and expanded forms. */
function localLoopback(token: string): boolean {
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(token)) return true
  if (token === '::1' || token === '0:0:0:0:0:0:0:1') return true
  return /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(token)
}

/** Local fallback for an IPv4 literal (the only address class a URL base can be built from bare). */
function isIPv4Literal(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 4) return false
  return parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Whether a bind value asks for every interface at once.
 * @param host - the bind value (absent while a recompose pass has not settled).
 * @returns true for the wildcard classes.
 */
export function isWildcardLiteral(host: string | undefined): boolean {
  if (typeof host !== 'string' || host === '') return false
  return hostPredicate('isWildcardHost', host) ?? localWildcard(host.trim().toLowerCase())
}

/**
 * Whether a bind value names this machine only, so no other device can dial
 * it: the loopback literals of the host package (127/8, ::1 and their mapped
 * forms), the `localhost` token the schema refuses as a literal, and an absent
 * bind. A hostname is treated by the host package's own verdict, not guessed.
 * @param host - the bind value (absent while a recompose pass has not settled).
 * @returns true when nothing off this machine can reach the listener.
 */
export function isLoopbackBind(host: string | undefined): boolean {
  if (typeof host !== 'string') return true
  const token = host.trim().toLowerCase()
  if (token === '' || token === 'localhost') return true
  return hostPredicate('isLoopbackHost', host) ?? localLoopback(token)
}

/**
 * The URL authority a concrete bind literal is expressed by. The host package
 * owns the canonical form (mapped loopback collapses to dotted quad, IPv6 gets
 * bracketed, a non-loopback zone id has no URL form).
 * @param host - a concrete bind literal.
 * @returns the URL host, or undefined when the literal has no URL form.
 */
export function bindUrlHostOf(host: string): string | undefined {
  try {
    const fn = (webserver as unknown as { bindUrlHost?: unknown }).bindUrlHost
    if (typeof fn === 'function') return (fn as (value: string) => string | undefined)(host)
  } catch {
    // Fall through to the local rule below.
  }
  const token = host.trim().toLowerCase()
  return isIPv4Literal(token) ? host : undefined
}
