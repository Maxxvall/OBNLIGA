/**
 * Тесты агрегации рейтинга пользователей
 *
 * Покрывает:
 * - resolveRatingLevel: определение уровня рейтинга
 * - Расчет totalPoints, seasonalPoints, yearlyPoints
 * - Мифический ранг для топовых игроков
 * - Учет административных корректировок очков
 */

import { describe, it, expect } from 'vitest'
import { RatingLevel } from '@prisma/client'

// ============================================================================
// Копия функции определения уровня рейтинга из ratingConstants.ts
// ============================================================================

const resolveRatingLevel = (totalPoints: number): RatingLevel => {
  if (totalPoints >= 1300) {
    return RatingLevel.MYTHIC
  }
  if (totalPoints >= 950) {
    return RatingLevel.DIAMOND
  }
  if (totalPoints >= 650) {
    return RatingLevel.PLATINUM
  }
  if (totalPoints >= 350) {
    return RatingLevel.GOLD
  }
  if (totalPoints >= 150) {
    return RatingLevel.SILVER
  }
  return RatingLevel.BRONZE
}

// ============================================================================
// Тип для агрегированного рейтинга пользователя
// ============================================================================

type AggregatedUserRating = {
  userId: number
  totalPoints: number
  seasonalPoints: number
  yearlyPoints: number
  level: RatingLevel
  mythicRank: number | null
  currentStreak: number
  maxStreak: number
}

// ============================================================================
// Функции для расчета рейтинга (имитация логики из ratingAggregation.ts)
// ============================================================================

type PointsData = {
  predictionPoints: number
  globalAdjustment: number
  currentAdjustment: number
  yearlyAdjustment: number
}

type TimeWindowPoints = {
  allTime: number
  currentWindow: number
  yearlyWindow: number
}

const calculateTotalPoints = (data: PointsData, timeWindow: TimeWindowPoints): number => {
  return timeWindow.allTime + data.globalAdjustment
}

const calculateSeasonalPoints = (data: PointsData, timeWindow: TimeWindowPoints): number => {
  return timeWindow.currentWindow + data.globalAdjustment + data.currentAdjustment
}

const calculateYearlyPoints = (data: PointsData, timeWindow: TimeWindowPoints): number => {
  return timeWindow.yearlyWindow + data.globalAdjustment + data.yearlyAdjustment
}

const assignMythicRanks = (entries: AggregatedUserRating[]): void => {
  // Сортируем по очкам (убывание)
  const sorted = [...entries].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints
    }
    if (b.seasonalPoints !== a.seasonalPoints) {
      return b.seasonalPoints - a.seasonalPoints
    }
    if (b.yearlyPoints !== a.yearlyPoints) {
      return b.yearlyPoints - a.yearlyPoints
    }
    return a.userId - b.userId
  })

  let mythicRankCounter = 1
  for (const entry of sorted) {
    if (entry.level === RatingLevel.MYTHIC) {
      entry.mythicRank = mythicRankCounter
      mythicRankCounter += 1
    }
  }
}

// ============================================================================
// Тесты resolveRatingLevel
// ============================================================================

