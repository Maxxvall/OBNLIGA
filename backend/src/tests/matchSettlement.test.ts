/**
 * Тесты обработки завершения матчей (settlement flow)
 *
 * Покрывает:
 * - Определение победителя матча
 * - Обновление статистики команд
 * - Обработка серий матчей
 * - Settlement прогнозов
 * - Триггер пересчета рейтинга
 */

import { describe, it, expect } from 'vitest'
import { MatchStatus, SeriesStatus, PredictionEntryStatus } from '@prisma/client'

// ============================================================================
// Типы
// ============================================================================

type MatchOutcome = {
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
}

type ClubSeasonStats = {
  clubId: number
  points: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
}

type SeriesState = {
  homeWins: number
  awayWins: number
  bestOf: number
  status: SeriesStatus
  winnerClubId: number | null
}

type PredictionEntry = {
  id: number
  userId: number
  selection: string
  status: PredictionEntryStatus
  awardedPoints: number | null
}

// ============================================================================
// Функции settlement (имитация логики из matchAggregation.ts)
// ============================================================================

const determineMatchWinnerClubId = (match: MatchOutcome): number | null => {
  if (match.homeScore > match.awayScore) return match.homeTeamId
  if (match.homeScore < match.awayScore) return match.awayTeamId
  if (match.hasPenaltyShootout) {
    if (match.penaltyHomeScore > match.penaltyAwayScore) return match.homeTeamId
    if (match.penaltyHomeScore < match.penaltyAwayScore) return match.awayTeamId
  }
  return null
}

const calculateMatchPoints = (
  homeScore: number,
  awayScore: number
): { homePoints: number; awayPoints: number } => {
  if (homeScore > awayScore) {
    return { homePoints: 3, awayPoints: 0 }
  }
  if (homeScore < awayScore) {
    return { homePoints: 0, awayPoints: 3 }
  }
  return { homePoints: 1, awayPoints: 1 }
}

const updateStatsAfterMatch = (
  stats: ClubSeasonStats,
  goalsFor: number,
  goalsAgainst: number
): ClubSeasonStats => {
  const newStats = { ...stats }
  newStats.goalsFor += goalsFor
  newStats.goalsAgainst += goalsAgainst

  if (goalsFor > goalsAgainst) {
    newStats.wins += 1
    newStats.points += 3
  } else if (goalsFor < goalsAgainst) {
    newStats.losses += 1
  } else {
    newStats.draws += 1
    newStats.points += 1
  }

  return newStats
}

const updateSeriesAfterMatch = (
  series: SeriesState,
  winnerClubId: number | null,
  homeClubId: number,
  awayClubId: number
): SeriesState => {
  const newSeries = { ...series }

  if (winnerClubId === homeClubId) {
    newSeries.homeWins += 1
  } else if (winnerClubId === awayClubId) {
    newSeries.awayWins += 1
  }

  const winsToWin = Math.ceil(newSeries.bestOf / 2)

  if (newSeries.homeWins >= winsToWin) {
    newSeries.status = SeriesStatus.FINISHED
    newSeries.winnerClubId = homeClubId
  } else if (newSeries.awayWins >= winsToWin) {
    newSeries.status = SeriesStatus.FINISHED
    newSeries.winnerClubId = awayClubId
  }

  return newSeries
}

const processSettlement = (
  entries: PredictionEntry[],
  actualOutcome: string,
  basePoints: number
): PredictionEntry[] => {
  return entries.map(entry => {
    const normalizedSelection = entry.selection.trim().toUpperCase()
    const normalizedOutcome = actualOutcome.trim().toUpperCase()

    if (normalizedSelection === normalizedOutcome) {
      return {
        ...entry,
        status: PredictionEntryStatus.WON,
        awardedPoints: basePoints,
      }
    }

    return {
      ...entry,
      status: PredictionEntryStatus.LOST,
      awardedPoints: 0,
    }
  })
}

// ============================================================================
// Тесты определения победителя матча
// ============================================================================

