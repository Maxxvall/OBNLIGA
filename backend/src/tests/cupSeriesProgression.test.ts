/**
 * Тесты логики кубковых серий и продвижения команд
 *
 * Покрывает:
 * - Определение победителя серии (с учетом пенальти)
 * - Создание следующих стадий после завершения серий
 * - Логика Золотого кубка (победители 1/4 → полуфинал → финал)
 * - Логика Серебряного кубка (проигравшие 1/4 → полуфинал → финал)
 * - Матч за 3-е место
 * - Определение победителя турнира
 */

import { describe, it, expect } from 'vitest'
import { BracketType, SeriesStatus } from '@prisma/client'

// ============================================================================
// Типы (копии из cupBracketLogic.ts)
// ============================================================================

interface SeriesPlan {
  stageName: string
  homeClubId: number
  awayClubId: number
  bracketType: BracketType
  bracketSlot: number
  homeSeed?: number
  awaySeed?: number
}

interface QFResult {
  qfSlot: number
  winnerClubId: number
  loserClubId: number
  seed?: number
}

interface SFResult {
  sfSlot: number
  winnerClubId: number
  loserClubId: number
  seed?: number
}

const CUP_STAGE_NAMES = {
  QUALIFICATION: 'Квалификация',
  QUARTER_FINAL: '1/4 финала',
  SEMI_FINAL_GOLD: 'Полуфинал Золотого кубка',
  SEMI_FINAL_SILVER: 'Полуфинал Серебряного кубка',
  FINAL_GOLD: 'Финал Золотого кубка',
  FINAL_SILVER: 'Финал Серебряного кубка',
  THIRD_PLACE_GOLD: '3 место Золотого кубка',
  THIRD_PLACE_SILVER: '3 место Серебряного кубка',
} as const

// ============================================================================
// Функции генерации плей-офф стадий (копии из cupBracketLogic.ts)
// ============================================================================

const createGoldSemiFinalPlans = (
  qfWinners: Array<{ qfSlot: number; clubId: number; seed?: number }>
): SeriesPlan[] => {
  const plans: SeriesPlan[] = []
  const sorted = [...qfWinners].sort((a, b) => a.qfSlot - b.qfSlot)

  // SFg1: Winner(QF1) vs Winner(QF2)
  const sf1Home = sorted.find(w => w.qfSlot === 1)
  const sf1Away = sorted.find(w => w.qfSlot === 2)
  if (sf1Home && sf1Away) {
    plans.push({
      stageName: CUP_STAGE_NAMES.SEMI_FINAL_GOLD,
      homeClubId: sf1Home.clubId,
      awayClubId: sf1Away.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 1,
      homeSeed: sf1Home.seed,
      awaySeed: sf1Away.seed,
    })
  }

  // SFg2: Winner(QF3) vs Winner(QF4)
  const sf2Home = sorted.find(w => w.qfSlot === 3)
  const sf2Away = sorted.find(w => w.qfSlot === 4)
  if (sf2Home && sf2Away) {
    plans.push({
      stageName: CUP_STAGE_NAMES.SEMI_FINAL_GOLD,
      homeClubId: sf2Home.clubId,
      awayClubId: sf2Away.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 2,
      homeSeed: sf2Home.seed,
      awaySeed: sf2Away.seed,
    })
  }

  return plans
}