describe('resolveRatingLevel - определение уровня рейтинга', () => {
  describe('BRONZE уровень (0-149 очков)', () => {
    it('должен вернуть BRONZE для 0 очков', () => {
      expect(resolveRatingLevel(0)).toBe(RatingLevel.BRONZE)
    })

    it('должен вернуть BRONZE для 1 очка', () => {
      expect(resolveRatingLevel(1)).toBe(RatingLevel.BRONZE)
    })

    it('должен вернуть BRONZE для 149 очков', () => {
      expect(resolveRatingLevel(149)).toBe(RatingLevel.BRONZE)
    })

    it('должен вернуть BRONZE для отрицательных очков', () => {
      expect(resolveRatingLevel(-50)).toBe(RatingLevel.BRONZE)
    })
  })

  describe('SILVER уровень (150-349 очков)', () => {
    it('должен вернуть SILVER для 150 очков (граница)', () => {
      expect(resolveRatingLevel(150)).toBe(RatingLevel.SILVER)
    })

    it('должен вернуть SILVER для 200 очков', () => {
      expect(resolveRatingLevel(200)).toBe(RatingLevel.SILVER)
    })

    it('должен вернуть SILVER для 349 очков', () => {
      expect(resolveRatingLevel(349)).toBe(RatingLevel.SILVER)
    })
  })

  describe('GOLD уровень (350-649 очков)', () => {
    it('должен вернуть GOLD для 350 очков (граница)', () => {
      expect(resolveRatingLevel(350)).toBe(RatingLevel.GOLD)
    })

    it('должен вернуть GOLD для 500 очков', () => {
      expect(resolveRatingLevel(500)).toBe(RatingLevel.GOLD)
    })

    it('должен вернуть GOLD для 649 очков', () => {
      expect(resolveRatingLevel(649)).toBe(RatingLevel.GOLD)
    })
  })

  describe('PLATINUM уровень (650-949 очков)', () => {
    it('должен вернуть PLATINUM для 650 очков (граница)', () => {
      expect(resolveRatingLevel(650)).toBe(RatingLevel.PLATINUM)
    })

    it('должен вернуть PLATINUM для 800 очков', () => {
      expect(resolveRatingLevel(800)).toBe(RatingLevel.PLATINUM)
    })

    it('должен вернуть PLATINUM для 949 очков', () => {
      expect(resolveRatingLevel(949)).toBe(RatingLevel.PLATINUM)
    })
  })

  describe('DIAMOND уровень (950-1299 очков)', () => {
    it('должен вернуть DIAMOND для 950 очков (граница)', () => {
      expect(resolveRatingLevel(950)).toBe(RatingLevel.DIAMOND)
    })

    it('должен вернуть DIAMOND для 1100 очков', () => {
      expect(resolveRatingLevel(1100)).toBe(RatingLevel.DIAMOND)
    })

    it('должен вернуть DIAMOND для 1299 очков', () => {
      expect(resolveRatingLevel(1299)).toBe(RatingLevel.DIAMOND)
    })
  })

  describe('MYTHIC уровень (1300+ очков)', () => {
    it('должен вернуть MYTHIC для 1300 очков (граница)', () => {
      expect(resolveRatingLevel(1300)).toBe(RatingLevel.MYTHIC)
    })

    it('должен вернуть MYTHIC для 2000 очков', () => {
      expect(resolveRatingLevel(2000)).toBe(RatingLevel.MYTHIC)
    })

    it('должен вернуть MYTHIC для 10000 очков', () => {
      expect(resolveRatingLevel(10000)).toBe(RatingLevel.MYTHIC)
    })
  })

  describe('Граничные значения между уровнями', () => {
    it('переход BRONZE → SILVER', () => {
      expect(resolveRatingLevel(149)).toBe(RatingLevel.BRONZE)
      expect(resolveRatingLevel(150)).toBe(RatingLevel.SILVER)
    })

    it('переход SILVER → GOLD', () => {
      expect(resolveRatingLevel(349)).toBe(RatingLevel.SILVER)
      expect(resolveRatingLevel(350)).toBe(RatingLevel.GOLD)
    })

    it('переход GOLD → PLATINUM', () => {
      expect(resolveRatingLevel(649)).toBe(RatingLevel.GOLD)
      expect(resolveRatingLevel(650)).toBe(RatingLevel.PLATINUM)
    })

    it('переход PLATINUM → DIAMOND', () => {
      expect(resolveRatingLevel(949)).toBe(RatingLevel.PLATINUM)
      expect(resolveRatingLevel(950)).toBe(RatingLevel.DIAMOND)
    })

    it('переход DIAMOND → MYTHIC', () => {
      expect(resolveRatingLevel(1299)).toBe(RatingLevel.DIAMOND)
      expect(resolveRatingLevel(1300)).toBe(RatingLevel.MYTHIC)
    })
  })
})