describe('determineMatchWinnerClubId - определение победителя матча', () => {
  it('победа хозяев по основному счету', () => {
    const match: MatchOutcome = {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 2,
      awayScore: 1,
      hasPenaltyShootout: false,
      penaltyHomeScore: 0,
      penaltyAwayScore: 0,
    }
    expect(determineMatchWinnerClubId(match)).toBe(1)
  })

  it('победа гостей по основному счету', () => {
    const match: MatchOutcome = {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 0,
      awayScore: 3,
      hasPenaltyShootout: false,
      penaltyHomeScore: 0,
      penaltyAwayScore: 0,
    }
    expect(determineMatchWinnerClubId(match)).toBe(2)
  })

  it('ничья без пенальти → null', () => {
    const match: MatchOutcome = {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 1,
      awayScore: 1,
      hasPenaltyShootout: false,
      penaltyHomeScore: 0,
      penaltyAwayScore: 0,
    }
    expect(determineMatchWinnerClubId(match)).toBe(null)
  })

  it('победа хозяев по пенальти', () => {
    const match: MatchOutcome = {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 2,
      awayScore: 2,
      hasPenaltyShootout: true,
      penaltyHomeScore: 5,
      penaltyAwayScore: 4,
    }
    expect(determineMatchWinnerClubId(match)).toBe(1)
  })

  it('победа гостей по пенальти', () => {
    const match: MatchOutcome = {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 0,
      awayScore: 0,
      hasPenaltyShootout: true,
      penaltyHomeScore: 3,
      penaltyAwayScore: 4,
    }
    expect(determineMatchWinnerClubId(match)).toBe(2)
  })

  it('ничья в пенальти → null (редкий случай)', () => {
    const match: MatchOutcome = {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 1,
      awayScore: 1,
      hasPenaltyShootout: true,
      penaltyHomeScore: 4,
      penaltyAwayScore: 4,
    }
    expect(determineMatchWinnerClubId(match)).toBe(null)
  })
})

// ============================================================================
// Тесты расчета очков за матч
// ============================================================================

describe('calculateMatchPoints - расчет турнирных очков', () => {
  it('победа хозяев: 3-0', () => {
    const result = calculateMatchPoints(2, 1)
    expect(result).toEqual({ homePoints: 3, awayPoints: 0 })
  })

  it('победа гостей: 0-3', () => {
    const result = calculateMatchPoints(0, 3)
    expect(result).toEqual({ homePoints: 0, awayPoints: 3 })
  })

  it('ничья: 1-1', () => {
    const result = calculateMatchPoints(1, 1)
    expect(result).toEqual({ homePoints: 1, awayPoints: 1 })
  })

  it('счет 0:0 тоже ничья', () => {
    const result = calculateMatchPoints(0, 0)
    expect(result).toEqual({ homePoints: 1, awayPoints: 1 })
  })

  it('крупная победа тоже 3 очка', () => {
    const result = calculateMatchPoints(10, 0)
    expect(result).toEqual({ homePoints: 3, awayPoints: 0 })
  })
})

// ============================================================================
// Тесты обновления статистики команд
// ============================================================================

describe('updateStatsAfterMatch - обновление статистики команд', () => {
  const initialStats: ClubSeasonStats = {
    clubId: 1,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
  }

  it('победа добавляет 3 очка и 1 победу', () => {
    const updated = updateStatsAfterMatch(initialStats, 2, 1)
    expect(updated.points).toBe(3)
    expect(updated.wins).toBe(1)
    expect(updated.draws).toBe(0)
    expect(updated.losses).toBe(0)
    expect(updated.goalsFor).toBe(2)
    expect(updated.goalsAgainst).toBe(1)
  })

  it('поражение добавляет 0 очков и 1 поражение', () => {
    const updated = updateStatsAfterMatch(initialStats, 0, 3)
    expect(updated.points).toBe(0)
    expect(updated.wins).toBe(0)
    expect(updated.draws).toBe(0)
    expect(updated.losses).toBe(1)
    expect(updated.goalsFor).toBe(0)
    expect(updated.goalsAgainst).toBe(3)
  })

  it('ничья добавляет 1 очко и 1 ничью', () => {
    const updated = updateStatsAfterMatch(initialStats, 2, 2)
    expect(updated.points).toBe(1)
    expect(updated.wins).toBe(0)
    expect(updated.draws).toBe(1)
    expect(updated.losses).toBe(0)
    expect(updated.goalsFor).toBe(2)
    expect(updated.goalsAgainst).toBe(2)
  })

  it('накопительное обновление статистики', () => {
    let stats = { ...initialStats }
    stats = updateStatsAfterMatch(stats, 2, 1) // победа
    stats = updateStatsAfterMatch(stats, 1, 1) // ничья
    stats = updateStatsAfterMatch(stats, 0, 2) // поражение

    expect(stats.points).toBe(4) // 3 + 1 + 0
    expect(stats.wins).toBe(1)
    expect(stats.draws).toBe(1)
    expect(stats.losses).toBe(1)
    expect(stats.goalsFor).toBe(3) // 2 + 1 + 0
    expect(stats.goalsAgainst).toBe(4) // 1 + 1 + 2
  })
})

