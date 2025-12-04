import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const extractExports = (src: string) => {
  const rx = /export\s+(?:const|function|type|interface)\s+([A-Za-z0-9_]+)/gm
  const res: string[] = []
  let m: RegExpExecArray | null
  while ((m = rx.exec(src)) !== null) res.push(m[1])
  return res
}

describe('ratingAggregation contract (static)', () => {
  it('exports main aggregation and leaderboard functions', () => {
    const file = path.join(__dirname, '..', '..', 'services', 'ratingAggregation.ts')
    const src = fs.readFileSync(file, 'utf8')
    const actual = extractExports(src)

    const expected = [
      'recalculateUserRatings',
      'RatingLeaderboardEntry',
      'RatingLeaderboardResult',
      'loadRatingLeaderboard',
      'ratingPublicCacheKey',
      'RATING_CACHE_OPTIONS',
      'RATING_SNAPSHOT_RETENTION_DAYS',
      'cleanupOldRatingSnapshots',
    ]

    expect(expected.every(n => actual.includes(n))).toBe(true)
  })
})