// ============================================================================
// Тесты расчета очков
// ============================================================================

describe('Расчет очков пользователя', () => {
  describe('calculateTotalPoints - общие очки', () => {
    it('должен суммировать очки прогнозов и глобальную корректировку', () => {
      const result = calculateTotalPoints(
        { predictionPoints: 0, globalAdjustment: 50, currentAdjustment: 0, yearlyAdjustment: 0 },
        { allTime: 1000, currentWindow: 500, yearlyWindow: 800 }
      )
      expect(result).toBe(1050)
    })

    it('должен обрабатывать отрицательную корректировку', () => {
      const result = calculateTotalPoints(
        { predictionPoints: 0, globalAdjustment: -100, currentAdjustment: 0, yearlyAdjustment: 0 },
        { allTime: 500, currentWindow: 200, yearlyWindow: 400 }
      )
      expect(result).toBe(400)
    })

    it('должен работать без очков прогнозов', () => {
      const result = calculateTotalPoints(
        { predictionPoints: 0, globalAdjustment: 0, currentAdjustment: 0, yearlyAdjustment: 0 },
        { allTime: 0, currentWindow: 0, yearlyWindow: 0 }
      )
      expect(result).toBe(0)
    })
  })

  describe('calculateSeasonalPoints - сезонные очки', () => {
    it('должен учитывать глобальную и текущую корректировки', () => {
      const result = calculateSeasonalPoints(
        { predictionPoints: 0, globalAdjustment: 50, currentAdjustment: 30, yearlyAdjustment: 0 },
        { allTime: 1000, currentWindow: 500, yearlyWindow: 800 }
      )
      expect(result).toBe(580) // 500 + 50 + 30
    })

    it('должен корректно работать при нулевых корректировках', () => {
      const result = calculateSeasonalPoints(
        { predictionPoints: 0, globalAdjustment: 0, currentAdjustment: 0, yearlyAdjustment: 0 },
        { allTime: 1000, currentWindow: 300, yearlyWindow: 800 }
      )
      expect(result).toBe(300)
    })
  })

  describe('calculateYearlyPoints - годовые очки', () => {
    it('должен учитывать глобальную и годовую корректировки', () => {
      const result = calculateYearlyPoints(
        { predictionPoints: 0, globalAdjustment: 50, currentAdjustment: 0, yearlyAdjustment: 100 },
        { allTime: 1000, currentWindow: 500, yearlyWindow: 800 }
      )
      expect(result).toBe(950) // 800 + 50 + 100
    })
  })
})

// ============================================================================
// Тесты мифического ранга
// ============================================================================

