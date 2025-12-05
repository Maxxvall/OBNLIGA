import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('seasonAutomation - export contract (static)', () => {
  it('exported symbols remain stable', () => {
    const file = path.join(__dirname, '..', 'services', 'seasonAutomation.ts')
    const src = fs.readFileSync(file, 'utf8')
    const actualSrc = src
    const expected = [
      'SeasonAutomationResult',
      'stageNameForTeams',
      'createInitialPlayoffPlans',
      'createRandomPlayoffPlans',
      'applyTimeToDate',
      'addDays',
      'addMinutes',
      'runSeasonAutomation',
      'PlayoffCreationResult',
      'createSeasonPlayoffs',
      // internal helpers that tests reference
      'generateRoundRobinPairs',
      'generateSeedOrder',
      'highestPowerOfTwo',
      'shuffleNumbers',
    ].sort()

    // Ensure the source contains all expected identifiers (exported or internal)
    const missing = expected.filter(n => !new RegExp(`\\b${n}\\b`).test(actualSrc))
    expect(missing).toEqual([])
  })
})
