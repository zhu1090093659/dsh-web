/**
 * Frontmatter parsing and enable/disable patching: validation mirrors the
 * DSH filesystem provider's contract, and patching preserves the body,
 * comments, and flow style.
 */

import { describe, expect, it } from 'vitest'
import { parseSkillText, setSkillEnabled, splitSkillFile } from '../src/core/frontmatter.ts'

const BLOCK_SKILL = [
  '---',
  'name: demo-skill',
  'description: A demo skill.',
  'whenToUse: When needed.',
  '',
  '---',
  '',
  'Body line one.',
  'Body line two.',
  '',
].join('\n')

describe('splitSkillFile', () => {
  it('splits block frontmatter from the body', () => {
    const parts = splitSkillFile(BLOCK_SKILL)
    expect(parts?.frontmatter).toContain('name: demo-skill')
    expect(parts?.body).toContain('Body line one.')
  })

  it('returns undefined without a leading delimiter', () => {
    expect(splitSkillFile('name: demo-skill\n')).toBeUndefined()
  })

  it('returns undefined when the block never closes', () => {
    expect(splitSkillFile('---\nname: demo-skill\n')).toBeUndefined()
  })
})

describe('parseSkillText', () => {
  it('parses a valid skill with defaults', () => {
    const parsed = parseSkillText(BLOCK_SKILL)
    expect(parsed).toMatchObject({
      name: 'demo-skill',
      description: 'A demo skill.',
      whenToUse: 'When needed.',
      invocation: { modelInvocable: true, userInvocable: true },
    })
  })

  it('honors disable-model-invocation and user-invocable', () => {
    const text = [
      '---',
      'name: user-only',
      'description: Slash-only skill.',
      'disable-model-invocation: true',
      '---',
      'body',
    ].join('\n')
    expect(parseSkillText(text)?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
  })

  it('rejects a non-kebab name', () => {
    const text = '---\nname: Not A Skill\ndescription: x\n---\nbody'
    expect(parseSkillText(text)).toBeUndefined()
  })

  it('rejects missing description', () => {
    const text = '---\nname: demo-skill\n---\nbody'
    expect(parseSkillText(text)).toBeUndefined()
  })

  it('rejects non-object frontmatter', () => {
    const text = '---\n- a\n- b\n---\nbody'
    expect(parseSkillText(text)).toBeUndefined()
  })

  it('accepts flow-style frontmatter', () => {
    const text = '---\n{ name: demo-skill, description: Flow skill }\n---\nbody'
    expect(parseSkillText(text)?.name).toBe('demo-skill')
  })
})

describe('setSkillEnabled', () => {
  it('disables both surfaces and preserves the body and extra keys', () => {
    const patched = setSkillEnabled(BLOCK_SKILL, false)
    expect(patched).toBeDefined()
    const parsed = parseSkillText(patched!)
    expect(parsed?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
    expect(parsed?.whenToUse).toBe('When needed.')
    expect(patched).toContain('Body line one.')
  })

  it('re-enables by removing both keys', () => {
    const disabled = setSkillEnabled(BLOCK_SKILL, false)!
    const reenabled = setSkillEnabled(disabled, true)!
    const parsed = parseSkillText(reenabled)
    expect(parsed?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(reenabled).not.toContain('disable-model-invocation')
    expect(reenabled).not.toContain('user-invocable')
  })

  it('preserves comment lines in the frontmatter', () => {
    const text = [
      '---',
      '# a comment',
      'name: demo-skill',
      'description: A demo skill.',
      '---',
      'body',
    ].join('\n')
    const patched = setSkillEnabled(text, false)!
    expect(patched).toContain('# a comment')
    expect(parseSkillText(patched)?.invocation.modelInvocable).toBe(false)
  })

  it('handles flow-style frontmatter', () => {
    const text = '---\n{ name: demo-skill, description: Flow skill }\n---\nbody'
    const patched = setSkillEnabled(text, false)
    expect(patched).toBeDefined()
    expect(parseSkillText(patched!)?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
  })

  it('returns undefined without parseable frontmatter', () => {
    expect(setSkillEnabled('plain text', false)).toBeUndefined()
  })

  it('tolerates CRLF line endings', () => {
    const text = '---\r\nname: demo-skill\r\ndescription: A demo skill.\r\n---\r\nbody'
    const patched = setSkillEnabled(text, false)
    expect(patched).toBeDefined()
    expect(parseSkillText(patched!)?.invocation.modelInvocable).toBe(false)
  })
})