describe('Мифический ранг', () => {
  it('должен присвоить ранги только игрокам с MYTHIC уровнем', () => {
    const entries: AggregatedUserRating[] = [
      {
        userId: 1,
        totalPoints: 1500,
        seasonalPoints: 500,
        yearlyPoints: 1000,
        level: RatingLevel.MYTHIC,
        mythicRank: null,
        currentStreak: 0,
        maxStreak: 0,
      },
      {
        userId: 2,
        totalPoints: 900,
        seasonalPoints: 300,
        yearlyPoints: 700,
        level: RatingLevel.PLATINUM,
        mythicRank: null,
        currentStreak: 0,
        maxStreak: 0,
      },
      {
        userId: 3,
        totalPoints: 1400,
        seasonalPoints: 400,
        yearlyPoints: 900,
        level: RatingLevel.MYTHIC,
        mythicRank: null,
        currentStreak: 0,
        maxStreak: 0,
      },
    ]

    assignMythicRanks(entries)

    const user1 = entries.find(e => e.userId === 1)!
    const user2 = entries.find(e => e.userId === 2)!
    const user3 = entries.find(e => e.userId === 3)!

    expect(user1.mythicRank).toBe(1) // 1500 очков — первый
    expect(user3.mythicRank).toBe(2) // 1400 очков — второй
    expect(user2.mythicRank).toBe(null) // не MYTHIC
  })

  it('должен корректно обрабатывать равные очки', () => {
    const entries: AggregatedUserRating[] = [
      {
        userId: 1,
        totalPoints: 1500,
        seasonalPoints: 600,
        yearlyPoints: 1000,
        level: RatingLevel.MYTHIC,
        mythicRank: null,
        currentStreak: 0,
        maxStreak: 0,
      },
      {
        userId: 2,
        totalPoints: 1500,
        seasonalPoints: 500, // меньше сезонных
        yearlyPoints: 1000,
        level: RatingLevel.MYTHIC,
        mythicRank: null,
        currentStreak: 0,
        maxStreak: 0,
      },
    ]

    assignMythicRanks(entries)

    const user1 = entries.find(e => e.userId === 1)!
    const user2 = entries.find(e => e.userId === 2)!

    expect(user1.mythicRank).toBe(1) // больше сезонных очков
    expect(user2.mythicRank).toBe(2)
  })

  it('не должен присваивать ранги если нет MYTHIC игроков', () => {
    const entries: AggregatedUserRating[] = [
      {
        userId: 1,
        totalPoints: 900,
        seasonalPoints: 300,
        yearlyPoints: 700,
        level: RatingLevel.PLATINUM,
        mythicRank: null,
        currentStreak: 0,
        maxStreak: 0,
      },
      {
        userId: 2,
        totalPoints: 500,
        seasonalPoints: 200,
        yearlyPoints: 400,
        level: RatingLevel.GOLD,
        mythicRank: null,
        currentStreak: 0,
        maxStreak: 0,
      },
    ]

    assignMythicRanks(entries)

    expect(entries[0].mythicRank).toBe(null)
    expect(entries[1].mythicRank).toBe(null)
  })
})

// ============================================================================
// Тесты административных корректировок
// ============================================================================

describe('Административные корректировки очков', () => {
  it('должен применять глобальную корректировку ко всем метрикам', () => {
    const data: PointsData = {
      predictionPoints: 0,
      globalAdjustment: 100, // +100 везде
      currentAdjustment: 0,
      yearlyAdjustment: 0,
    }
    const timeWindow: TimeWindowPoints = {
      allTime: 500,
      currentWindow: 200,
      yearlyWindow: 400,
    }

    expect(calculateTotalPoints(data, timeWindow)).toBe(600)
    expect(calculateSeasonalPoints(data, timeWindow)).toBe(300)
    expect(calculateYearlyPoints(data, timeWindow)).toBe(500)
  })

  it('должен применять скопированную корректировку только к соответствующей метрике', () => {
    const data: PointsData = {
      predictionPoints: 0,
      globalAdjustment: 0,
      currentAdjustment: 50, // только для сезонных
      yearlyAdjustment: 75, // только для годовых
    }
    const timeWindow: TimeWindowPoints = {
      allTime: 500,
      currentWindow: 200,
      yearlyWindow: 400,
    }

    expect(calculateTotalPoints(data, timeWindow)).toBe(500) // без корректировки
    expect(calculateSeasonalPoints(data, timeWindow)).toBe(250) // +50
    expect(calculateYearlyPoints(data, timeWindow)).toBe(475) // +75
  })

  it('должен корректно обрабатывать отрицательные корректировки', () => {
    const data: PointsData = {
      predictionPoints: 0,
      globalAdjustment: -50,
      currentAdjustment: -25,
      yearlyAdjustment: -30,
    }
    const timeWindow: TimeWindowPoints = {
      allTime: 500,
      currentWindow: 200,
      yearlyWindow: 400,
    }

    expect(calculateTotalPoints(data, timeWindow)).toBe(450)
    expect(calculateSeasonalPoints(data, timeWindow)).toBe(125) // 200 - 50 - 25
    expect(calculateYearlyPoints(data, timeWindow)).toBe(320) // 400 - 50 - 30
  })
})

