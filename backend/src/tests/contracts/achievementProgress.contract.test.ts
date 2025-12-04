import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const extractNames = (src: string) => {
  const rx = /(export\s+)?(?:async\s+)?(?:function|const|let|type|interface)\s+([A-Za-z0-9_]+)/gm
  const res: string[] = []
  let m: RegExpExecArray | null
  while ((m = rx.exec(src)) !== null) {
    res.push(m[2])
  }
  return res.sort()
}

describe('achievementProgress contract (static)', () => {
  it('contains main progress functions', () => {
    const file = path.join(__dirname, '..', '..', 'services', 'achievementProgress.ts')
    const src = fs.readFileSync(file, 'utf8')
    const actual = extractNames(src)

    const expected = [
      'DEFAULT_CLIENT',
      'selectTypeByMetric',
      'resolveUnlockedLevel',
      'incrementAchievementProgress',
      'syncSeasonPointsProgress',
      'syncAllSeasonPointsProgress',
      'syncPredictionStreakProgress',
      'syncBroadcastWatchProgress',
    ].sort()

    expect(expected.every(n => actual.includes(n))).toBe(true)
  })
})
