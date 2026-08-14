/**
 * Workspace-gate tests: the canonical membership function (isPathInside) —
 * the security boundary every fs/git path check relies on. Table-driven so a
 * sibling-prefix or off-by-one regression is caught immediately.
 *
 * Note: `..` collapse is the caller's job (join() happens before the check in
 * fs-service.resolveInsideRoot / git-service.pathsInside); isPathInside is a
 * pure prefix check on already-joined paths.
 */
import { describe, expect, it } from 'vitest'
import { isPathInside, normalizeForPrefix } from '../src/host/gate.ts'

describe('normalizeForPrefix', () => {
  const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform')!

  /** Run one assertion block with process.platform stubbed to win32. */
  function asWin32(fn: () => void): void {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      fn()
    } finally {
      Object.defineProperty(process, 'platform', platformDesc)
    }
  }

  it('is the identity on this host (non-win32)', () => {
    expect(normalizeForPrefix('/w/a.txt')).toBe('/w/a.txt')
  })

  it('collapses backslashes to forward slashes on win32', () => {
    asWin32(() => {
      expect(normalizeForPrefix('D:\\Cs\\myproj\\README.md')).toBe('d:/cs/myproj/readme.md')
      expect(normalizeForPrefix('\\server\\share\\x')).toBe('/server/share/x')
    })
  })

  it('drops trailing slashes on win32', () => {
    asWin32(() => {
      expect(normalizeForPrefix('C:/proj/')).toBe('c:/proj')
      expect(normalizeForPrefix('D:\\Cs\\myproj\\')).toBe('d:/cs/myproj')
    })
  })
})

describe('isPathInside', () => {
  it('accepts equality (with and without trailing slash)', () => {
    expect(isPathInside('/w', '/w')).toBe(true)
    expect(isPathInside('/w', '/w/')).toBe(true)
  })

  it('accepts descendants', () => {
    expect(isPathInside('/w', '/w/a')).toBe(true)
    expect(isPathInside('/w', '/w/a/b/c.txt')).toBe(true)
    expect(isPathInside('/w/a', '/w/a/b')).toBe(true)
  })

  it('rejects siblings and sibling-prefix paths', () => {
    expect(isPathInside('/w', '/w2')).toBe(false)
    expect(isPathInside('/w', '/w2/a')).toBe(false)
    expect(isPathInside('/w/a', '/w/a2')).toBe(false)
    expect(isPathInside('/w/a', '/w/a2/b')).toBe(false)
    expect(isPathInside('/w', '/w.txt')).toBe(false)
  })

  it('rejects parent escapes', () => {
    expect(isPathInside('/w', '/')).toBe(false)
    expect(isPathInside('/w', '/etc')).toBe(false)
    expect(isPathInside('/w/a', '/w')).toBe(false)
  })

  it('rejects empty roots and empty children', () => {
    expect(isPathInside('/w', '')).toBe(false)
    expect(isPathInside('', '/w')).toBe(false)
    expect(isPathInside('', '')).toBe(false)
  })
})