// ============================================================================
// Тесты стриков (серий побед)
// ============================================================================

describe('Серии побед (streaks)', () => {
  const calculateCurrentStreak = (results: ('WON' | 'LOST')[]): number => {
    if (results.length === 0) return 0

    let streak = 0
    // Считаем от конца
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i] === 'WON') {
        streak++
      } else {
        break
      }
    }
    return streak
  }

  const calculateMaxStreak = (results: ('WON' | 'LOST')[]): number => {
    if (results.length === 0) return 0

    let maxStreak = 0
    let currentStreak = 0

    for (const result of results) {
      if (result === 'WON') {
        currentStreak++
        maxStreak = Math.max(maxStreak, currentStreak)
      } else {
        currentStreak = 0
      }
    }

    return maxStreak
  }

  it('должен правильно рассчитать текущий стрик', () => {
    expect(calculateCurrentStreak(['WON', 'WON', 'WON'])).toBe(3)
    expect(calculateCurrentStreak(['LOST', 'WON', 'WON'])).toBe(2)
    expect(calculateCurrentStreak(['WON', 'WON', 'LOST'])).toBe(0)
    expect(calculateCurrentStreak(['LOST'])).toBe(0)
    expect(calculateCurrentStreak([])).toBe(0)
  })

  it('должен правильно рассчитать максимальный стрик', () => {
    expect(calculateMaxStreak(['WON', 'WON', 'WON'])).toBe(3)
    expect(calculateMaxStreak(['WON', 'LOST', 'WON', 'WON', 'WON', 'LOST'])).toBe(3)
    expect(calculateMaxStreak(['LOST', 'LOST', 'LOST'])).toBe(0)
    expect(calculateMaxStreak(['WON', 'LOST', 'WON', 'LOST'])).toBe(1)
  })

  it('максимальный стрик должен быть >= текущего', () => {
    const results: ('WON' | 'LOST')[] = ['WON', 'WON', 'LOST', 'WON']
    const current = calculateCurrentStreak(results)
    const max = calculateMaxStreak(results)
    expect(max).toBeGreaterThanOrEqual(current)
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases - граничные условия рейтинга', () => {
  it('должен обрабатывать пользователей без прогнозов', () => {
    const result = calculateTotalPoints(
      { predictionPoints: 0, globalAdjustment: 0, currentAdjustment: 0, yearlyAdjustment: 0 },
      { allTime: 0, currentWindow: 0, yearlyWindow: 0 }
    )
    expect(result).toBe(0)
    expect(resolveRatingLevel(result)).toBe(RatingLevel.BRONZE)
  })

  it('должен корректно работать с очень большими числами', () => {
    expect(resolveRatingLevel(999999)).toBe(RatingLevel.MYTHIC)
    expect(resolveRatingLevel(1000000)).toBe(RatingLevel.MYTHIC)
  })

  it('должен сортировать пользователей с одинаковыми очками по userId', () => {
    const entries: AggregatedUserRating[] = [
      {
        userId: 10,
        totalPoints: 1500,
        seasonalPoints: 500,
        yearlyPoints: 1000,
        level: RatingLevel.MYTHIC,
        mythicRank: null,
        currentStreak: 0,
        maxStreak: 0,
      },
      {
        userId: 5,
        totalPoints: 1500,
        seasonalPoints: 500,
        yearlyPoints: 1000,
        level: RatingLevel.MYTHIC,
        mythicRank: null,
        currentStreak: 0,
        maxStreak: 0,
      },
    ]

    assignMythicRanks(entries)

    const user5 = entries.find(e => e.userId === 5)!
    const user10 = entries.find(e => e.userId === 10)!

    // При равных очках, меньший userId получает лучший ранг
    expect(user5.mythicRank).toBe(1)
    expect(user10.mythicRank).toBe(2)
  })
})
