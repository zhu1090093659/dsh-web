/**
 * The bind capability probe (issue #1893). The managed LAN-bind block used to
 * pin `host: '0.0.0.0'`; since @deepseek-ai/dsh-host-webserver 0.2.1-rc.2 the
 * webserver Config schema rejects that literal, so the block is refused at
 * config validation and every later `dsh web` start fails. The probe asks the
 * installed schema instead of inferring from a version or a source string, and
 * every path it cannot read answers "no wildcard": a host this plugin cannot
 * interrogate must never make the block pin a literal that refuses to boot.
 */
import { describe, expect, it } from 'vitest'
import { bindAccepted, bindUrlHostOf, configSchemaOf, isLoopbackBind, isWildcardLiteral, probeWildcardBindSupport, wildcardBindSupported } from '../src/host/host-bind-capability.ts'

/** A schema factory that accepts anything, counting its calls. */
function acceptingSchema(): { factory: (value: unknown) => unknown; calls: number[] } {
  const calls: number[] = []
  return {
    calls,
    factory: (value: unknown) => {
      calls.push(1)
      return value
    },
  }
}

/** A schema factory that refuses a value, the way the webserver Config does. */
function refusingSchema(): { factory: (value: unknown) => unknown; calls: number[] } {
  const calls: number[] = []
  return {
    calls,
    factory: (value: unknown) => {
      calls.push(1)
      throw new Error('webserver: host "0.0.0.0" is an unspecified (wildcard) address, which is not supported')
    },
  }
}

describe('probeWildcardBindSupport', () => {
  it('operator: a schema that accepts the wildcard bind reports support', () => {
    // Given a schema factory that validates the probe value
    // When the wildcard bind is validated
    // Then the answer is true
    expect(probeWildcardBindSupport(acceptingSchema().factory)).toBe(true)
  })

  it('operator: a schema that refuses the wildcard bind reports no support', () => {
    // Given a schema factory that throws on the wildcard (0.2.1-rc.2)
    // When the wildcard bind is validated
    // Then the answer is false, and nothing escapes the probe
    expect(probeWildcardBindSupport(refusingSchema().factory)).toBe(false)
  })

  it('operator: an unusable schema shape reports no support', () => {
    // Given the shapes a failed module read leaves behind
    // When the probe runs without a callable schema
    // Then it answers false instead of throwing
    expect(probeWildcardBindSupport(undefined)).toBe(false)
    expect(probeWildcardBindSupport('not a function' as unknown as (value: unknown) => unknown)).toBe(false)
  })
})

describe('configSchemaOf', () => {
  it('operator: the schema is found on any module shape the package publishes', () => {
    // Given the shapes the package may hand over: a named class export, a
    // default export of the class, and a default export that is a namespace
    const Config = acceptingSchema().factory
    const WebServer = Object.assign(function WebServer() {}, { Config })
    // When the schema is looked up
    // Then every shape resolves to the same factory
    expect(configSchemaOf({ WebServer })).toBe(Config)
    expect(configSchemaOf({ default: WebServer })).toBe(Config)
    expect(configSchemaOf({ default: { WebServer } })).toBe(Config)
  })

  it('operator: a module without a callable schema is unusable', () => {
    // Given a module that carries no Config, a non-callable Config, and a
    // cyclic default chain
    // When the schema is looked up
    // Then no factory is returned, so the probe answers "no wildcard"
    expect(configSchemaOf({})).toBeUndefined()
    expect(configSchemaOf({ WebServer: { Config: 42 } })).toBeUndefined()
    expect(configSchemaOf(undefined)).toBeUndefined()
    const cyclic: Record<string, unknown> = {}
    cyclic.default = cyclic
    expect(configSchemaOf(cyclic)).toBeUndefined()
  })
})

describe('wildcardBindSupported', () => {
  it('operator: an injected schema is interrogated once per factory', () => {
    // Given a schema that accepts the wildcard
    // When the capability is asked twice
    // Then the schema validated the probe value only once, which is what makes
    // a per-process answer cheap enough to read on the boot path
    const schema = acceptingSchema()
    expect(wildcardBindSupported(schema.factory)).toBe(true)
    expect(wildcardBindSupported(schema.factory)).toBe(true)
    expect(schema.calls).toHaveLength(1)
  })

  it('operator: a refusing schema stays refused across calls', () => {
    // Given a schema that rejects the wildcard
    // When the capability is asked twice
    // Then both answers are false and the refusal was measured once
    const schema = refusingSchema()
    expect(wildcardBindSupported(schema.factory)).toBe(false)
    expect(wildcardBindSupported(schema.factory)).toBe(false)
    expect(schema.calls).toHaveLength(1)
  })

  it('operator: the installed webserver package decides by default', () => {
    // Given the package installed beside this one (0.2.1-rc.2 rejects the
    // wildcard) and no injection
    // When the capability is asked with no argument
    // Then it answers from that package's own schema rather than assuming
    const installed = wildcardBindSupported()
    expect(typeof installed).toBe('boolean')
    // The same answer on a second ask, memoized over the installed schema.
    expect(wildcardBindSupported()).toBe(installed)
  })
})

/**
 * A schema factory that classifies hosts the way the installed webserver does:
 * a concrete IPv4 literal that is not the wildcard is accepted, everything else
 * (a DNS name, a bare hostname, the wildcard, an empty value) is refused.
 */
function literalOnlySchema(): { factory: (value: unknown) => unknown; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    factory: (value: unknown) => {
      const host = (value as { host?: unknown }).host
      calls.push(typeof host === 'string' ? host : String(host))
      const parts = typeof host === 'string' ? host.split('.') : []
      const literal = parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
      if (!literal || host === '0.0.0.0') throw new Error('webserver: host is not a concrete IPv4 or IPv6 address literal')
      return value
    },
  }
}

