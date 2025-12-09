import { AchievementMetric } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { mapAchievementBadges, mapAchievementStats, mapLeaguePlayerCardInfo } from '../routes/userCardRoutes'

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

describe('mapAchievementBadges', () => {
  it('returns empty array when no progress entries', () => {
    expect(mapAchievementBadges([], [])).toEqual([])
  })

  it('maps badges with icon and title from levels', () => {
    const result = mapAchievementBadges(
      [
        {
          achievementId: 42,
          currentLevel: 3,
          achievementType: { name: 'Daily Login', metric: AchievementMetric.DAILY_LOGIN },
        },
      ],
      [
        {
          achievementId: 42,
          level: 3,
          iconUrl: '/icons/streak-gold.webp',
          title: 'Капитан',
        },
      ]
    )

    expect(result).toEqual([
      {
        achievementId: 42,
        group: 'streak',
        level: 3,
        iconUrl: '/icons/streak-gold.webp',
        title: 'Капитан',
      },
    ])
  })

  it('falls back to achievement type name when level data is missing', () => {
    const result = mapAchievementBadges(
      [
        {
          achievementId: 7,
          currentLevel: 1,
          achievementType: { name: 'Season Points', metric: AchievementMetric.SEASON_POINTS },
        },
      ],
      []
    )

    expect(result).toEqual([
      {
        achievementId: 7,
        group: 'credits',
        level: 1,
        iconUrl: null,
        title: 'Season Points',
      },
    ])
  })
})

describe('mapLeaguePlayerCardInfo', () => {
  it('maps basic fields and zeroes missing stats', () => {
    const result = mapLeaguePlayerCardInfo({
      person: { id: 10, firstName: 'Test', lastName: 'Player' },
      totalStats: null,
      currentClub: null,
      clubs: [],
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
      clubs: [],
    })
  })

  it('maps provided stats and club info', () => {
    const result = mapLeaguePlayerCardInfo({
      person: { id: 22, firstName: 'Jane', lastName: 'Doe' },
      totalStats: {
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
      clubs: [
        {
          id: 7,
          name: 'Spartak',
          logoUrl: '/logos/spartak.png',
          stats: {
            totalMatches: 12,
            totalGoals: 5,
            totalAssists: 4,
            yellowCards: 1,
            redCards: 0,
          },
        },
      ],
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
      clubs: [
        {
          id: 7,
          name: 'Spartak',
          logoUrl: '/logos/spartak.png',
          stats: {
            totalMatches: 12,
            totalGoals: 5,
            totalAssists: 4,
            yellowCards: 1,
            redCards: 0,
          },
        },
      ],
    })
  })
})
