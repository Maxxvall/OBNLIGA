import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const has = (src: string, name: string) => new RegExp(`\\b${name}\\b`).test(src)

describe('predictionSettlement contract (static)', () => {
  it('exports settlement entry and helpers', () => {
    const file = path.join(__dirname, '..', '..', 'services', 'predictionSettlement.ts')
    const src = fs.readFileSync(file, 'utf8')

    const expected = [
      'settlePredictionEntries',
      'determineMatchOutcome',
      'computeAwardedPoints',
      'getPointsForSelection',
      'evaluateOutcome',
      'evaluateTotalGoals',
      'evaluateBooleanMarket',
      'evaluateEntry',
    ]

    expect(expected.every(n => has(src, n))).toBe(true)
  })
})
