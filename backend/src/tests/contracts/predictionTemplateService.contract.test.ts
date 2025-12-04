import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const has = (src: string, name: string) => new RegExp(`\\b${name}\\b`).test(src)

describe('predictionTemplateService contract (static)', () => {
  it('exports main types and functions and keeps key helpers', () => {
    const file = path.join(__dirname, '..', '..', 'services', 'predictionTemplateService.ts')
    const src = fs.readFileSync(file, 'utf8')

    const expected = [
      'MatchTemplateEnsureSummary',
      'PredictionTemplateRangeSummary',
      'invalidateUpcomingPredictionCaches',
      'ensurePredictionTemplatesForMatch',
      'ensurePredictionTemplatesInRange',
      'clampProbability',
      'distributeInverseProbabilityPoints',
    ]

    expect(expected.every(n => has(src, n))).toBe(true)
  })
})
