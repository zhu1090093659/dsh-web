/**
 * Client half tests: the drop message, composer textarea lookup, and the
 * controlled-textarea value setter.
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { claimedOriginalPath, composeDropMessage, findComposerTextarea, setTextareaValue } from '../src/client/index.ts'

describe('composeDropMessage', () => {
  it('emits just the paths, one per file', () => {
    const message = composeDropMessage([
      { name: 'a.pdf', path: '/x/a.pdf' },
      { name: 'b.png', path: '/deep/dir/b.png' },
    ], 'zh-CN')
    expect(message).toBe('/x/a.pdf\n/deep/dir/b.png')
    expect(message).not.toContain('用户拖入了文件：')
    expect(message).not.toContain('路径：')
  })

  it('annotates an unresolved (staged) path', () => {
    const message = composeDropMessage([{ name: 'a.pdf', path: '/staged/a.pdf', resolved: false }], 'zh-CN')
    expect(message).toBe('/staged/a.pdf（未找到原路径，已暂存副本）')
  })

  it('omits the annotation for a resolved original path', () => {
    const message = composeDropMessage([{ name: 'a.pdf', path: '/Users/qi/Downloads/a.pdf', resolved: true }], 'zh-CN')
    expect(message).toBe('/Users/qi/Downloads/a.pdf')
    expect(message).not.toContain('暂存')
  })
})

describe('claimedOriginalPath', () => {
  /** jsdom has no DataTransfer constructor; the function only reads getData. */
  function uriListDataTransfer(uriList: string): DataTransfer {
    return { getData: (type: string) => type === 'text/uri-list' ? uriList : '' } as unknown as DataTransfer
  }

  it('extracts a matching file:// path from text/uri-list', () => {
    const dt = uriListDataTransfer('file:///Users/qi/Downloads/报告.pdf')
    expect(claimedOriginalPath(dt, '报告.pdf')).toBe('/Users/qi/Downloads/报告.pdf')
  })

  it('ignores non-matching and non-file uris', () => {
    const dt = uriListDataTransfer('https://example.com/x.pdf\nfile:///Users/qi/Desktop/other.txt')
    expect(claimedOriginalPath(dt, 'x.pdf')).toBeUndefined()
  })

  it('returns undefined without a uri-list payload', () => {
    expect(claimedOriginalPath(null, 'a.txt')).toBeUndefined()
    expect(claimedOriginalPath(uriListDataTransfer(''), 'a.txt')).toBeUndefined()
  })
})

describe('findComposerTextarea', () => {
  it('prefers the data-phase textarea inside the composer seat', () => {
    document.body.innerHTML = [
      '<div data-composer-seat>',
      '  <textarea id="composer" data-phase="blank"></textarea>',
      '</div>',
      '<textarea id="other"></textarea>',
    ].join('')
    expect(findComposerTextarea(document)?.id).toBe('composer')
  })

  it('skips disabled and aria-hidden textareas', () => {
    document.body.innerHTML = [
      '<div data-composer-seat>',
      '  <textarea id="mirror" data-phase="blank" aria-hidden="true"></textarea>',
      '  <textarea id="real" data-phase="blank"></textarea>',
      '</div>',
    ].join('')
    expect(findComposerTextarea(document)?.id).toBe('real')
  })

  it('falls back to any data-phase textarea without a seat', () => {
    document.body.innerHTML = '<textarea id="phasey" data-phase="blank"></textarea>'
    expect(findComposerTextarea(document)?.id).toBe('phasey')
  })

  it('falls back to any editable textarea when nothing carries data-phase', () => {
    document.body.innerHTML = '<textarea id="lonely"></textarea>'
    expect(findComposerTextarea(document)?.id).toBe('lonely')
  })

  it('returns undefined when there is no textarea', () => {
    document.body.innerHTML = '<div></div>'
    expect(findComposerTextarea(document)).toBeUndefined()
  })
})

describe('setTextareaValue', () => {
  it('sets the value and fires an input event', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>'
    const textarea = document.getElementById('t') as HTMLTextAreaElement
    let fired = false
    textarea.addEventListener('input', () => { fired = true })
    setTextareaValue(textarea, 'hello')
    expect(textarea.value).toBe('hello')
    expect(fired).toBe(true)
  })
})