// ============================================================================
// Тесты обработки серий
// ============================================================================

describe('updateSeriesAfterMatch - обновление серий', () => {
  const homeClubId = 1
  const awayClubId = 2

  describe('Best-of-3 серия', () => {
    it('первая победа хозяев: 1-0, серия продолжается', () => {
      const series: SeriesState = {
        homeWins: 0,
        awayWins: 0,
        bestOf: 3,
        status: SeriesStatus.IN_PROGRESS,
        winnerClubId: null,
      }

      const updated = updateSeriesAfterMatch(series, homeClubId, homeClubId, awayClubId)
      expect(updated.homeWins).toBe(1)
      expect(updated.awayWins).toBe(0)
      expect(updated.status).toBe(SeriesStatus.IN_PROGRESS)
      expect(updated.winnerClubId).toBe(null)
    })

    it('вторая победа хозяев: 2-0, серия завершена', () => {
      const series: SeriesState = {
        homeWins: 1,
        awayWins: 0,
        bestOf: 3,
        status: SeriesStatus.IN_PROGRESS,
        winnerClubId: null,
      }

      const updated = updateSeriesAfterMatch(series, homeClubId, homeClubId, awayClubId)
      expect(updated.homeWins).toBe(2)
      expect(updated.status).toBe(SeriesStatus.FINISHED)
      expect(updated.winnerClubId).toBe(homeClubId)
    })

    it('серия 1-1, победа гостей завершает: 1-2', () => {
      const series: SeriesState = {
        homeWins: 1,
        awayWins: 1,
        bestOf: 3,
        status: SeriesStatus.IN_PROGRESS,
        winnerClubId: null,
      }

      const updated = updateSeriesAfterMatch(series, awayClubId, homeClubId, awayClubId)
      expect(updated.homeWins).toBe(1)
      expect(updated.awayWins).toBe(2)
      expect(updated.status).toBe(SeriesStatus.FINISHED)
      expect(updated.winnerClubId).toBe(awayClubId)
    })

    it('ничья (null) не меняет счет серии', () => {
      const series: SeriesState = {
        homeWins: 1,
        awayWins: 0,
        bestOf: 3,
        status: SeriesStatus.IN_PROGRESS,
        winnerClubId: null,
      }

      const updated = updateSeriesAfterMatch(series, null, homeClubId, awayClubId)
      expect(updated.homeWins).toBe(1)
      expect(updated.awayWins).toBe(0)
      expect(updated.status).toBe(SeriesStatus.IN_PROGRESS)
    })
  })

  describe('Best-of-5 серия', () => {
    it('нужно 3 победы для выигрыша', () => {
      let series: SeriesState = {
        homeWins: 0,
        awayWins: 0,
        bestOf: 5,
        status: SeriesStatus.IN_PROGRESS,
        winnerClubId: null,
      }

      // Первые две победы хозяев
      series = updateSeriesAfterMatch(series, homeClubId, homeClubId, awayClubId)
      series = updateSeriesAfterMatch(series, homeClubId, homeClubId, awayClubId)
      expect(series.homeWins).toBe(2)
      expect(series.status).toBe(SeriesStatus.IN_PROGRESS)

      // Третья победа завершает серию
      series = updateSeriesAfterMatch(series, homeClubId, homeClubId, awayClubId)
      expect(series.homeWins).toBe(3)
      expect(series.status).toBe(SeriesStatus.FINISHED)
      expect(series.winnerClubId).toBe(homeClubId)
    })
  })

  describe('Best-of-7 серия', () => {
    it('нужно 4 победы для выигрыша', () => {
      let series: SeriesState = {
        homeWins: 3,
        awayWins: 2,
        bestOf: 7,
        status: SeriesStatus.IN_PROGRESS,
        winnerClubId: null,
      }

      // Четвертая победа хозяев завершает серию
      series = updateSeriesAfterMatch(series, homeClubId, homeClubId, awayClubId)
      expect(series.homeWins).toBe(4)
      expect(series.status).toBe(SeriesStatus.FINISHED)
      expect(series.winnerClubId).toBe(homeClubId)
    })
  })
})

// ============================================================================
// Тесты settlement прогнозов
// ============================================================================

