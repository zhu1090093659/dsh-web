/**
 * frontmatter parsing and rewriting tests (pure logic, no DSH fixtures).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseFrontmatter, setFrontmatterField, stripFrontmatter } from '../src/frontmatter.ts'

const TMP = mkdtempSync(join(tmpdir(), 'skill-explorer-fm-'))
afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('parseFrontmatter', () => {
  it('parses scalar fields and booleans', () => {
    const fm = parseFrontmatter('---\nname: my-skill\ndescription: 描述\nwhenToUse: 场景\ndisable-model-invocation: true\nuser-invocable: false\n---\n正文\n')
    expect(fm.name).toBe('my-skill')
    expect(fm.description).toBe('描述')
    expect(fm.whenToUse).toBe('场景')
    expect(fm.disableModelInvocation).toBe(true)
    expect(fm.userInvocable).toBe(false)
  })

  it('folds block scalars (| and >) into single lines', () => {
    const fm = parseFrontmatter([
      '---',
      'name: block-desc',
      'description: >-',
      '  块标量的',
      '  多行描述。',
      'whenToUse: >',
      '  块标量',
      '  适用场景',
      '---',
      '',
    ].join('\n'))
    expect(fm.description).toBe('块标量的 多行描述。')
    expect(fm.whenToUse).toBe('块标量 适用场景')
  })

  it('parses the input nested block (hint / recordInput)', () => {
    const fm = parseFrontmatter('---\nname: x\ninput:\n  hint: 请输入\n  recordInput: true\n---\n')
    expect(fm.hint).toBe('请输入')
    expect(fm.recordInput).toBe(true)
  })

  it('returns empty object when there is no frontmatter', () => {
    expect(parseFrontmatter('# 无 frontmatter\n\n正文')).toEqual({})
  })

  it('strips quotes around scalar values', () => {
    const fm = parseFrontmatter('---\nname: "quoted-name"\ndescription: \'单引号\'\n---\n')
    expect(fm.name).toBe('quoted-name')
    expect(fm.description).toBe('单引号')
  })
})

describe('stripFrontmatter', () => {
  it('user sees the body verbatim once the leading block is dropped', () => {
    // Given a document with a frontmatter block followed by a body
    const source = '---\nname: a\ndescription: d\n---\n\n# Body\n'

    // When the frontmatter block is stripped
    const body = stripFrontmatter(source)

    // Then only the body survives, verbatim
    expect(body).toBe('\n# Body\n')
  })

  it('user keeps a body whose own text starts with a fence', () => {
    // Given a document whose body itself starts with a fence
    const source = '---\nname: a\n---\n\n---\nnot frontmatter\n'

    // When the frontmatter block is stripped
    const body = stripFrontmatter(source)

    // Then the body's own fence is not mistaken for frontmatter
    expect(body).toBe('\n---\nnot frontmatter\n')
  })

  it('user gets the input back when there is no frontmatter block', () => {
    // Given a body without any frontmatter block
    const source = '# Just a body\n'

    // When the frontmatter block is stripped
    const body = stripFrontmatter(source)

    // Then the input is returned unchanged
    expect(body).toBe('# Just a body\n')
  })
})

describe('setFrontmatterField', () => {
  const dir = join(TMP, 'toggle')
  mkdirSync(dir, { recursive: true })

  it('rewrites an existing field and preserves the body', () => {
    const file = join(dir, 'a.md')
    writeFileSync(file, '---\nname: a\ndescription: d\n---\n# 正文\n', 'utf8')
    const fm = setFrontmatterField(file, 'disable-model-invocation', true)
    expect(fm.disableModelInvocation).toBe(true)
    const content = readFileSync(file, 'utf8')
    expect(content).toContain('disable-model-invocation: true')
    expect(content).toContain('# 正文')
    expect(content).toContain('name: a')
  })

  it('appends the field when absent', () => {
    const file = join(dir, 'b.md')
    writeFileSync(file, '---\nname: b\n---\n', 'utf8')
    setFrontmatterField(file, 'disable-model-invocation', true)
    expect(readFileSync(file, 'utf8')).toContain('disable-model-invocation: true')
  })

  it('re-enables by writing false', () => {
    const file = join(dir, 'c.md')
    writeFileSync(file, '---\nname: c\ndisable-model-invocation: true\n---\n', 'utf8')
    const fm = setFrontmatterField(file, 'disable-model-invocation', false)
    expect(fm.disableModelInvocation).toBe(false)
  })

  it('throws when the file has no frontmatter', () => {
    const file = join(dir, 'd.md')
    writeFileSync(file, '# no frontmatter\n', 'utf8')
    expect(() => setFrontmatterField(file, 'disable-model-invocation', true)).toThrow(/no frontmatter/)
  })
})
