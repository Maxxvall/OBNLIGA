import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const has = (src: string, name: string) => new RegExp(`\\b${name}\\b`).test(src)

describe('ratingSeasons contract (static)', () => {
  it('exports season lifecycle functions and reset helper', () => {
    const file = path.join(__dirname, '..', '..', 'services', 'ratingSeasons.ts')
    const src = fs.readFileSync(file, 'utf8')

    const expected = [
      'getActiveSeasonsMap',
      'getActiveSeason',
      'startSeason',
      'closeActiveSeason',
      'fetchSeasonSummaries',
      'resetSeasonPointsAchievements',
      'SeasonWinnerInput',
    ]

    expect(expected.every(n => has(src, n))).toBe(true)
  })
})
