import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const extractExportNames = (source: string): string[] => {
  const rx = /export\s+(?:interface|type|const|function|class|enum)\s+([A-Za-z0-9_]+)/gm
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = rx.exec(source)) !== null) {
    results.push(m[1])
  }
  return results.sort()
}

describe('cupBracketLogic - export contract (static)', () => {
  it('does not change exported symbols unexpectedly', () => {
    const file = path.join(__dirname, '..', 'services', 'cupBracketLogic.ts')
    const src = fs.readFileSync(file, 'utf8')
    const actual = extractExportNames(src)

    const expected = [
      'GroupStandingEntry',
      'CupBracketConfig',
      'SeriesPlan',
      'PlayoffTeamEntry',
      'QualificationPair',
      'QuarterFinalPair',
      'validateCupConfiguration',
      'getCupPlayoffStructure',
      'generateQualificationPairs4x3',
      'generateQuarterFinalPairs4x3',
      'CUP_STAGE_NAMES',
      'createQualificationSeriesPlans',
      'createQuarterFinalSeriesPlans',
      'createGoldSemiFinalPlans',
      'createSilverSemiFinalPlans',
      'createGoldFinalPlans',
      'createSilverFinalPlans',
      'generateQuarterFinalPairs2Groups',
      'generateSemiFinalPairs2x3',
      'getNextCupStage',
      'isFinalStage',
      'getCupStageRank',
      'TeamWithStats',
      'compareTeams',
      'selectBest8From3x3',
      'generateQuarterFinalPairs3x3',
      'selectBest8From3x4',
      'generateQuarterFinalPairs3x4',
      'selectBest8From2x5',
      'generateQuarterFinalPairs2x5',
      'generateQuarterFinalPairs',
      'needsQualification',
      'getCupQualifyCount',
    ].sort()

    expect(actual).toEqual(expected)
  })
})
