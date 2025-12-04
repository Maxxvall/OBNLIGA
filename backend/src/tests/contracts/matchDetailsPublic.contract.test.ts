import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const has = (src: string, name: string) => new RegExp(`\\b${name}\\b`).test(src)

describe('matchDetailsPublic contract (static)', () => {
  it('exports public helpers and fetchers used by frontend', () => {
    const file = path.join(__dirname, '..', '..', 'services', 'matchDetailsPublic.ts')
    const src = fs.readFileSync(file, 'utf8')

    const expected = [
      'matchBroadcastCacheKey',
      'matchCommentsCacheKey',
      'CommentValidationError',
      'fetchMatchHeader',
      'fetchMatchLineups',
      'fetchMatchStats',
      'fetchMatchEvents',
      'fetchMatchBroadcast',
      'fetchMatchComments',
      'appendMatchComment',
      'shouldHideStats',
    ]

    expect(expected.every(n => has(src, n))).toBe(true)
  })
})
