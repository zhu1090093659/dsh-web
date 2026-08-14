export function capitalize(source: string) {
  return source.charAt(0).toUpperCase() + source.slice(1)
}

export function uncapitalize(source: string) {
  return source.charAt(0).toLowerCase() + source.slice(1)
}

export function camelCase(source: string) {
  return source.replace(/[_-][a-z]/g, str => str.slice(1).toUpperCase())
}

const enum State {
  DELIM,
  UPPER,
  LOWER,
}

function tokenize(source: string, delimiters: number[], delimiter: number) {
  const output: number[] = []
  let state = State.DELIM
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code >= 65 && code <= 90) {
      if (state === State.UPPER) {
        const next = source.charCodeAt(i + 1)
        if (next >= 97 && next <= 122) {
          output.push(delimiter)
        }
        output.push(code + 32)
      } else {
        if (state !== State.DELIM) {
          output.push(delimiter)
        }
        output.push(code + 32)
      }
      state = State.UPPER
    } else if (code >= 97 && code <= 122) {
      output.push(code)
      state = State.LOWER
    } else if (delimiters.includes(code)) {
      if (state !== State.DELIM) {
        output.push(delimiter)
      }
      state = State.DELIM
    } else {
      output.push(code)
    }
  }
  return String.fromCharCode(...output)
}

export function paramCase(source: string) {
  return tokenize(source, [45, 95], 45)
}

export function snakeCase(source: string) {
  return tokenize(source, [45, 95], 95)
}

export const camelize = camelCase
export const hyphenate = paramCase

namespace Letter {
  /* eslint-disable @typescript-eslint/member-delimiter-style */
  interface LowerToUpper {
    a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', h: 'H', i: 'I', j: 'J', k: 'K', l: 'L', m: 'M',
    n: 'N', o: 'O', p: 'P', q: 'Q', r: 'R', s: 'S', t: 'T', u: 'U', v: 'V', w: 'W', x: 'X', y: 'Y', z: 'Z',
  }

  interface UpperToLower {
    A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f', G: 'g', H: 'h', I: 'i', J: 'j', K: 'k', L: 'l', M: 'm',
    N: 'n', O: 'o', P: 'p', Q: 'q', R: 'r', S: 's', T: 't', U: 'u', V: 'v', W: 'w', X: 'x', Y: 'y', Z: 'z',
  }
  /* eslint-enable @typescript-eslint/member-delimiter-style */

  export type Upper = keyof UpperToLower
  export type Lower = keyof LowerToUpper

  export type ToUpper<S extends string> = S extends Lower ? LowerToUpper[S] : S
  export type ToLower<S extends string, P extends string = ''> = S extends Upper ? `${P}${UpperToLower[S]}` : S
}

/* eslint-disable @typescript-eslint/naming-convention */
export type camelize<S extends string> = S extends `${infer L}-${infer M}${infer R}` ? `${L}${Letter.ToUpper<M>}${camelize<R>}` : S
export type hyphenate<S extends string> = S extends `${infer L}${infer R}` ? `${Letter.ToLower<L, '-'>}${hyphenate<R>}` : S
/* eslint-enable @typescript-eslint/naming-convention */

export function formatProperty(key: keyof any) {
  if (typeof key !== 'string') return `[${key.toString()}]`
  return /^[a-z_$][\w$]*$/i.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`
}

export function trimSlash(source: string) {
  return source.replace(/\/$/, '')
}

export function sanitize(source: string) {
  if (!source.startsWith('/')) source = '/' + source
  return trimSlash(source)
}
