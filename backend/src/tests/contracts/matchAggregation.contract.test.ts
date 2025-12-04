import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const contains = (src: string, name: string) => {
  const rx = new RegExp(`\\b${name}\\b`)
  return rx.test(src)
}

describe('matchAggregation contract (static)', () => {
  it('has main finalization and helper names', () => {
    const file = path.join(__dirname, '..', '..', 'services', 'matchAggregation.ts')
    const src = fs.readFileSync(file, 'utf8')

    const expected = [
      'handleMatchFinalization',
      'rebuildClubSeasonStats',
      'rebuildPlayerSeasonStats',
      'rebuildPlayerCareerStats',
      'processDisqualifications',
      'updatePredictions',
      'updateSeriesState',
      'determineMatchWinnerClubId',
    ]

    expect(expected.every(n => contains(src, n))).toBe(true)
  })
})
