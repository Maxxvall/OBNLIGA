import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const extractExports = (src: string) => {
  const rx = /export\s+(?:async\s+)?(?:const|function|type|interface)\s+([A-Za-z0-9_]+)/gm
  const res: string[] = []
  let m: RegExpExecArray | null
  while ((m = rx.exec(src)) !== null) res.push(m[1])
  return res.sort()
}

describe('achievementJobProcessor contract (static)', () => {
  it('exports reward configs and job helpers', () => {
    const file = path.join(__dirname, '..', '..', 'services', 'achievementJobProcessor.ts')
    const src = fs.readFileSync(file, 'utf8')
    const actual = extractExports(src)

    const expected = [
      'STREAK_REWARD_CONFIG',
      'PREDICTIONS_REWARD_CONFIG',
      'SEASON_POINTS_REWARD_CONFIG',
      'BET_WINS_REWARD_CONFIG',
      'PREDICTION_STREAK_REWARD_CONFIG',
      'EXPRESS_WINS_REWARD_CONFIG',
      'BROADCAST_WATCH_REWARD_CONFIG',
      'createAchievementRewardJob',
      'processPendingAchievementJobs',
      'getCurrentYearSeasonId',
      'getAchievementJobsStats',
    ].sort()

    expect(expected.every(n => actual.includes(n))).toBe(true)
  })
})
