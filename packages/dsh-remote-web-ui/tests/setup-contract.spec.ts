import { describe, expect, it } from 'vitest'
import {
  SETUP_PATHS,
  setupPlanRequestSchema,
} from '../src/setup-contract.ts'

const VALID_TOKEN = 'cf_test_token_1234567890'

function validRequest(): Record<string, unknown> {
  return {
    hostname: 'remote.acme.com',
    email: 'owner@acme.com',
    credential: {
      source: 'request',
      token: VALID_TOKEN,
    },
  }
}

describe('setup plan request contract', () => {
  it('keeps the setup endpoints local and defaults to the /m-only selector', () => {
    expect(SETUP_PATHS).toEqual({
      preflight: '/api/remote-setup/preflight',
      plan: '/api/remote-setup/plan',
    })

    const parsed = setupPlanRequestSchema.parse({
      ...validRequest(),
      hostname: ' Remote.Acme.COM ',
      email: ' Owner@Acme.COM ',
    })

    expect(parsed.hostname).toBe('remote.acme.com')
    expect(parsed.email).toBe('owner@acme.com')
    expect(parsed.includeRemote).toBe(false)
  })

  it('allows /remote only through an explicit boolean opt-in', () => {
    const parsed = setupPlanRequestSchema.parse({
      ...validRequest(),
      includeRemote: true,
    })

    expect(parsed.includeRemote).toBe(true)
    expect(setupPlanRequestSchema.safeParse({
      ...validRequest(),
      includeRemote: 'true',
    }).success).toBe(false)
  })

  it('accepts either an inline request token or a Keychain reference', () => {
    const inline = setupPlanRequestSchema.parse(validRequest())
    expect(inline.credential).toEqual({ source: 'request', token: VALID_TOKEN })

    const keychain = setupPlanRequestSchema.parse({
      ...validRequest(),
      credential: {
        source: 'keychain',
        service: 'dsh-cloudflare',
        account: 'remote-setup',
      },
    })
    expect(keychain.credential).toEqual({
      source: 'keychain',
      service: 'dsh-cloudflare',
      account: 'remote-setup',
    })
  })

  it('rejects unknown fields at both request and credential boundaries', () => {
    expect(setupPlanRequestSchema.safeParse({
      ...validRequest(),
      apply: true,
    }).success).toBe(false)

    expect(setupPlanRequestSchema.safeParse({
      ...validRequest(),
      credential: {
        source: 'request',
        token: VALID_TOKEN,
        service: 'unexpected',
      },
    }).success).toBe(false)

    expect(setupPlanRequestSchema.safeParse({
      ...validRequest(),
      credential: {
        source: 'keychain',
        service: 'dsh-cloudflare',
        token: VALID_TOKEN,
      },
    }).success).toBe(false)
  })

  it.each([
    'Remote\nAdmin',
    'Remote\u0000Admin',
    'Remote\u007fAdmin',
  ])('rejects control characters in accessAppName: %j', (accessAppName) => {
    expect(setupPlanRequestSchema.safeParse({
      ...validRequest(),
      accessAppName,
    }).success).toBe(false)
  })

  it.each([
    'localhost',
    'remote.internal',
    'remote.example',
    '192.0.2.1',
    'bad_label.acme.com',
  ])('rejects a non-public hostname: %s', (hostname) => {
    expect(setupPlanRequestSchema.safeParse({
      ...validRequest(),
      hostname,
    }).success).toBe(false)
  })

  it.each([
    { field: 'email', value: 'not-an-email' },
    { field: 'credential', value: { source: 'request', token: 'too-short' } },
    { field: 'credential', value: { source: 'request', token: 'token with whitespace 1234567890' } },
  ])('rejects invalid $field input', ({ field, value }) => {
    expect(setupPlanRequestSchema.safeParse({
      ...validRequest(),
      [field]: value,
    }).success).toBe(false)
  })
})