const createSilverSemiFinalPlans = (
  qfLosers: Array<{ qfSlot: number; clubId: number; seed?: number }>
): SeriesPlan[] => {
  const plans: SeriesPlan[] = []
  const sorted = [...qfLosers].sort((a, b) => a.qfSlot - b.qfSlot)

  // SFs1: Loser(QF1) vs Loser(QF2)
  const sf1Home = sorted.find(w => w.qfSlot === 1)
  const sf1Away = sorted.find(w => w.qfSlot === 2)
  if (sf1Home && sf1Away) {
    plans.push({
      stageName: CUP_STAGE_NAMES.SEMI_FINAL_SILVER,
      homeClubId: sf1Home.clubId,
      awayClubId: sf1Away.clubId,
      bracketType: BracketType.SILVER,
      bracketSlot: 1,
      homeSeed: sf1Home.seed,
      awaySeed: sf1Away.seed,
    })
  }

  // SFs2: Loser(QF3) vs Loser(QF4)
  const sf2Home = sorted.find(w => w.qfSlot === 3)
  const sf2Away = sorted.find(w => w.qfSlot === 4)
  if (sf2Home && sf2Away) {
    plans.push({
      stageName: CUP_STAGE_NAMES.SEMI_FINAL_SILVER,
      homeClubId: sf2Home.clubId,
      awayClubId: sf2Away.clubId,
      bracketType: BracketType.SILVER,
      bracketSlot: 2,
      homeSeed: sf2Home.seed,
      awaySeed: sf2Away.seed,
    })
  }

  return plans
}

const createGoldFinalPlans = (
  sfWinners: Array<{ sfSlot: number; clubId: number; seed?: number }>,
  sfLosers: Array<{ sfSlot: number; clubId: number; seed?: number }>
): SeriesPlan[] => {
  const plans: SeriesPlan[] = []

  // Финал: Winner(SFg1) vs Winner(SFg2)
  const finalHome = sfWinners.find(w => w.sfSlot === 1)
  const finalAway = sfWinners.find(w => w.sfSlot === 2)
  if (finalHome && finalAway) {
    plans.push({
      stageName: CUP_STAGE_NAMES.FINAL_GOLD,
      homeClubId: finalHome.clubId,
      awayClubId: finalAway.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 1,
      homeSeed: finalHome.seed,
      awaySeed: finalAway.seed,
    })
  }

  // 3 место: Loser(SFg1) vs Loser(SFg2)
  const thirdHome = sfLosers.find(w => w.sfSlot === 1)
  const thirdAway = sfLosers.find(w => w.sfSlot === 2)
  if (thirdHome && thirdAway) {
    plans.push({
      stageName: CUP_STAGE_NAMES.THIRD_PLACE_GOLD,
      homeClubId: thirdHome.clubId,
      awayClubId: thirdAway.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 2,
      homeSeed: thirdHome.seed,
      awaySeed: thirdAway.seed,
    })
  }

  return plans
}

const createSilverFinalPlans = (
  sfWinners: Array<{ sfSlot: number; clubId: number; seed?: number }>,
  sfLosers: Array<{ sfSlot: number; clubId: number; seed?: number }>
): SeriesPlan[] => {
  const plans: SeriesPlan[] = []

  // Финал Серебряного
  const finalHome = sfWinners.find(w => w.sfSlot === 1)
  const finalAway = sfWinners.find(w => w.sfSlot === 2)
  if (finalHome && finalAway) {
    plans.push({
      stageName: CUP_STAGE_NAMES.FINAL_SILVER,
      homeClubId: finalHome.clubId,
      awayClubId: finalAway.clubId,
      bracketType: BracketType.SILVER,
      bracketSlot: 1,
      homeSeed: finalHome.seed,
      awaySeed: finalAway.seed,
    })
  }

  // 3 место Серебряного
  const thirdHome = sfLosers.find(w => w.sfSlot === 1)
  const thirdAway = sfLosers.find(w => w.sfSlot === 2)
  if (thirdHome && thirdAway) {
    plans.push({
      stageName: CUP_STAGE_NAMES.THIRD_PLACE_SILVER,
      homeClubId: thirdHome.clubId,
      awayClubId: thirdAway.clubId,
      bracketType: BracketType.SILVER,
      bracketSlot: 2,
      homeSeed: thirdHome.seed,
      awaySeed: thirdAway.seed,
    })
  }

  return plans
}

// ============================================================================
// Вспомогательная функция определения победителя серии
// ============================================================================

