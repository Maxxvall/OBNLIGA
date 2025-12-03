/**
 * Тесты генерации матчей для лиг (круговая система)
 *
 * Покрывает:
 * - generateRoundRobinPairs: генерация пар матчей
 * - Проверка количества туров для N команд
 * - Валидация 1-кругового и 2-кругового форматов
 * - Обработка нечетного количества команд (bye)
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Типы
// ============================================================================

type ClubId = number

type RoundRobinPair = {
  roundIndex: number
  homeClubId: ClubId
  awayClubId: ClubId
}

// ============================================================================
// Функции генерации матчей (копии из seasonAutomation.ts)
// ============================================================================

const ensureUniqueClubs = (clubIds: ClubId[]): ClubId[] => {
  const seen = new Set<ClubId>()
  const unique: ClubId[] = []
  for (const id of clubIds) {
    if (!seen.has(id)) {
      unique.push(id)
      seen.add(id)
    }
  }
  return unique
}

const generateRoundRobinPairs = (clubIds: ClubId[], roundsPerPair: number): RoundRobinPair[] => {
  const uniqueClubs = ensureUniqueClubs(clubIds)
  if (uniqueClubs.length < 2) {
    return []
  }

  const teams = [...uniqueClubs]
  const hasBye = teams.length % 2 === 1
  if (hasBye) {
    teams.push(-1) // фиктивная команда для нечетного числа
  }

  const totalTeams = teams.length
  const rounds = totalTeams - 1
  const half = totalTeams / 2
  const rotation = teams.slice(1)
  const baseSchedule: RoundRobinPair[][] = []

  let current = [teams[0], ...rotation]

  for (let round = 0; round < rounds; round++) {
    const roundPairs: RoundRobinPair[] = []
    for (let i = 0; i < half; i++) {
      const home = current[i]
      const away = current[totalTeams - 1 - i]
      if (home === -1 || away === -1) continue
      if (round % 2 === 0) {
        roundPairs.push({ roundIndex: round, homeClubId: home, awayClubId: away })
      } else {
        roundPairs.push({ roundIndex: round, homeClubId: away, awayClubId: home })
      }
    }
    baseSchedule.push(roundPairs)

    const fixed = current[0]
    const rotating = current.slice(1)
    rotating.unshift(rotating.pop() as number)
    current = [fixed, ...rotating]
  }

  const flattened: RoundRobinPair[] = []
  for (let cycle = 0; cycle < roundsPerPair; cycle++) {
    for (let round = 0; round < baseSchedule.length; round++) {
      const roundPairs = baseSchedule[round]
      for (const pair of roundPairs) {
        if (cycle % 2 === 0) {
          flattened.push({
            roundIndex: cycle * baseSchedule.length + round,
            homeClubId: pair.homeClubId,
            awayClubId: pair.awayClubId,
          })
        } else {
          flattened.push({
            roundIndex: cycle * baseSchedule.length + round,
            homeClubId: pair.awayClubId,
            awayClubId: pair.homeClubId,
          })
        }
      }
    }
  }

  return flattened
}

// ============================================================================
// Вспомогательные функции для тестов
// ============================================================================

const countMatchesPerTeam = (pairs: RoundRobinPair[], teamId: number): number => {
  return pairs.filter(p => p.homeClubId === teamId || p.awayClubId === teamId).length
}

const countHomeMatches = (pairs: RoundRobinPair[], teamId: number): number => {
  return pairs.filter(p => p.homeClubId === teamId).length
}

const countAwayMatches = (pairs: RoundRobinPair[], teamId: number): number => {
  return pairs.filter(p => p.awayClubId === teamId).length
}

const getAllUniqueTeams = (pairs: RoundRobinPair[]): Set<number> => {
  const teams = new Set<number>()
  for (const pair of pairs) {
    teams.add(pair.homeClubId)
    teams.add(pair.awayClubId)
  }
  return teams
}

const countMatchesBetweenTeams = (
  pairs: RoundRobinPair[],
  team1: number,
  team2: number
): { total: number; team1Home: number; team2Home: number } => {
  let total = 0
  let team1Home = 0
  let team2Home = 0

  for (const pair of pairs) {
    if (
      (pair.homeClubId === team1 && pair.awayClubId === team2) ||
      (pair.homeClubId === team2 && pair.awayClubId === team1)
    ) {
      total++
      if (pair.homeClubId === team1) team1Home++
      if (pair.homeClubId === team2) team2Home++
    }
  }

  return { total, team1Home, team2Home }
}

// ============================================================================
// Тесты базовой функциональности
// ============================================================================

describe('generateRoundRobinPairs - базовая функциональность', () => {
  it('должен вернуть пустой массив для менее чем 2 команд', () => {
    expect(generateRoundRobinPairs([], 1)).toEqual([])
    expect(generateRoundRobinPairs([1], 1)).toEqual([])
  })

  it('должен сгенерировать 1 матч для 2 команд (1 круг)', () => {
    const pairs = generateRoundRobinPairs([1, 2], 1)
    expect(pairs).toHaveLength(1)
  })

  it('должен сгенерировать 2 матча для 2 команд (2 круга)', () => {
    const pairs = generateRoundRobinPairs([1, 2], 2)
    expect(pairs).toHaveLength(2)
  })

  it('должен удалять дубликаты команд', () => {
    const pairs = generateRoundRobinPairs([1, 2, 2, 3, 3, 3], 1)
    const teams = getAllUniqueTeams(pairs)
    expect(teams.size).toBe(3)
    expect(teams.has(1)).toBe(true)
    expect(teams.has(2)).toBe(true)
    expect(teams.has(3)).toBe(true)
  })
})

// ============================================================================
// Тесты для разного количества команд
// ============================================================================

describe('Количество матчей для N команд', () => {
  describe('1-круговой формат', () => {
    it('4 команды: 6 матчей (N*(N-1)/2)', () => {
      const pairs = generateRoundRobinPairs([1, 2, 3, 4], 1)
      expect(pairs).toHaveLength(6)
    })

    it('6 команд: 15 матчей', () => {
      const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5, 6], 1)
      expect(pairs).toHaveLength(15)
    })

    it('8 команд: 28 матчей', () => {
      const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5, 6, 7, 8], 1)
      expect(pairs).toHaveLength(28)
    })

    it('10 команд: 45 матчей', () => {
      const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1)
      expect(pairs).toHaveLength(45)
    })

    it('12 команд: 66 матчей', () => {
      const clubs = Array.from({ length: 12 }, (_, i) => i + 1)
      const pairs = generateRoundRobinPairs(clubs, 1)
      expect(pairs).toHaveLength(66)
    })
  })

  describe('2-круговой формат', () => {
    it('4 команды: 12 матчей (N*(N-1))', () => {
      const pairs = generateRoundRobinPairs([1, 2, 3, 4], 2)
      expect(pairs).toHaveLength(12)
    })

    it('6 команд: 30 матчей', () => {
      const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5, 6], 2)
      expect(pairs).toHaveLength(30)
    })

    it('8 команд: 56 матчей', () => {
      const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5, 6, 7, 8], 2)
      expect(pairs).toHaveLength(56)
    })
  })
})

// ============================================================================
// Тесты количества туров
// ============================================================================

describe('Количество туров', () => {
  it('для четного числа команд N: N-1 туров за круг', () => {
    // 4 команды = 3 тура
    const pairs4 = generateRoundRobinPairs([1, 2, 3, 4], 1)
    const rounds4 = new Set(pairs4.map(p => p.roundIndex))
    expect(rounds4.size).toBe(3)

    // 6 команд = 5 туров
    const pairs6 = generateRoundRobinPairs([1, 2, 3, 4, 5, 6], 1)
    const rounds6 = new Set(pairs6.map(p => p.roundIndex))
    expect(rounds6.size).toBe(5)

    // 8 команд = 7 туров
    const pairs8 = generateRoundRobinPairs([1, 2, 3, 4, 5, 6, 7, 8], 1)
    const rounds8 = new Set(pairs8.map(p => p.roundIndex))
    expect(rounds8.size).toBe(7)
  })

  it('для нечетного числа команд N: N туров за круг', () => {
    // 3 команды = 3 тура (с bye)
    const pairs3 = generateRoundRobinPairs([1, 2, 3], 1)
    const rounds3 = new Set(pairs3.map(p => p.roundIndex))
    expect(rounds3.size).toBe(3)

    // 5 команд = 5 туров
    const pairs5 = generateRoundRobinPairs([1, 2, 3, 4, 5], 1)
    const rounds5 = new Set(pairs5.map(p => p.roundIndex))
    expect(rounds5.size).toBe(5)

    // 7 команд = 7 туров
    const pairs7 = generateRoundRobinPairs([1, 2, 3, 4, 5, 6, 7], 1)
    const rounds7 = new Set(pairs7.map(p => p.roundIndex))
    expect(rounds7.size).toBe(7)
  })

  it('2 круга удваивает количество туров', () => {
    const pairs1round = generateRoundRobinPairs([1, 2, 3, 4], 1)
    const pairs2rounds = generateRoundRobinPairs([1, 2, 3, 4], 2)

    const rounds1 = new Set(pairs1round.map(p => p.roundIndex)).size
    const rounds2 = new Set(pairs2rounds.map(p => p.roundIndex)).size

    expect(rounds2).toBe(rounds1 * 2)
  })
})

// ============================================================================
// Тесты нечетного количества команд (bye)
// ============================================================================

describe('Нечетное количество команд (bye)', () => {
  it('3 команды: каждая играет 2 матча за круг', () => {
    const pairs = generateRoundRobinPairs([1, 2, 3], 1)
    expect(pairs).toHaveLength(3)

    expect(countMatchesPerTeam(pairs, 1)).toBe(2)
    expect(countMatchesPerTeam(pairs, 2)).toBe(2)
    expect(countMatchesPerTeam(pairs, 3)).toBe(2)
  })

  it('5 команд: каждая играет 4 матча за круг', () => {
    const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5], 1)
    expect(pairs).toHaveLength(10)

    for (let i = 1; i <= 5; i++) {
      expect(countMatchesPerTeam(pairs, i)).toBe(4)
    }
  })

  it('7 команд: каждая играет 6 матчей за круг', () => {
    const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5, 6, 7], 1)
    expect(pairs).toHaveLength(21)

    for (let i = 1; i <= 7; i++) {
      expect(countMatchesPerTeam(pairs, i)).toBe(6)
    }
  })

  it('не должен включать фиктивную команду -1 в матчи', () => {
    const pairs = generateRoundRobinPairs([1, 2, 3], 1)
    const teams = getAllUniqueTeams(pairs)
    expect(teams.has(-1)).toBe(false)
  })
})

// ============================================================================
// Тесты баланса домашних/гостевых матчей
// ============================================================================

describe('Баланс домашних и гостевых матчей', () => {
  it('каждая команда играет примерно поровну дома и в гостях (2 круга)', () => {
    const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5, 6], 2)

    for (let i = 1; i <= 6; i++) {
      const home = countHomeMatches(pairs, i)
      const away = countAwayMatches(pairs, i)
      expect(home).toBe(away) // в 2-круговом турнире должно быть равно
    }
  })

  it('в 2-круговом формате пары играют по разу дома и в гостях', () => {
    const pairs = generateRoundRobinPairs([1, 2, 3, 4], 2)

    // Проверяем пару команд 1 и 2
    const matchesBetween = countMatchesBetweenTeams(pairs, 1, 2)
    expect(matchesBetween.total).toBe(2)
    expect(matchesBetween.team1Home).toBe(1)
    expect(matchesBetween.team2Home).toBe(1)
  })
})

// ============================================================================
// Тесты валидации каждая команда играет с каждой
// ============================================================================

describe('Каждая команда играет с каждой', () => {
  it('в 1-круговом формате каждая пара играет 1 раз', () => {
    const teams = [1, 2, 3, 4, 5]
    const pairs = generateRoundRobinPairs(teams, 1)

    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const matches = countMatchesBetweenTeams(pairs, teams[i], teams[j])
        expect(matches.total).toBe(1)
      }
    }
  })

  it('в 2-круговом формате каждая пара играет 2 раза', () => {
    const teams = [1, 2, 3, 4, 5, 6]
    const pairs = generateRoundRobinPairs(teams, 2)

    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const matches = countMatchesBetweenTeams(pairs, teams[i], teams[j])
        expect(matches.total).toBe(2)
      }
    }
  })
})

// ============================================================================
// Тесты уникальности матчей в туре
// ============================================================================

describe('Уникальность матчей в туре', () => {
  it('команда не должна играть дважды в одном туре', () => {
    const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5, 6, 7, 8], 1)

    // Группируем по турам
    const roundsMap = new Map<number, RoundRobinPair[]>()
    for (const pair of pairs) {
      const round = roundsMap.get(pair.roundIndex) ?? []
      round.push(pair)
      roundsMap.set(pair.roundIndex, round)
    }

    // Проверяем каждый тур
    for (const [, roundPairs] of roundsMap) {
      const teamsInRound = new Set<number>()
      for (const pair of roundPairs) {
        expect(teamsInRound.has(pair.homeClubId)).toBe(false)
        expect(teamsInRound.has(pair.awayClubId)).toBe(false)
        teamsInRound.add(pair.homeClubId)
        teamsInRound.add(pair.awayClubId)
      }
    }
  })

  it('количество матчей в туре = N/2 для четного N', () => {
    const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5, 6], 1)

    const roundsMap = new Map<number, number>()
    for (const pair of pairs) {
      roundsMap.set(pair.roundIndex, (roundsMap.get(pair.roundIndex) ?? 0) + 1)
    }

    for (const count of roundsMap.values()) {
      expect(count).toBe(3) // 6 команд / 2 = 3 матча за тур
    }
  })

  it('количество матчей в туре = (N-1)/2 для нечетного N (из-за bye)', () => {
    const pairs = generateRoundRobinPairs([1, 2, 3, 4, 5], 1)

    const roundsMap = new Map<number, number>()
    for (const pair of pairs) {
      roundsMap.set(pair.roundIndex, (roundsMap.get(pair.roundIndex) ?? 0) + 1)
    }

    for (const count of roundsMap.values()) {
      expect(count).toBe(2) // 5 команд → 4 после bye → 2 матча за тур
    }
  })
})

// ============================================================================
// Специальные конфигурации
// ============================================================================

describe('Специальные конфигурации лиги', () => {
  it('12 команд (типичная конфигурация): 132 матча за 2 круга', () => {
    const clubs = Array.from({ length: 12 }, (_, i) => i + 1)
    const pairs = generateRoundRobinPairs(clubs, 2)

    expect(pairs).toHaveLength(132) // 12 * 11 = 132
  })

  it('16 команд: 240 матчей за 2 круга', () => {
    const clubs = Array.from({ length: 16 }, (_, i) => i + 1)
    const pairs = generateRoundRobinPairs(clubs, 2)

    expect(pairs).toHaveLength(240) // 16 * 15 = 240
  })

  it('20 команд (большая лига): 380 матчей за 2 круга', () => {
    const clubs = Array.from({ length: 20 }, (_, i) => i + 1)
    const pairs = generateRoundRobinPairs(clubs, 2)

    expect(pairs).toHaveLength(380) // 20 * 19 = 380
  })
})

// ============================================================================
// Формула для расчета количества матчей
// ============================================================================

describe('Математическая корректность', () => {
  const calculateExpectedMatches = (teamCount: number, rounds: number): number => {
    // Формула: N * (N - 1) / 2 * rounds
    return (teamCount * (teamCount - 1) / 2) * rounds
  }

  it.each([
    [4, 1, 6],
    [4, 2, 12],
    [6, 1, 15],
    [6, 2, 30],
    [8, 1, 28],
    [8, 2, 56],
    [10, 1, 45],
    [10, 2, 90],
  ])('%d команд, %d круг(а/ов) = %d матчей', (teamCount, rounds, expected) => {
    const clubs = Array.from({ length: teamCount }, (_, i) => i + 1)
    const pairs = generateRoundRobinPairs(clubs, rounds)
    expect(pairs).toHaveLength(expected)
    expect(calculateExpectedMatches(teamCount, rounds)).toBe(expected)
  })
})
