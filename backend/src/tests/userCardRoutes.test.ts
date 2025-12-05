import { describe, expect, it } from 'vitest'
import { mapAchievementStats, mapLeaguePlayerCardInfo } from '../routes/userCardRoutes'

describe('mapAchievementStats', () => {
  it('returns zeros when aggregate is null', () => {
    const result = mapAchievementStats(null)
    expect(result).toEqual({ achievementCount: 0, achievementMaxLevel: 0 })
  })

  it('maps count and max level from aggregate', () => {
    const result = mapAchievementStats({
      _count: { _all: 5 },
      _max: { currentLevel: 3 },
    })

    expect(result).toEqual({ achievementCount: 5, achievementMaxLevel: 3 })
  })
})

describe('mapLeaguePlayerCardInfo', () => {
  it('maps basic fields and zeroes missing stats', () => {
    const result = mapLeaguePlayerCardInfo({
      person: { id: 10, firstName: 'Test', lastName: 'Player' },
      stats: null,
      club: null,
    })

    expect(result).toEqual({
      id: 10,
      firstName: 'Test',
      lastName: 'Player',
      stats: {
        totalMatches: 0,
        totalGoals: 0,
        totalAssists: 0,
        yellowCards: 0,
        redCards: 0,
      },
      currentClub: null,
    })
  })

  it('maps provided stats and club info', () => {
    const result = mapLeaguePlayerCardInfo({
      person: { id: 22, firstName: 'Jane', lastName: 'Doe' },
      stats: {
        totalMatches: 12,
        totalGoals: 5,
        totalAssists: 4,
        yellowCards: 1,
        redCards: 0,
      },
      club: {
        id: 7,
        name: 'Spartak',
        shortName: 'SPR',
        logoUrl: '/logos/spartak.png',
      },
    })

    expect(result).toEqual({
      id: 22,
      firstName: 'Jane',
      lastName: 'Doe',
      stats: {
        totalMatches: 12,
        totalGoals: 5,
        totalAssists: 4,
        yellowCards: 1,
        redCards: 0,
      },
      currentClub: {
        id: 7,
        name: 'Spartak',
        shortName: 'SPR',
        logoUrl: '/logos/spartak.png',
      },
    })
  })
})