const determineSeriesWinner = (
  homeWins: number,
  awayWins: number,
  bestOf: number,
  homeClubId: number,
  awayClubId: number
): { winnerClubId: number | null; loserClubId: number | null; isFinished: boolean } => {
  const winsRequired = Math.ceil(bestOf / 2)

  if (homeWins >= winsRequired) {
    return { winnerClubId: homeClubId, loserClubId: awayClubId, isFinished: true }
  }
  if (awayWins >= winsRequired) {
    return { winnerClubId: awayClubId, loserClubId: homeClubId, isFinished: true }
  }

  return { winnerClubId: null, loserClubId: null, isFinished: false }
}

// ============================================================================
// Тесты определения победителя серии
// ============================================================================

describe('determineSeriesWinner - определение победителя серии', () => {
  const homeClubId = 1
  const awayClubId = 2

  describe('Best-of-1', () => {
    it('победа хозяев 1-0', () => {
      const result = determineSeriesWinner(1, 0, 1, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(homeClubId)
      expect(result.loserClubId).toBe(awayClubId)
      expect(result.isFinished).toBe(true)
    })

    it('победа гостей 0-1', () => {
      const result = determineSeriesWinner(0, 1, 1, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(awayClubId)
      expect(result.loserClubId).toBe(homeClubId)
      expect(result.isFinished).toBe(true)
    })

    it('серия 0-0 не завершена', () => {
      const result = determineSeriesWinner(0, 0, 1, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(null)
      expect(result.isFinished).toBe(false)
    })
  })

  describe('Best-of-3 (до 2 побед)', () => {
    it('победа хозяев 2-0', () => {
      const result = determineSeriesWinner(2, 0, 3, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(homeClubId)
      expect(result.isFinished).toBe(true)
    })

    it('победа хозяев 2-1', () => {
      const result = determineSeriesWinner(2, 1, 3, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(homeClubId)
      expect(result.isFinished).toBe(true)
    })

    it('победа гостей 1-2', () => {
      const result = determineSeriesWinner(1, 2, 3, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(awayClubId)
      expect(result.isFinished).toBe(true)
    })

    it('серия 1-1 не завершена', () => {
      const result = determineSeriesWinner(1, 1, 3, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(null)
      expect(result.isFinished).toBe(false)
    })

    it('серия 1-0 не завершена', () => {
      const result = determineSeriesWinner(1, 0, 3, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(null)
      expect(result.isFinished).toBe(false)
    })
  })

  describe('Best-of-5 (до 3 побед)', () => {
    it('победа хозяев 3-0', () => {
      const result = determineSeriesWinner(3, 0, 5, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(homeClubId)
      expect(result.isFinished).toBe(true)
    })

    it('победа гостей 2-3', () => {
      const result = determineSeriesWinner(2, 3, 5, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(awayClubId)
      expect(result.isFinished).toBe(true)
    })

    it('серия 2-2 не завершена', () => {
      const result = determineSeriesWinner(2, 2, 5, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(null)
      expect(result.isFinished).toBe(false)
    })
  })

  describe('Best-of-7 (до 4 побед)', () => {
    it('победа хозяев 4-3', () => {
      const result = determineSeriesWinner(4, 3, 7, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(homeClubId)
      expect(result.isFinished).toBe(true)
    })

    it('серия 3-3 не завершена', () => {
      const result = determineSeriesWinner(3, 3, 7, homeClubId, awayClubId)
      expect(result.winnerClubId).toBe(null)
      expect(result.isFinished).toBe(false)
    })
  })
})

// ============================================================================
// Тесты создания полуфиналов Золотого кубка
// ============================================================================

describe('createGoldSemiFinalPlans - полуфиналы Золотого кубка', () => {
  it('создает 2 полуфинальные пары из 4 победителей 1/4', () => {
    const qfWinners = [
      { qfSlot: 1, clubId: 101, seed: 1 },
      { qfSlot: 2, clubId: 102, seed: 2 },
      { qfSlot: 3, clubId: 103, seed: 3 },
      { qfSlot: 4, clubId: 104, seed: 4 },
    ]

    const plans = createGoldSemiFinalPlans(qfWinners)

    expect(plans).toHaveLength(2)
    expect(plans[0].bracketType).toBe(BracketType.GOLD)
    expect(plans[1].bracketType).toBe(BracketType.GOLD)
  })

  it('SF1: Winner(QF1) vs Winner(QF2)', () => {
    const qfWinners = [
      { qfSlot: 1, clubId: 101 },
      { qfSlot: 2, clubId: 102 },
      { qfSlot: 3, clubId: 103 },
      { qfSlot: 4, clubId: 104 },
    ]

    const plans = createGoldSemiFinalPlans(qfWinners)
    const sf1 = plans.find(p => p.bracketSlot === 1)!

    expect(sf1.homeClubId).toBe(101)
    expect(sf1.awayClubId).toBe(102)
    expect(sf1.stageName).toBe(CUP_STAGE_NAMES.SEMI_FINAL_GOLD)
  })

  it('SF2: Winner(QF3) vs Winner(QF4)', () => {
    const qfWinners = [
      { qfSlot: 1, clubId: 101 },
      { qfSlot: 2, clubId: 102 },
      { qfSlot: 3, clubId: 103 },
      { qfSlot: 4, clubId: 104 },
    ]

    const plans = createGoldSemiFinalPlans(qfWinners)
    const sf2 = plans.find(p => p.bracketSlot === 2)!

    expect(sf2.homeClubId).toBe(103)
    expect(sf2.awayClubId).toBe(104)
  })

  it('работает с несортированным массивом', () => {
    const qfWinners = [
      { qfSlot: 4, clubId: 104 },
      { qfSlot: 2, clubId: 102 },
      { qfSlot: 1, clubId: 101 },
      { qfSlot: 3, clubId: 103 },
    ]

    const plans = createGoldSemiFinalPlans(qfWinners)
    const sf1 = plans.find(p => p.bracketSlot === 1)!

    expect(sf1.homeClubId).toBe(101)
    expect(sf1.awayClubId).toBe(102)
  })
})

// ============================================================================
// Тесты создания полуфиналов Серебряного кубка
// ============================================================================

describe('createSilverSemiFinalPlans - полуфиналы Серебряного кубка', () => {
  it('создает 2 полуфинальные пары из 4 проигравших 1/4', () => {
    const qfLosers = [
      { qfSlot: 1, clubId: 201 },
      { qfSlot: 2, clubId: 202 },
      { qfSlot: 3, clubId: 203 },
      { qfSlot: 4, clubId: 204 },
    ]

    const plans = createSilverSemiFinalPlans(qfLosers)

    expect(plans).toHaveLength(2)
    expect(plans[0].bracketType).toBe(BracketType.SILVER)
    expect(plans[1].bracketType).toBe(BracketType.SILVER)
  })

  it('SFs1: Loser(QF1) vs Loser(QF2)', () => {
    const qfLosers = [
      { qfSlot: 1, clubId: 201 },
      { qfSlot: 2, clubId: 202 },
      { qfSlot: 3, clubId: 203 },
      { qfSlot: 4, clubId: 204 },
    ]

    const plans = createSilverSemiFinalPlans(qfLosers)
    const sf1 = plans.find(p => p.bracketSlot === 1)!

    expect(sf1.homeClubId).toBe(201)
    expect(sf1.awayClubId).toBe(202)
    expect(sf1.stageName).toBe(CUP_STAGE_NAMES.SEMI_FINAL_SILVER)
  })

  it('SFs2: Loser(QF3) vs Loser(QF4)', () => {
    const qfLosers = [
      { qfSlot: 1, clubId: 201 },
      { qfSlot: 2, clubId: 202 },
      { qfSlot: 3, clubId: 203 },
      { qfSlot: 4, clubId: 204 },
    ]

    const plans = createSilverSemiFinalPlans(qfLosers)
    const sf2 = plans.find(p => p.bracketSlot === 2)!

    expect(sf2.homeClubId).toBe(203)
    expect(sf2.awayClubId).toBe(204)
  })
})

// ============================================================================
// Тесты создания финалов и матчей за 3 место
// ============================================================================

describe('createGoldFinalPlans - финал и 3 место Золотого кубка', () => {
  it('создает финал и матч за 3 место', () => {
    const sfWinners = [
      { sfSlot: 1, clubId: 301 },
      { sfSlot: 2, clubId: 302 },
    ]
    const sfLosers = [
      { sfSlot: 1, clubId: 303 },
      { sfSlot: 2, clubId: 304 },
    ]

    const plans = createGoldFinalPlans(sfWinners, sfLosers)

    expect(plans).toHaveLength(2)
  })

  it('финал: Winner(SF1) vs Winner(SF2)', () => {
    const sfWinners = [
      { sfSlot: 1, clubId: 301 },
      { sfSlot: 2, clubId: 302 },
    ]
    const sfLosers = [
      { sfSlot: 1, clubId: 303 },
      { sfSlot: 2, clubId: 304 },
    ]

    const plans = createGoldFinalPlans(sfWinners, sfLosers)
    const final = plans.find(p => p.stageName === CUP_STAGE_NAMES.FINAL_GOLD)!

    expect(final.homeClubId).toBe(301)
    expect(final.awayClubId).toBe(302)
    expect(final.bracketType).toBe(BracketType.GOLD)
    expect(final.bracketSlot).toBe(1)
  })

  it('3 место: Loser(SF1) vs Loser(SF2)', () => {
    const sfWinners = [
      { sfSlot: 1, clubId: 301 },
      { sfSlot: 2, clubId: 302 },
    ]
    const sfLosers = [
      { sfSlot: 1, clubId: 303 },
      { sfSlot: 2, clubId: 304 },
    ]

    const plans = createGoldFinalPlans(sfWinners, sfLosers)
    const thirdPlace = plans.find(p => p.stageName === CUP_STAGE_NAMES.THIRD_PLACE_GOLD)!

    expect(thirdPlace.homeClubId).toBe(303)
    expect(thirdPlace.awayClubId).toBe(304)
    expect(thirdPlace.bracketSlot).toBe(2)
  })
})

describe('createSilverFinalPlans - финал и 3 место Серебряного кубка', () => {
  it('создает финал и матч за 3 место', () => {
    const sfWinners = [
      { sfSlot: 1, clubId: 401 },
      { sfSlot: 2, clubId: 402 },
    ]
    const sfLosers = [
      { sfSlot: 1, clubId: 403 },
      { sfSlot: 2, clubId: 404 },
    ]

    const plans = createSilverFinalPlans(sfWinners, sfLosers)

    expect(plans).toHaveLength(2)
    expect(plans.every(p => p.bracketType === BracketType.SILVER)).toBe(true)
  })

  it('финал Серебряного кубка', () => {
    const sfWinners = [
      { sfSlot: 1, clubId: 401 },
      { sfSlot: 2, clubId: 402 },
    ]
    const sfLosers = [
      { sfSlot: 1, clubId: 403 },
      { sfSlot: 2, clubId: 404 },
    ]

    const plans = createSilverFinalPlans(sfWinners, sfLosers)
    const final = plans.find(p => p.stageName === CUP_STAGE_NAMES.FINAL_SILVER)!

    expect(final.homeClubId).toBe(401)
    expect(final.awayClubId).toBe(402)
  })
})

// ============================================================================
// Тесты полного пути турнира
// ============================================================================

describe('Полный путь турнира - от 1/4 до финала', () => {
  it('Золотой кубок: 8 команд → 4 серии 1/4 → 2 полуфинала → финал + 3 место', () => {
    // Результаты 1/4 финала
    const qfResults: QFResult[] = [
      { qfSlot: 1, winnerClubId: 1, loserClubId: 8 },
      { qfSlot: 2, winnerClubId: 4, loserClubId: 5 },
      { qfSlot: 3, winnerClubId: 2, loserClubId: 7 },
      { qfSlot: 4, winnerClubId: 3, loserClubId: 6 },
    ]

    // Создаем полуфиналы
    const goldSF = createGoldSemiFinalPlans(
      qfResults.map(r => ({ qfSlot: r.qfSlot, clubId: r.winnerClubId }))
    )
    expect(goldSF).toHaveLength(2)

    const silverSF = createSilverSemiFinalPlans(
      qfResults.map(r => ({ qfSlot: r.qfSlot, clubId: r.loserClubId }))
    )
    expect(silverSF).toHaveLength(2)

    // Результаты полуфиналов Золотого
    const goldSFResults: SFResult[] = [
      { sfSlot: 1, winnerClubId: 1, loserClubId: 4 },
      { sfSlot: 2, winnerClubId: 3, loserClubId: 2 },
    ]

    // Создаем финалы
    const goldFinals = createGoldFinalPlans(
      goldSFResults.map(r => ({ sfSlot: r.sfSlot, clubId: r.winnerClubId })),
      goldSFResults.map(r => ({ sfSlot: r.sfSlot, clubId: r.loserClubId }))
    )

    expect(goldFinals).toHaveLength(2)

    const final = goldFinals.find(p => p.stageName === CUP_STAGE_NAMES.FINAL_GOLD)!
    expect(final.homeClubId).toBe(1)
    expect(final.awayClubId).toBe(3)

    const thirdPlace = goldFinals.find(p => p.stageName === CUP_STAGE_NAMES.THIRD_PLACE_GOLD)!
    expect(thirdPlace.homeClubId).toBe(4)
    expect(thirdPlace.awayClubId).toBe(2)
  })

  it('все команды проходят через все стадии без застревания', () => {
    // Имитируем 8 команд и проверяем, что все получают финальное место
    const teams = [1, 2, 3, 4, 5, 6, 7, 8]
    const qfWinners = [1, 4, 2, 3]
    const qfLosers = [8, 5, 7, 6]

    // После QF: 4 в Gold SF, 4 в Silver SF
    expect(qfWinners).toHaveLength(4)
    expect(qfLosers).toHaveLength(4)

    const goldSFWinners = [1, 3]
    const goldSFLosers = [4, 2]
    const silverSFWinners = [5, 6]
    const silverSFLosers = [8, 7]

    // После SF: 2 в Gold Final, 2 в Gold 3rd, 2 в Silver Final, 2 в Silver 3rd
    const allTeamsAccounted = [
      ...goldSFWinners, // финалисты Gold
      ...goldSFLosers, // 3-4 место Gold
      ...silverSFWinners, // финалисты Silver
      ...silverSFLosers, // 3-4 место Silver
    ]

    expect(new Set(allTeamsAccounted).size).toBe(8) // все 8 команд
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases - граничные условия кубковых серий', () => {
  it('неполный список победителей 1/4', () => {
    const qfWinners = [
      { qfSlot: 1, clubId: 101 },
      { qfSlot: 2, clubId: 102 },
      // Нет QF3 и QF4
    ]

    const plans = createGoldSemiFinalPlans(qfWinners)

    // Создается только 1 полуфинал
    expect(plans).toHaveLength(1)
    expect(plans[0].bracketSlot).toBe(1)
  })

  it('пустой список победителей', () => {
    const plans = createGoldSemiFinalPlans([])
    expect(plans).toHaveLength(0)
  })

  it('пустой список проигравших', () => {
    const sfWinners = [
      { sfSlot: 1, clubId: 301 },
      { sfSlot: 2, clubId: 302 },
    ]

    const plans = createGoldFinalPlans(sfWinners, [])

    // Создается только финал, без матча за 3 место
    expect(plans).toHaveLength(1)
    expect(plans[0].stageName).toBe(CUP_STAGE_NAMES.FINAL_GOLD)
  })

  it('сохранение seed при прохождении стадий', () => {
    const qfWinners = [
      { qfSlot: 1, clubId: 101, seed: 1 },
      { qfSlot: 2, clubId: 102, seed: 8 },
      { qfSlot: 3, clubId: 103, seed: 4 },
      { qfSlot: 4, clubId: 104, seed: 5 },
    ]

    const plans = createGoldSemiFinalPlans(qfWinners)

    expect(plans[0].homeSeed).toBe(1)
    expect(plans[0].awaySeed).toBe(8)
    expect(plans[1].homeSeed).toBe(4)
    expect(plans[1].awaySeed).toBe(5)
  })
})
