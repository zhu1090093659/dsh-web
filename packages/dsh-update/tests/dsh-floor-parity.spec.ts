/**
 * The update panel and the plugin manager compatibility gate must read the
 * same DSH floor out of one registry manifest (#1767).
 *
 * They cannot share one function: a cross-package value import is forbidden
 * and the shared/ mirror carries fixed files rather than arbitrary modules, so
 * each package keeps its own reader. That is only safe while the two agree on
 * every shape a manifest can take, which is what this file pins.
 *
 * The floor that matters most is peerDependencies on the host package: a
 * package that declares the host only there still gets its row skipped at
 * boot, so a reader that ignored it would leave the user with no warning.
 *
 * test-standards-allow: pure-function parity over synthetic registry manifests
 */
import { describe, expect, it } from 'vitest'
import { declaredDshFloor } from '../src/update.ts'
import { dshRequirementOf } from '../../dsh-plugin-manager/src/core/version.ts'

/** Manifest shapes a published package can arrive in. */
const MANIFESTS: ReadonlyArray<{ label: string; manifest: Record<string, unknown> }> = [
  { label: 'declares nothing', manifest: {} },
  { label: 'declares dsh.engines.dsh', manifest: { dsh: { engines: { dsh: '>=0.2.0-rc.1' } } } },
  { label: 'declares engines.dsh only', manifest: { engines: { dsh: '>=0.1.0-rc.8' } } },
  { label: 'declares the host only as a peer', manifest: { peerDependencies: { '@deepseek-ai/dsh': '>=0.2.0-rc.1' } } },
  {
    label: 'prefers dsh.engines.dsh over the peer range',
    manifest: { dsh: { engines: { dsh: '>=0.2.2-alpha.3' } }, peerDependencies: { '@deepseek-ai/dsh': '>=0.1.0' } },
  },
  { label: 'ignores a peer on another package', manifest: { peerDependencies: { react: '>=18' } } },
  { label: 'ignores a non-string floor', manifest: { dsh: { engines: { dsh: 7 } } } },
  { label: 'ignores an empty floor', manifest: { dsh: { engines: { dsh: '   ' } } } },
  { label: 'tolerates a non-object manifest', manifest: { dsh: 'nope' } },
]

describe('the update panel and the compatibility gate read one floor (#1767)', () => {
  it.each(MANIFESTS)('both readers answer the same for a manifest that $label', ({ manifest }) => {
    // Given one published manifest shape
    // When the update panel's reader and the gate's reader each read it
    // Then they answer identically, so the panel can never contradict the gate
    expect(declaredDshFloor(manifest)).toBe(dshRequirementOf(manifest))
  })

  it('reports the floor of a package that only declares the host as a peer', () => {
    // Given a package whose only host requirement is a peer range, the shape
    // that gets its row skipped at boot without any other signal
    const manifest = { peerDependencies: { '@deepseek-ai/dsh': '>=0.2.0-rc.1' } }
    // When the panel reads the floor
    // Then it surfaces it instead of saying nothing
    expect(declaredDshFloor(manifest)).toBe('>=0.2.0-rc.1')
    expect(dshRequirementOf(manifest)).toBe('>=0.2.0-rc.1')
  })
})