describe('isPathInside on win32 (separator + case robustness, issue #27)', () => {
  const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform')!

  /** Run one assertion block with process.platform stubbed to win32. */
  function asWin32(fn: () => void): void {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      fn()
    } finally {
      Object.defineProperty(process, 'platform', platformDesc)
    }
  }

  it('normalizes backslashes from path.join against a forward-slash root', () => {
    asWin32(() => {
      // git rev-parse --show-toplevel returns forward slashes; path.join
      // yields backslashes — both must resolve inside the same root.
      expect(isPathInside('C:/Users/zcl/proj', 'C:\\Users\\zcl\\proj\\src\\a.ts')).toBe(true)
      expect(isPathInside('C:/Users/zcl/proj', 'C:/Users/zcl/proj/src/a.ts')).toBe(true)
    })
  })

  it('compares case-insensitively (the FS is case-insensitive)', () => {
    asWin32(() => {
      expect(isPathInside('C:/Users/zcl/proj', 'c:\\users\\ZCL\\proj\\src')).toBe(true)
      expect(isPathInside('c:\\users\\zcl\\proj', 'C:/Users/zcl/proj/x')).toBe(true)
    })
  })

  it('still rejects siblings and parent escapes on win32', () => {
    asWin32(() => {
      expect(isPathInside('C:/Users/zcl/proj', 'C:/Users/zcl/proj2/x')).toBe(false)
      expect(isPathInside('C:/Users/zcl/proj', 'C:/Users/zcl')).toBe(false)
      expect(isPathInside('C:/Users/zcl/proj', 'D:/Users/zcl/proj/x')).toBe(false)
    })
  })

  it('treats a root with a trailing slash as the same root', () => {
    asWin32(() => {
      expect(isPathInside('C:/proj', 'C:\\proj\\')).toBe(true)
    })
  })

  it('handles a bare drive-root boundary', () => {
    asWin32(() => {
      expect(isPathInside('C:/', 'C:/x')).toBe(true)
      expect(isPathInside('C:/', 'D:/x')).toBe(false)
    })
  })

  it('handles UNC share prefixes', () => {
    asWin32(() => {
      expect(isPathInside('\\\\server\\share', '\\\\server\\share\\x')).toBe(true)
      expect(isPathInside('\\\\server\\share', '\\\\server\\other\\x')).toBe(false)
    })
  })
})

describe('isPathInside on win32 (realpath vs registry separators, issue #44)', () => {
  const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform')!

  /** Run one assertion block with process.platform stubbed to win32. */
  function asWin32(fn: () => void): void {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      fn()
    } finally {
      Object.defineProperty(process, 'platform', platformDesc)
    }
  }

  // The reported failure: only root listing worked; every non-empty relative
  // path (preview, subdir expand, search walk, write) was rejected as
  // "path escapes root" because realpath()/path.join() produce backslash
  // paths while the registry / git return forward slashes (and drive-letter
  // case drifts). Each case below fixes one side to backslashes or changes
  // the drive-letter / segment case, as real Windows hosts mix these.
  const ROOT = 'D:/Cs/myproj'
  const ROOT_NATIVE = 'D:\\Cs\\myproj'
  const ROOT_LOWER = 'd:\\cs\\myproj'

  it('preview: reads a file whose realpath is all-backslashes', () => {
    asWin32(() => {
      expect(isPathInside(ROOT, ROOT_NATIVE + '\\README.md')).toBe(true)
      expect(isPathInside(ROOT, 'D:/Cs/myproj/README.md')).toBe(true)
    })
  })

  it('expand: opens a subdir resolved by path.join into backslashes', () => {
    asWin32(() => {
      expect(isPathInside(ROOT, ROOT_NATIVE + '\\src\\components')).toBe(true)
      expect(isPathInside(ROOT_NATIVE, 'D:/Cs/myproj/src/components')).toBe(true)
    })
  })

  it('search: walks deep nested directories under the root', () => {
    asWin32(() => {
      expect(isPathInside(ROOT, ROOT_NATIVE + '\\src\\a\\b\\c\\file.ts')).toBe(true)
      expect(isPathInside(ROOT_LOWER, 'D:/Cs/myproj/src/a/b/c/file.ts')).toBe(true)
    })
  })

  it('write: accepts a deep target path inside a root with mixed segment case', () => {
    asWin32(() => {
      expect(isPathInside('D:/Cs/MyProj', ROOT_NATIVE + '\\lib\\index.d.ts')).toBe(true)
      expect(isPathInside(ROOT_NATIVE, 'd:\\cs\\MYPROJ\\lib\\index.js')).toBe(true)
    })
  })

  it('still rejects escapes on a sibling path with a backslash root', () => {
    asWin32(() => {
      expect(isPathInside(ROOT_NATIVE, 'D:/Cs/myproj2/src')).toBe(false)
      expect(isPathInside(ROOT_NATIVE, 'D:/Cs')).toBe(false)
      expect(isPathInside(ROOT_NATIVE, 'E:/Cs/myproj/src')).toBe(false)
    })
  })
})
