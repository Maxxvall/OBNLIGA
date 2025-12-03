/**
 * Тесты плей-офф серий с произвольным количеством команд
 *
 * Покрывает:
 * - createInitialPlayoffPlans: генерация плей-офф с посевами
 * - createRandomPlayoffPlans: генерация плей-офф без посевов
 * - Обработка bye (автоматический проход)
 * - Серии "до N побед" (best-of-3, best-of-5, best-of-7)
 * - Определение названий стадий
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Типы (копии из seasonAutomation.ts)
// ============================================================================

type PlayoffSeriesPlan = {
  stageName: string
  homeClubId: number
  awayClubId: number
  homeSeed: number
  awaySeed: number
  targetSlot: number
  matchDateTimes: Date[]
}

type PlayoffByePlan = {
  clubId: number
  seed: number
  targetSlot: number
}

type InitialPlayoffPlanResult = {
  plans: PlayoffSeriesPlan[]
  byeSeries: PlayoffByePlan[]
}

// ============================================================================
// Функции генерации плей-офф (копии из seasonAutomation.ts)
// ============================================================================

const stageNameForTeams = (teamCount: number): string => {
  if (teamCount <= 2) return 'Финал'
  if (teamCount <= 4) return 'Полуфинал'
  if (teamCount <= 8) return 'Четвертьфинал'
  if (teamCount <= 16) return '1/8 финала'
  if (teamCount <= 32) return '1/16 финала'
  return `Плей-офф (${teamCount} команд)`
}

const generateSeedOrder = (size: number): number[] => {
  if (size <= 1) return [1]
  const previous = generateSeedOrder(Math.floor(size / 2))
  const result: number[] = []
  for (const seed of previous) {
    result.push(seed)
    result.push(size + 1 - seed)
  }
  return result
}

const highestPowerOfTwo = (value: number): number => {
  let power = 1
  while (power * 2 <= value) {
    power *= 2
  }
  return power
}

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

const createInitialPlayoffPlans = (
  seeds: number[],
  startDate: Date,
  matchTime: string | null | undefined,
  bestOfLength: number
): InitialPlayoffPlanResult => {
  if (seeds.length < 2) {
    return { plans: [], byeSeries: [] }
  }

  const seededClubs = seeds.map((clubId, index) => ({ clubId, seed: index + 1 }))
  const totalSeeds = seededClubs.length
  const bracketSize = highestPowerOfTwo(totalSeeds)
  const requiresPlayIn = totalSeeds !== bracketSize
  const playInMatches = requiresPlayIn ? totalSeeds - bracketSize : 0
  const byeCount = requiresPlayIn ? bracketSize - playInMatches : 0

  const seedOrder = generateSeedOrder(Math.max(bracketSize, 2))
  const seedToSlot = new Map<number, number>()
  seedOrder.forEach((seedNumber, index) => {
    seedToSlot.set(seedNumber, index + 1)
  })

  const pairingEntries = requiresPlayIn ? seededClubs.slice(byeCount) : seededClubs
  const byeSeries = requiresPlayIn
    ? seededClubs.slice(0, byeCount).map(entry => ({
        clubId: entry.clubId,
        seed: entry.seed,
        targetSlot: seedToSlot.get(entry.seed) ?? entry.seed,
      }))
    : []

  const stageName = stageNameForTeams(totalSeeds)
  const plans: PlayoffSeriesPlan[] = []

  if (pairingEntries.length >= 2) {
    let left = 0
    let right = pairingEntries.length - 1
    let slotIndex = 0

    while (left < right) {
      const leftEntry = pairingEntries[left]
      const rightEntry = pairingEntries[right]
      const slotA = seedToSlot.get(leftEntry.seed)
      const slotB = seedToSlot.get(rightEntry.seed)
      const targetSlot =
        slotA && slotB ? Math.min(slotA, slotB) : (slotA ?? slotB ?? leftEntry.seed)

      const homeEntry = leftEntry.seed <= rightEntry.seed ? leftEntry : rightEntry
      const awayEntry = homeEntry === leftEntry ? rightEntry : leftEntry

      const seriesBaseDate = addDays(startDate, slotIndex * 2)
      const matchDates: Date[] = []
      for (let game = 0; game < bestOfLength; game++) {
        const scheduled = addDays(seriesBaseDate, game * 3)
        matchDates.push(scheduled)
      }

      plans.push({
        stageName,
        homeClubId: homeEntry.clubId,
        awayClubId: awayEntry.clubId,
        homeSeed: homeEntry.seed,
        awaySeed: awayEntry.seed,
        targetSlot,
        matchDateTimes: matchDates,
      })

      left += 1
      right -= 1
      slotIndex += 1
    }
  }

  return { plans, byeSeries }
}

const shuffleNumbers = (values: number[]): number[] => {
  const arr = [...values]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

const createRandomPlayoffPlans = (
  clubIds: number[],
  startDate: Date,
  matchTime: string | null | undefined,
  bestOfLength = 1,
  options?: { shuffle?: boolean }
): InitialPlayoffPlanResult => {
  if (clubIds.length < 2) {
    const byeSeries = clubIds[0]
      ? [{ clubId: clubIds[0], seed: 1, targetSlot: 1 }]
      : []
    return { plans: [], byeSeries }
  }

  const shouldShuffle = options?.shuffle !== false
  const ordered = shouldShuffle ? shuffleNumbers(clubIds) : [...clubIds]
  const hasBye = ordered.length % 2 === 1
  const stageTeamsCount = hasBye ? ordered.length - 1 : ordered.length

  const plans: PlayoffSeriesPlan[] = []

  if (stageTeamsCount >= 2) {
    const stageName = stageNameForTeams(stageTeamsCount)

    for (let index = 0; index < stageTeamsCount; index += 2) {
      const homeClubId = ordered[index]
      const awayClubId = ordered[index + 1]
      const slotA = index + 1
      const slotB = index + 2
      const targetSlot = Math.min(slotA, slotB)

      const seriesBaseDate = addDays(startDate, Math.floor(index / 2) * 2)
      const matchDates: Date[] = []
      for (let game = 0; game < bestOfLength; game += 1) {
        const scheduled = addDays(seriesBaseDate, game * 3)
        matchDates.push(scheduled)
      }

      const homeSeed = index + 1
      const awaySeed = index + 2

      plans.push({
        stageName,
        homeClubId,
        awayClubId,
        homeSeed,
        awaySeed,
        targetSlot,
        matchDateTimes: matchDates,
      })
    }
  }

  const byeSeries = hasBye
    ? [{ clubId: ordered[ordered.length - 1], seed: stageTeamsCount + 1, targetSlot: stageTeamsCount + 1 }]
    : []

  return { plans, byeSeries }
}

// ============================================================================
// Тесты stageNameForTeams
// ============================================================================

describe('stageNameForTeams - определение названия стадии', () => {
  it('2 команды → Финал', () => {
    expect(stageNameForTeams(2)).toBe('Финал')
  })

  it('3-4 команды → Полуфинал', () => {
    expect(stageNameForTeams(3)).toBe('Полуфинал')
    expect(stageNameForTeams(4)).toBe('Полуфинал')
  })

  it('5-8 команд → Четвертьфинал', () => {
    expect(stageNameForTeams(5)).toBe('Четвертьфинал')
    expect(stageNameForTeams(6)).toBe('Четвертьфинал')
    expect(stageNameForTeams(7)).toBe('Четвертьфинал')
    expect(stageNameForTeams(8)).toBe('Четвертьфинал')
  })

  it('9-16 команд → 1/8 финала', () => {
    expect(stageNameForTeams(9)).toBe('1/8 финала')
    expect(stageNameForTeams(12)).toBe('1/8 финала')
    expect(stageNameForTeams(16)).toBe('1/8 финала')
  })

  it('17-32 команды → 1/16 финала', () => {
    expect(stageNameForTeams(17)).toBe('1/16 финала')
    expect(stageNameForTeams(24)).toBe('1/16 финала')
    expect(stageNameForTeams(32)).toBe('1/16 финала')
  })

  it('33+ команды → Плей-офф (N команд)', () => {
    expect(stageNameForTeams(33)).toBe('Плей-офф (33 команд)')
    expect(stageNameForTeams(64)).toBe('Плей-офф (64 команд)')
  })
})

// ============================================================================
// Тесты generateSeedOrder
// ============================================================================

describe('generateSeedOrder - генерация порядка посевов', () => {
  it('размер 1 → [1]', () => {
    expect(generateSeedOrder(1)).toEqual([1])
  })

  it('размер 2 → [1, 2]', () => {
    expect(generateSeedOrder(2)).toEqual([1, 2])
  })

  it('размер 4 → [1, 4, 2, 3] — классическая расстановка', () => {
    expect(generateSeedOrder(4)).toEqual([1, 4, 2, 3])
  })

  it('размер 8 → правильная расстановка для 8 команд', () => {
    const order = generateSeedOrder(8)
    expect(order).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
  })

  it('1-й посев играет с N-м посевом', () => {
    const order = generateSeedOrder(8)
    // В первом раунде 1 vs 8
    expect(order[0]).toBe(1)
    expect(order[1]).toBe(8)
  })

  it('2-й посев играет с (N-1)-м посевом', () => {
    const order = generateSeedOrder(8)
    // 2 vs 7 (в 5 и 6 позициях)
    expect(order[4]).toBe(2)
    expect(order[5]).toBe(7)
  })
})

// ============================================================================
// Тесты highestPowerOfTwo
// ============================================================================

describe('highestPowerOfTwo - наибольшая степень двойки', () => {
  it('1 → 1', () => expect(highestPowerOfTwo(1)).toBe(1))
  it('2 → 2', () => expect(highestPowerOfTwo(2)).toBe(2))
  it('3 → 2', () => expect(highestPowerOfTwo(3)).toBe(2))
  it('4 → 4', () => expect(highestPowerOfTwo(4)).toBe(4))
  it('5 → 4', () => expect(highestPowerOfTwo(5)).toBe(4))
  it('6 → 4', () => expect(highestPowerOfTwo(6)).toBe(4))
  it('7 → 4', () => expect(highestPowerOfTwo(7)).toBe(4))
  it('8 → 8', () => expect(highestPowerOfTwo(8)).toBe(8))
  it('9 → 8', () => expect(highestPowerOfTwo(9)).toBe(8))
  it('12 → 8', () => expect(highestPowerOfTwo(12)).toBe(8))
  it('16 → 16', () => expect(highestPowerOfTwo(16)).toBe(16))
  it('20 → 16', () => expect(highestPowerOfTwo(20)).toBe(16))
})

// ============================================================================
// Тесты createInitialPlayoffPlans - посев
// ============================================================================

describe('createInitialPlayoffPlans - плей-офф с посевами', () => {
  const startDate = new Date('2024-01-01T12:00:00Z')

  it('менее 2 команд → пустой результат', () => {
    expect(createInitialPlayoffPlans([], startDate, null, 1)).toEqual({
      plans: [],
      byeSeries: [],
    })
    expect(createInitialPlayoffPlans([1], startDate, null, 1)).toEqual({
      plans: [],
      byeSeries: [],
    })
  })

  it('2 команды → 1 серия (финал)', () => {
    const result = createInitialPlayoffPlans([1, 2], startDate, null, 1)
    expect(result.plans).toHaveLength(1)
    expect(result.byeSeries).toHaveLength(0)
    expect(result.plans[0].stageName).toBe('Финал')
  })

  it('4 команды → 2 серии (полуфинал)', () => {
    const result = createInitialPlayoffPlans([1, 2, 3, 4], startDate, null, 1)
    expect(result.plans).toHaveLength(2)
    expect(result.byeSeries).toHaveLength(0)
    expect(result.plans[0].stageName).toBe('Полуфинал')
  })

  it('8 команд → 4 серии (четвертьфинал)', () => {
    const result = createInitialPlayoffPlans([1, 2, 3, 4, 5, 6, 7, 8], startDate, null, 1)
    expect(result.plans).toHaveLength(4)
    expect(result.byeSeries).toHaveLength(0)
    expect(result.plans[0].stageName).toBe('Четвертьфинал')
  })

  it('хозяин имеет лучший (меньший) посев', () => {
    const result = createInitialPlayoffPlans([10, 20, 30, 40], startDate, null, 1)

    for (const plan of result.plans) {
      expect(plan.homeSeed).toBeLessThan(plan.awaySeed)
    }
  })
})

// ============================================================================
// Тесты bye (автоматический проход)
// ============================================================================

describe('Bye - автоматический проход в следующий раунд', () => {
  const startDate = new Date('2024-01-01T12:00:00Z')

  it('3 команды → 1 bye + 1 серия', () => {
    const result = createInitialPlayoffPlans([1, 2, 3], startDate, null, 1)
    expect(result.byeSeries).toHaveLength(1)
    expect(result.plans).toHaveLength(1)
    // Лучший посев получает bye
    expect(result.byeSeries[0].seed).toBe(1)
  })

  it('5 команд → 3 bye + 1 серия', () => {
    const result = createInitialPlayoffPlans([1, 2, 3, 4, 5], startDate, null, 1)
    // bracketSize = 4, playInMatches = 5 - 4 = 1, byeCount = 4 - 1 = 3
    expect(result.byeSeries).toHaveLength(3)
    expect(result.plans).toHaveLength(1)
  })

  it('6 команд → 2 bye + 2 серии', () => {
    const result = createInitialPlayoffPlans([1, 2, 3, 4, 5, 6], startDate, null, 1)
    // bracketSize = 4, playInMatches = 6 - 4 = 2, byeCount = 4 - 2 = 2
    expect(result.byeSeries).toHaveLength(2)
    expect(result.plans).toHaveLength(2)
  })

  it('7 команд → 1 bye + 3 серии', () => {
    const result = createInitialPlayoffPlans([1, 2, 3, 4, 5, 6, 7], startDate, null, 1)
    // bracketSize = 4, playInMatches = 7 - 4 = 3, byeCount = 4 - 3 = 1
    expect(result.byeSeries).toHaveLength(1)
    expect(result.plans).toHaveLength(3)
  })

  it('степень двойки → 0 bye', () => {
    const result4 = createInitialPlayoffPlans([1, 2, 3, 4], startDate, null, 1)
    expect(result4.byeSeries).toHaveLength(0)

    const result8 = createInitialPlayoffPlans([1, 2, 3, 4, 5, 6, 7, 8], startDate, null, 1)
    expect(result8.byeSeries).toHaveLength(0)
  })

  it('топ-посевы получают bye', () => {
    const result = createInitialPlayoffPlans([1, 2, 3, 4, 5], startDate, null, 1)
    const byeSeeds = result.byeSeries.map(b => b.seed).sort((a, b) => a - b)
    // Посевы 1, 2, 3 получают bye
    expect(byeSeeds).toEqual([1, 2, 3])
  })
})

// ============================================================================
// Тесты серий до N побед
// ============================================================================

describe('Серии до N побед (best-of)', () => {
  const startDate = new Date('2024-01-01T12:00:00Z')

  it('best-of-1: 1 матч в серии', () => {
    const result = createInitialPlayoffPlans([1, 2], startDate, null, 1)
    expect(result.plans[0].matchDateTimes).toHaveLength(1)
  })

  it('best-of-3: 3 матча в серии', () => {
    const result = createInitialPlayoffPlans([1, 2], startDate, null, 3)
    expect(result.plans[0].matchDateTimes).toHaveLength(3)
  })

  it('best-of-5: 5 матчей в серии', () => {
    const result = createInitialPlayoffPlans([1, 2], startDate, null, 5)
    expect(result.plans[0].matchDateTimes).toHaveLength(5)
  })

  it('best-of-7: 7 матчей в серии', () => {
    const result = createInitialPlayoffPlans([1, 2], startDate, null, 7)
    expect(result.plans[0].matchDateTimes).toHaveLength(7)
  })

  it('матчи серии разнесены по времени', () => {
    const result = createInitialPlayoffPlans([1, 2], startDate, null, 3)
    const dates = result.plans[0].matchDateTimes

    // Каждый следующий матч на 3 дня позже
    for (let i = 1; i < dates.length; i++) {
      const diff = dates[i].getTime() - dates[i - 1].getTime()
      const days = diff / (1000 * 60 * 60 * 24)
      expect(days).toBe(3)
    }
  })
})

// ============================================================================
// Тесты createRandomPlayoffPlans
// ============================================================================

describe('createRandomPlayoffPlans - плей-офф без посевов', () => {
  const startDate = new Date('2024-01-01T12:00:00Z')

  it('менее 2 команд → только bye', () => {
    const result1 = createRandomPlayoffPlans([1], startDate, null, 1)
    expect(result1.plans).toHaveLength(0)
    expect(result1.byeSeries).toHaveLength(1)

    const result0 = createRandomPlayoffPlans([], startDate, null, 1)
    expect(result0.plans).toHaveLength(0)
    expect(result0.byeSeries).toHaveLength(0)
  })

  it('4 команды без перемешивания → 2 серии', () => {
    const result = createRandomPlayoffPlans([1, 2, 3, 4], startDate, null, 1, { shuffle: false })
    expect(result.plans).toHaveLength(2)
    expect(result.byeSeries).toHaveLength(0)

    // Без перемешивания: 1 vs 2, 3 vs 4
    expect(result.plans[0].homeClubId).toBe(1)
    expect(result.plans[0].awayClubId).toBe(2)
    expect(result.plans[1].homeClubId).toBe(3)
    expect(result.plans[1].awayClubId).toBe(4)
  })

  it('нечетное количество команд → 1 bye', () => {
    const result = createRandomPlayoffPlans([1, 2, 3], startDate, null, 1, { shuffle: false })
    expect(result.plans).toHaveLength(1)
    expect(result.byeSeries).toHaveLength(1)
  })

  it('5 команд → 2 серии + 1 bye', () => {
    const result = createRandomPlayoffPlans([1, 2, 3, 4, 5], startDate, null, 1, { shuffle: false })
    expect(result.plans).toHaveLength(2)
    expect(result.byeSeries).toHaveLength(1)
    // Последняя команда получает bye
    expect(result.byeSeries[0].clubId).toBe(5)
  })

  it('перемешивание включено по умолчанию', () => {
    // Запускаем несколько раз и проверяем, что порядок отличается
    const results: number[][] = []
    for (let i = 0; i < 10; i++) {
      const result = createRandomPlayoffPlans([1, 2, 3, 4], startDate, null, 1)
      results.push(result.plans.map(p => p.homeClubId))
    }

    // Маловероятно, что все 10 результатов одинаковы
    const uniqueOrders = new Set(results.map(r => r.join(',')))
    // С 4 командами есть ограниченное число перестановок, но хотя бы 2 разных порядка
    expect(uniqueOrders.size).toBeGreaterThan(1)
  })
})

// ============================================================================
// Тесты общего количества серий
// ============================================================================

describe('Общее количество серий в плей-офф', () => {
  const startDate = new Date('2024-01-01T12:00:00Z')

  it.each([
    [2, 1, 0],
    [3, 1, 1],
    [4, 2, 0],
    [5, 1, 3],
    [6, 2, 2],
    [7, 3, 1],
    [8, 4, 0],
  ])('%d команд → %d серий + %d bye', (teamCount, expectedSeries, expectedBye) => {
    const clubs = Array.from({ length: teamCount }, (_, i) => i + 1)
    const result = createInitialPlayoffPlans(clubs, startDate, null, 1)
    expect(result.plans).toHaveLength(expectedSeries)
    expect(result.byeSeries).toHaveLength(expectedBye)
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases - граничные условия плей-офф', () => {
  const startDate = new Date('2024-01-01T12:00:00Z')

  it('большое количество команд (16)', () => {
    const clubs = Array.from({ length: 16 }, (_, i) => i + 1)
    const result = createInitialPlayoffPlans(clubs, startDate, null, 1)
    expect(result.plans).toHaveLength(8)
    expect(result.byeSeries).toHaveLength(0)
    expect(result.plans[0].stageName).toBe('1/8 финала')
  })

  it('большое количество команд (32)', () => {
    const clubs = Array.from({ length: 32 }, (_, i) => i + 1)
    const result = createInitialPlayoffPlans(clubs, startDate, null, 1)
    expect(result.plans).toHaveLength(16)
    expect(result.byeSeries).toHaveLength(0)
    expect(result.plans[0].stageName).toBe('1/16 финала')
  })

  it('дубликаты clubId обрабатываются корректно', () => {
    // Функция принимает массив как есть, дубликаты не удаляются
    const result = createRandomPlayoffPlans([1, 1, 2, 2], startDate, null, 1, { shuffle: false })
    expect(result.plans).toHaveLength(2)
  })

  it('targetSlot всегда положительный', () => {
    const result = createInitialPlayoffPlans([1, 2, 3, 4, 5, 6, 7, 8], startDate, null, 1)
    for (const plan of result.plans) {
      expect(plan.targetSlot).toBeGreaterThan(0)
    }
    for (const bye of result.byeSeries) {
      expect(bye.targetSlot).toBeGreaterThan(0)
    }
  })
})