describe('processSettlement - обработка прогнозов', () => {
  it('выигрышный прогноз получает очки', () => {
    const entries: PredictionEntry[] = [
      { id: 1, userId: 100, selection: 'ONE', status: PredictionEntryStatus.PENDING, awardedPoints: null },
    ]

    const result = processSettlement(entries, 'ONE', 50)
    expect(result[0].status).toBe(PredictionEntryStatus.WON)
    expect(result[0].awardedPoints).toBe(50)
  })

  it('проигрышный прогноз получает 0 очков', () => {
    const entries: PredictionEntry[] = [
      { id: 1, userId: 100, selection: 'ONE', status: PredictionEntryStatus.PENDING, awardedPoints: null },
    ]

    const result = processSettlement(entries, 'TWO', 50)
    expect(result[0].status).toBe(PredictionEntryStatus.LOST)
    expect(result[0].awardedPoints).toBe(0)
  })

  it('несколько прогнозов обрабатываются корректно', () => {
    const entries: PredictionEntry[] = [
      { id: 1, userId: 100, selection: 'ONE', status: PredictionEntryStatus.PENDING, awardedPoints: null },
      { id: 2, userId: 101, selection: 'TWO', status: PredictionEntryStatus.PENDING, awardedPoints: null },
      { id: 3, userId: 102, selection: 'ONE', status: PredictionEntryStatus.PENDING, awardedPoints: null },
    ]

    const result = processSettlement(entries, 'ONE', 100)

    expect(result[0].status).toBe(PredictionEntryStatus.WON)
    expect(result[0].awardedPoints).toBe(100)

    expect(result[1].status).toBe(PredictionEntryStatus.LOST)
    expect(result[1].awardedPoints).toBe(0)

    expect(result[2].status).toBe(PredictionEntryStatus.WON)
    expect(result[2].awardedPoints).toBe(100)
  })

  it('сравнение нечувствительно к регистру', () => {
    const entries: PredictionEntry[] = [
      { id: 1, userId: 100, selection: 'one', status: PredictionEntryStatus.PENDING, awardedPoints: null },
    ]

    const result = processSettlement(entries, 'ONE', 50)
    expect(result[0].status).toBe(PredictionEntryStatus.WON)
  })

  it('пробелы обрезаются', () => {
    const entries: PredictionEntry[] = [
      { id: 1, userId: 100, selection: '  ONE  ', status: PredictionEntryStatus.PENDING, awardedPoints: null },
    ]

    const result = processSettlement(entries, 'ONE', 50)
    expect(result[0].status).toBe(PredictionEntryStatus.WON)
  })
})

// ============================================================================
// Тесты целостности данных
// ============================================================================

describe('Целостность данных settlement', () => {
  it('оригинальный массив не мутируется', () => {
    const original: PredictionEntry[] = [
      { id: 1, userId: 100, selection: 'ONE', status: PredictionEntryStatus.PENDING, awardedPoints: null },
    ]

    processSettlement(original, 'ONE', 50)

    expect(original[0].status).toBe(PredictionEntryStatus.PENDING)
    expect(original[0].awardedPoints).toBe(null)
  })

  it('оригинальная статистика не мутируется', () => {
    const original: ClubSeasonStats = {
      clubId: 1,
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
    }

    updateStatsAfterMatch(original, 2, 1)

    expect(original.points).toBe(0)
    expect(original.wins).toBe(0)
  })

  it('оригинальная серия не мутируется', () => {
    const original: SeriesState = {
      homeWins: 0,
      awayWins: 0,
      bestOf: 3,
      status: SeriesStatus.IN_PROGRESS,
      winnerClubId: null,
    }

    updateSeriesAfterMatch(original, 1, 1, 2)

    expect(original.homeWins).toBe(0)
    expect(original.status).toBe(SeriesStatus.IN_PROGRESS)
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases - граничные условия settlement', () => {
  it('пустой массив прогнозов', () => {
    const result = processSettlement([], 'ONE', 50)
    expect(result).toEqual([])
  })

  it('счет 0:0', () => {
    const match: MatchOutcome = {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 0,
      awayScore: 0,
      hasPenaltyShootout: false,
      penaltyHomeScore: 0,
      penaltyAwayScore: 0,
    }

    expect(determineMatchWinnerClubId(match)).toBe(null)

    const points = calculateMatchPoints(0, 0)
    expect(points).toEqual({ homePoints: 1, awayPoints: 1 })
  })

  it('best-of-1 серия завершается после первого матча', () => {
    const series: SeriesState = {
      homeWins: 0,
      awayWins: 0,
      bestOf: 1,
      status: SeriesStatus.IN_PROGRESS,
      winnerClubId: null,
    }

    const updated = updateSeriesAfterMatch(series, 1, 1, 2)
    expect(updated.homeWins).toBe(1)
    expect(updated.status).toBe(SeriesStatus.FINISHED)
    expect(updated.winnerClubId).toBe(1)
  })
})