describe('bindAccepted', () => {
  it('operator: a concrete literal the schema binds is accepted', () => {
    // Given a schema that takes concrete IP literals only
    // When a LAN address and the loopback literal are validated
    // Then both are accepted, which is what lets a CLI --host reach the block
    const schema = literalOnlySchema()
    expect(bindAccepted('192.168.1.6', schema.factory)).toBe(true)
    expect(bindAccepted('127.0.0.1', schema.factory)).toBe(true)
  })

  it('operator: a value the schema will not bind is refused', () => {
    // Given the values an operator may pass to --host that are not literals
    // When each is validated
    // Then none is accepted, so the planner drops the flag instead of writing
    // a block the next start refuses (issue #1893)
    const schema = literalOnlySchema()
    expect(bindAccepted('localhost', schema.factory)).toBe(false)
    expect(bindAccepted('example.com', schema.factory)).toBe(false)
    expect(bindAccepted('my-box', schema.factory)).toBe(false)
    expect(bindAccepted('0.0.0.0', schema.factory)).toBe(false)
  })

  it('operator: an absent or empty host is never accepted', () => {
    // Given no flag value at all
    // When the probe runs
    // Then it answers false without interrogating the schema
    const schema = literalOnlySchema()
    expect(bindAccepted(undefined, schema.factory)).toBe(false)
    expect(bindAccepted('', schema.factory)).toBe(false)
    expect(schema.calls).toHaveLength(0)
  })

  it('operator: an unusable schema shape answers false instead of throwing', () => {
    // Given the shapes a failed module read leaves behind (a non-callable
    // value, and a factory that throws on every input)
    // When a literal is validated against them
    // Then the answer is false and nothing escapes the probe
    const notAFunction = 'not a function' as unknown as (value: unknown) => unknown
    const throwing = (() => { throw new Error('unreadable') }) as unknown as (value: unknown) => unknown
    expect(bindAccepted('192.168.1.6', notAFunction)).toBe(false)
    expect(bindAccepted('192.168.1.6', 42 as unknown as (value: unknown) => unknown)).toBe(false)
    expect(() => bindAccepted('192.168.1.6', throwing)).not.toThrow()
    expect(bindAccepted('192.168.1.6', throwing)).toBe(false)
  })

  it('operator: each literal is interrogated once per schema factory', () => {
    // Given a schema the boot path asks about more than once
    // When the same literal is validated twice and a second literal once
    // Then only the distinct literals cost a schema call
    const schema = literalOnlySchema()
    expect(bindAccepted('192.168.1.6', schema.factory)).toBe(true)
    expect(bindAccepted('192.168.1.6', schema.factory)).toBe(true)
    expect(bindAccepted('localhost', schema.factory)).toBe(false)
    expect(schema.calls).toEqual(['192.168.1.6', 'localhost'])
  })

  it('operator: an injected schema answers independently of the installed one', () => {
    // Given a permissive schema beside the installed package's own
    // When the same hostname is validated through each
    // Then the answer follows the schema that was asked, so the test seam
    // never leaks into the boot path's answer
    const permissive = acceptingSchema()
    expect(bindAccepted('example.com', permissive.factory)).toBe(true)
    const installed = bindAccepted('127.0.0.1')
    expect(typeof installed).toBe('boolean')
    // A literal is what the installed schema binds on every version this
    // plugin supports, so the boot path's own answer is true.
    expect(installed).toBe(true)
  })
})

describe('isWildcardLiteral', () => {
  it('operator: the wildcard classes are recognised, concrete literals are not', () => {
    // Given the literals a CLI --host or a managed block may carry
    // When each is classified
    // Then only the unspecified-address forms count, so a concrete address is
    // never mistaken for the wildcard that must not be echoed back
    expect(isWildcardLiteral('0.0.0.0')).toBe(true)
    expect(isWildcardLiteral('::')).toBe(true)
    expect(isWildcardLiteral('::ffff:0.0.0.0')).toBe(true)
    expect(isWildcardLiteral('192.168.1.5')).toBe(false)
    expect(isWildcardLiteral('127.0.0.1')).toBe(false)
    expect(isWildcardLiteral(undefined)).toBe(false)
  })
})

describe('isLoopbackBind', () => {
  it('operator: the loopback classes and an unsettled bind stay local', () => {
    // Given the loopback literals, the localhost token and an absent bind
    // When each is classified
    // Then all of them are machine-local, so the LAN advertising path is
    // skipped for them
    expect(isLoopbackBind('127.0.0.1')).toBe(true)
    expect(isLoopbackBind('127.0.0.2')).toBe(true)
    expect(isLoopbackBind('::1')).toBe(true)
    expect(isLoopbackBind('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackBind('localhost')).toBe(true)
    expect(isLoopbackBind(undefined)).toBe(true)
    expect(isLoopbackBind('')).toBe(true)
  })

  it('operator: a concrete interface address is not loopback', () => {
    // Given a LAN literal and the wildcard
    // When each is classified
    // Then neither is machine-local
    expect(isLoopbackBind('192.168.1.5')).toBe(false)
    expect(isLoopbackBind('0.0.0.0')).toBe(false)
  })
})

describe('bindUrlHostOf', () => {
  it('operator: an IPv4 literal is its own URL host', () => {
    // Given the literals a managed block pins on this cohort
    // When the URL host is derived
    // Then the bare literal is the authority the QR base is built from
    expect(bindUrlHostOf('192.168.1.5')).toBe('192.168.1.5')
    expect(bindUrlHostOf('127.0.0.1')).toBe('127.0.0.1')
  })
})
