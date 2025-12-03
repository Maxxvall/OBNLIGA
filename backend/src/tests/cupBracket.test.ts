/**
 * Тесты кубковой системы - групповой этап и плей-офф
 *
 * Покрывает:
 * - validateCupConfiguration: валидация конфигурации кубка
 * - getCupPlayoffStructure: определение структуры плей-офф
 * - generateQualificationPairs4x3: генерация квалификационных пар
 * - generateQuarterFinalPairs: генерация 1/4 финала
 * - Различные конфигурации: 4x3, 2x4, 3x3, 2x5
 */

import { describe, it, expect } from 'vitest'
import { BracketType } from '@prisma/client'

// ============================================================================
// Типы (копии из cupBracketLogic.ts)
// ============================================================================

interface CupBracketConfig {
  groupCount: number
  groupSize: number
  groupRounds: number
  playoffBestOf: number
}

interface GroupStandingEntry {
  clubId: number
  groupIndex: number
  groupLabel: string
  placement: number
  points: number
  goalDiff: number
  goalsFor: number
  goalsAgainst: number
  wins: number
  draws: number
  losses: number
}

interface SeriesPlan {
  stageName: string
  homeClubId: number
  awayClubId: number
  bracketType: BracketType
  bracketSlot: number
  homeSeed?: number
  awaySeed?: number
}

interface PlayoffTeamEntry {
  clubId: number
  groupIndex: number
  placement: number
  seed: number
  bracketSlot: number
}

interface QualificationPair {
  home: PlayoffTeamEntry
  away: PlayoffTeamEntry
  pairId: string
  slot: number
}

// ============================================================================
// Функции валидации (копии из cupBracketLogic.ts)
// ============================================================================

const VALID_CUP_CONFIGS = [
  { groupCount: 2, groupSize: 3 },
  { groupCount: 2, groupSize: 4 },
  { groupCount: 2, groupSize: 5 },
  { groupCount: 3, groupSize: 3 },
  { groupCount: 3, groupSize: 4 },
  { groupCount: 4, groupSize: 3 },
] as const

const validateCupConfiguration = (
  config: CupBracketConfig
): { valid: boolean; error?: string } => {
  const { groupCount, groupSize, groupRounds, playoffBestOf } = config

  if (groupCount < 2 || groupCount > 4) {
    return { valid: false, error: 'cup_invalid_group_count' }
  }

  if (groupSize < 3 || groupSize > 5) {
    return { valid: false, error: 'cup_invalid_group_size' }
  }

  if (groupRounds < 1 || groupRounds > 2) {
    return { valid: false, error: 'cup_invalid_group_rounds' }
  }

  const validBestOf = [1, 3, 5, 7]
  if (!validBestOf.includes(playoffBestOf)) {
    return { valid: false, error: 'cup_invalid_playoff_format' }
  }

  const isValidCombo = VALID_CUP_CONFIGS.some(
    combo => combo.groupCount === groupCount && combo.groupSize === groupSize
  )

  if (!isValidCombo) {
    if (groupCount === 2 && (groupSize < 3 || groupSize > 5)) {
      return { valid: false, error: 'cup_2_groups_need_3_to_5_teams' }
    }
    if (groupCount === 3 && (groupSize < 3 || groupSize > 4)) {
      return { valid: false, error: 'cup_3_groups_need_3_or_4_teams' }
    }
    if (groupCount === 4 && groupSize !== 3) {
      return { valid: false, error: 'cup_4_groups_need_3_teams' }
    }
    return { valid: false, error: 'cup_invalid_configuration' }
  }

  return { valid: true }
}

const getCupPlayoffStructure = (
  groupCount: number,
  groupSize: number
): {
  totalTeams: number
  playoffTeams: number
  hasQualification: boolean
  qualificationPairs: number
  quarterFinalPairs: number
} => {
  const totalTeams = groupCount * groupSize

  // 4 группы по 3 команды — эталонная система с квалификацией
  if (groupCount === 4 && groupSize === 3) {
    return {
      totalTeams: 12,
      playoffTeams: 12,
      hasQualification: true,
      qualificationPairs: 4,
      quarterFinalPairs: 4,
    }
  }

  // 2 группы по 5 команд
  if (groupCount === 2 && groupSize === 5) {
    return {
      totalTeams: 10,
      playoffTeams: 8,
      hasQualification: false,
      qualificationPairs: 0,
      quarterFinalPairs: 4,
    }
  }

  // 2 группы по 4 команды
  if (groupCount === 2 && groupSize === 4) {
    return {
      totalTeams: 8,
      playoffTeams: 8,
      hasQualification: false,
      qualificationPairs: 0,
      quarterFinalPairs: 4,
    }
  }

  // 3 группы по 4 команды
  if (groupCount === 3 && groupSize === 4) {
    return {
      totalTeams: 12,
      playoffTeams: 8,
      hasQualification: false,
      qualificationPairs: 0,
      quarterFinalPairs: 4,
    }
  }

  // 3 группы по 3 команды
  if (groupCount === 3 && groupSize === 3) {
    return {
      totalTeams: 9,
      playoffTeams: 8,
      hasQualification: false,
      qualificationPairs: 0,
      quarterFinalPairs: 4,
    }
  }

  // 2 группы по 3 команды — полуфинал
  if (groupCount === 2 && groupSize === 3) {
    return {
      totalTeams: 6,
      playoffTeams: 4,
      hasQualification: false,
      qualificationPairs: 0,
      quarterFinalPairs: 0,
    }
  }

  // По умолчанию
  return {
    totalTeams,
    playoffTeams: Math.min(8, totalTeams),
    hasQualification: false,
    qualificationPairs: 0,
    quarterFinalPairs: 4,
  }
}

// ============================================================================
// Функции генерации пар (копии из cupBracketLogic.ts)
// ============================================================================

const generateQualificationPairs4x3 = (
  standings: GroupStandingEntry[]
): QualificationPair[] => {
  const byGroup = new Map<number, GroupStandingEntry[]>()
  for (const entry of standings) {
    const group = byGroup.get(entry.groupIndex) ?? []
    group.push(entry)
    byGroup.set(entry.groupIndex, group)
  }

  for (const [, entries] of byGroup) {
    entries.sort((a, b) => a.placement - b.placement)
  }

  const getTeam = (groupIndex: number, placement: number): PlayoffTeamEntry | null => {
    const group = byGroup.get(groupIndex)
    if (!group) return null
    const entry = group.find(e => e.placement === placement)
    if (!entry) return null
    return {
      clubId: entry.clubId,
      groupIndex: entry.groupIndex,
      placement: entry.placement,
      seed: groupIndex * 10 + placement,
      bracketSlot: groupIndex * 2 + placement,
    }
  }

  const pairs: QualificationPair[] = []

  // H: C2 vs B3
  const C2 = getTeam(3, 2)
  const B3 = getTeam(2, 3)
  if (C2 && B3) {
    pairs.push({ home: C2, away: B3, pairId: 'H', slot: 1 })
  }

  // I: B2 vs C3
  const B2 = getTeam(2, 2)
  const C3 = getTeam(3, 3)
  if (B2 && C3) {
    pairs.push({ home: B2, away: C3, pairId: 'I', slot: 2 })
  }

  // G: D2 vs A3
  const D2 = getTeam(4, 2)
  const A3 = getTeam(1, 3)
  if (D2 && A3) {
    pairs.push({ home: D2, away: A3, pairId: 'G', slot: 3 })
  }

  // F: A2 vs D3
  const A2 = getTeam(1, 2)
  const D3 = getTeam(4, 3)
  if (A2 && D3) {
    pairs.push({ home: A2, away: D3, pairId: 'F', slot: 4 })
  }

  return pairs
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
// Тесты валидации конфигурации
// ============================================================================

describe('validateCupConfiguration - валидация конфигурации кубка', () => {
  describe('Допустимые конфигурации', () => {
    it('4 группы по 3 команды (эталон) - valid', () => {
      const result = validateCupConfiguration({
        groupCount: 4,
        groupSize: 3,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(true)
    })

    it('2 группы по 4 команды - valid', () => {
      const result = validateCupConfiguration({
        groupCount: 2,
        groupSize: 4,
        groupRounds: 2,
        playoffBestOf: 3,
      })
      expect(result.valid).toBe(true)
    })

    it('2 группы по 5 команд - valid', () => {
      const result = validateCupConfiguration({
        groupCount: 2,
        groupSize: 5,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(true)
    })

    it('3 группы по 3 команды - valid', () => {
      const result = validateCupConfiguration({
        groupCount: 3,
        groupSize: 3,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(true)
    })

    it('3 группы по 4 команды - valid', () => {
      const result = validateCupConfiguration({
        groupCount: 3,
        groupSize: 4,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(true)
    })

    it('2 группы по 3 команды - valid', () => {
      const result = validateCupConfiguration({
        groupCount: 2,
        groupSize: 3,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('Недопустимые конфигурации', () => {
    it('1 группа - invalid', () => {
      const result = validateCupConfiguration({
        groupCount: 1,
        groupSize: 4,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('cup_invalid_group_count')
    })

    it('5+ групп - invalid', () => {
      const result = validateCupConfiguration({
        groupCount: 5,
        groupSize: 3,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('cup_invalid_group_count')
    })

    it('размер группы 2 - invalid', () => {
      const result = validateCupConfiguration({
        groupCount: 4,
        groupSize: 2,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('cup_invalid_group_size')
    })

    it('размер группы 6+ - invalid', () => {
      const result = validateCupConfiguration({
        groupCount: 2,
        groupSize: 6,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('cup_invalid_group_size')
    })

    it('0 кругов - invalid', () => {
      const result = validateCupConfiguration({
        groupCount: 4,
        groupSize: 3,
        groupRounds: 0,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('cup_invalid_group_rounds')
    })

    it('3+ кругов - invalid', () => {
      const result = validateCupConfiguration({
        groupCount: 4,
        groupSize: 3,
        groupRounds: 3,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('cup_invalid_group_rounds')
    })

    it('bestOf 2 - invalid', () => {
      const result = validateCupConfiguration({
        groupCount: 4,
        groupSize: 3,
        groupRounds: 1,
        playoffBestOf: 2,
      })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('cup_invalid_playoff_format')
    })

    it('4 группы по 4 команды - invalid', () => {
      const result = validateCupConfiguration({
        groupCount: 4,
        groupSize: 4,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('cup_4_groups_need_3_teams')
    })

    it('3 группы по 5 команд - invalid', () => {
      const result = validateCupConfiguration({
        groupCount: 3,
        groupSize: 5,
        groupRounds: 1,
        playoffBestOf: 1,
      })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('cup_3_groups_need_3_or_4_teams')
    })
  })

  describe('Допустимые форматы плей-офф', () => {
    it.each([1, 3, 5, 7])('bestOf %d - valid', bestOf => {
      const result = validateCupConfiguration({
        groupCount: 4,
        groupSize: 3,
        groupRounds: 1,
        playoffBestOf: bestOf,
      })
      expect(result.valid).toBe(true)
    })
  })
})

// ============================================================================
// Тесты структуры плей-офф
// ============================================================================

describe('getCupPlayoffStructure - определение структуры плей-офф', () => {
  describe('4x3 - эталонная система', () => {
    it('12 команд, квалификация, 4 пары 1/4', () => {
      const structure = getCupPlayoffStructure(4, 3)
      expect(structure.totalTeams).toBe(12)
      expect(structure.playoffTeams).toBe(12)
      expect(structure.hasQualification).toBe(true)
      expect(structure.qualificationPairs).toBe(4)
      expect(structure.quarterFinalPairs).toBe(4)
    })
  })

  describe('2x4 - 8 команд', () => {
    it('8 команд, без квалификации, сразу 1/4', () => {
      const structure = getCupPlayoffStructure(2, 4)
      expect(structure.totalTeams).toBe(8)
      expect(structure.playoffTeams).toBe(8)
      expect(structure.hasQualification).toBe(false)
      expect(structure.qualificationPairs).toBe(0)
      expect(structure.quarterFinalPairs).toBe(4)
    })
  })

  describe('2x5 - 10 команд', () => {
    it('10 команд, 8 в плей-офф', () => {
      const structure = getCupPlayoffStructure(2, 5)
      expect(structure.totalTeams).toBe(10)
      expect(structure.playoffTeams).toBe(8)
      expect(structure.hasQualification).toBe(false)
      expect(structure.quarterFinalPairs).toBe(4)
    })
  })

  describe('2x3 - 6 команд', () => {
    it('6 команд, 4 в плей-офф, сразу полуфинал', () => {
      const structure = getCupPlayoffStructure(2, 3)
      expect(structure.totalTeams).toBe(6)
      expect(structure.playoffTeams).toBe(4)
      expect(structure.hasQualification).toBe(false)
      expect(structure.quarterFinalPairs).toBe(0) // нет 1/4
    })
  })

  describe('3x3 - 9 команд', () => {
    it('9 команд, 8 в плей-офф', () => {
      const structure = getCupPlayoffStructure(3, 3)
      expect(structure.totalTeams).toBe(9)
      expect(structure.playoffTeams).toBe(8)
      expect(structure.quarterFinalPairs).toBe(4)
    })
  })

  describe('3x4 - 12 команд', () => {
    it('12 команд, 8 в плей-офф', () => {
      const structure = getCupPlayoffStructure(3, 4)
      expect(structure.totalTeams).toBe(12)
      expect(structure.playoffTeams).toBe(8)
      expect(structure.quarterFinalPairs).toBe(4)
    })
  })
})

// ============================================================================
// Тесты генерации квалификационных пар
// ============================================================================

describe('generateQualificationPairs4x3 - квалификационные пары', () => {
  const createMockStandings = (): GroupStandingEntry[] => {
    const standings: GroupStandingEntry[] = []
    const groupLabels = ['A', 'B', 'C', 'D']

    for (let groupIndex = 1; groupIndex <= 4; groupIndex++) {
      for (let placement = 1; placement <= 3; placement++) {
        standings.push({
          clubId: groupIndex * 100 + placement,
          groupIndex,
          groupLabel: groupLabels[groupIndex - 1],
          placement,
          points: (4 - placement) * 3,
          goalDiff: (4 - placement) * 2,
          goalsFor: (4 - placement) * 3,
          goalsAgainst: placement,
          wins: 3 - placement,
          draws: 0,
          losses: placement - 1,
        })
      }
    }

    return standings
  }

  it('должен создать 4 квалификационные пары', () => {
    const standings = createMockStandings()
    const pairs = generateQualificationPairs4x3(standings)
    expect(pairs).toHaveLength(4)
  })

  it('должен создать пары с правильными pairId', () => {
    const standings = createMockStandings()
    const pairs = generateQualificationPairs4x3(standings)
    const pairIds = pairs.map(p => p.pairId).sort()
    expect(pairIds).toEqual(['F', 'G', 'H', 'I'])
  })

  it('пара H: C2 vs B3', () => {
    const standings = createMockStandings()
    const pairs = generateQualificationPairs4x3(standings)
    const pairH = pairs.find(p => p.pairId === 'H')!

    expect(pairH.home.groupIndex).toBe(3) // группа C
    expect(pairH.home.placement).toBe(2)
    expect(pairH.away.groupIndex).toBe(2) // группа B
    expect(pairH.away.placement).toBe(3)
  })

  it('пара I: B2 vs C3', () => {
    const standings = createMockStandings()
    const pairs = generateQualificationPairs4x3(standings)
    const pairI = pairs.find(p => p.pairId === 'I')!

    expect(pairI.home.groupIndex).toBe(2) // группа B
    expect(pairI.home.placement).toBe(2)
    expect(pairI.away.groupIndex).toBe(3) // группа C
    expect(pairI.away.placement).toBe(3)
  })

  it('пара G: D2 vs A3', () => {
    const standings = createMockStandings()
    const pairs = generateQualificationPairs4x3(standings)
    const pairG = pairs.find(p => p.pairId === 'G')!

    expect(pairG.home.groupIndex).toBe(4) // группа D
    expect(pairG.home.placement).toBe(2)
    expect(pairG.away.groupIndex).toBe(1) // группа A
    expect(pairG.away.placement).toBe(3)
  })

  it('пара F: A2 vs D3', () => {
    const standings = createMockStandings()
    const pairs = generateQualificationPairs4x3(standings)
    const pairF = pairs.find(p => p.pairId === 'F')!

    expect(pairF.home.groupIndex).toBe(1) // группа A
    expect(pairF.home.placement).toBe(2)
    expect(pairF.away.groupIndex).toBe(4) // группа D
    expect(pairF.away.placement).toBe(3)
  })

  it('2-е места играют дома', () => {
    const standings = createMockStandings()
    const pairs = generateQualificationPairs4x3(standings)

    for (const pair of pairs) {
      expect(pair.home.placement).toBe(2)
      expect(pair.away.placement).toBe(3)
    }
  })

  it('все команды уникальны', () => {
    const standings = createMockStandings()
    const pairs = generateQualificationPairs4x3(standings)

    const allClubIds = pairs.flatMap(p => [p.home.clubId, p.away.clubId])
    const uniqueClubIds = new Set(allClubIds)

    expect(uniqueClubIds.size).toBe(8) // 4 пары = 8 уникальных команд
  })
})

// ============================================================================
// Тесты названий стадий
// ============================================================================

describe('CUP_STAGE_NAMES - названия стадий', () => {
  it('квалификация', () => {
    expect(CUP_STAGE_NAMES.QUALIFICATION).toBe('Квалификация')
  })

  it('1/4 финала', () => {
    expect(CUP_STAGE_NAMES.QUARTER_FINAL).toBe('1/4 финала')
  })

  it('полуфиналы', () => {
    expect(CUP_STAGE_NAMES.SEMI_FINAL_GOLD).toBe('Полуфинал Золотого кубка')
    expect(CUP_STAGE_NAMES.SEMI_FINAL_SILVER).toBe('Полуфинал Серебряного кубка')
  })

  it('финалы', () => {
    expect(CUP_STAGE_NAMES.FINAL_GOLD).toBe('Финал Золотого кубка')
    expect(CUP_STAGE_NAMES.FINAL_SILVER).toBe('Финал Серебряного кубка')
  })

  it('матчи за 3 место', () => {
    expect(CUP_STAGE_NAMES.THIRD_PLACE_GOLD).toBe('3 место Золотого кубка')
    expect(CUP_STAGE_NAMES.THIRD_PLACE_SILVER).toBe('3 место Серебряного кубка')
  })
})

// ============================================================================
// Тесты подсчета матчей в групповом этапе
// ============================================================================

describe('Количество матчей в групповом этапе', () => {
  const calculateGroupStageMatches = (
    groupCount: number,
    groupSize: number,
    groupRounds: number
  ): number => {
    // Матчи в одной группе = N * (N - 1) / 2 * rounds
    const matchesPerGroup = (groupSize * (groupSize - 1) / 2) * groupRounds
    return groupCount * matchesPerGroup
  }

  it('4x3, 1 круг: 12 матчей', () => {
    expect(calculateGroupStageMatches(4, 3, 1)).toBe(12)
  })

  it('4x3, 2 круга: 24 матча', () => {
    expect(calculateGroupStageMatches(4, 3, 2)).toBe(24)
  })

  it('2x4, 1 круг: 12 матчей', () => {
    expect(calculateGroupStageMatches(2, 4, 1)).toBe(12)
  })

  it('2x4, 2 круга: 24 матча', () => {
    expect(calculateGroupStageMatches(2, 4, 2)).toBe(24)
  })

  it('3x4, 1 круг: 18 матчей', () => {
    expect(calculateGroupStageMatches(3, 4, 1)).toBe(18)
  })

  it('2x5, 1 круг: 20 матчей', () => {
    expect(calculateGroupStageMatches(2, 5, 1)).toBe(20)
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases - граничные условия кубка', () => {
  it('пустой standings не должен упасть', () => {
    const pairs = generateQualificationPairs4x3([])
    expect(pairs).toHaveLength(0)
  })

  it('неполный standings возвращает частичные пары', () => {
    // Только группы A и B
    const standings: GroupStandingEntry[] = [
      {
        clubId: 101,
        groupIndex: 1,
        groupLabel: 'A',
        placement: 1,
        points: 6,
        goalDiff: 4,
        goalsFor: 6,
        goalsAgainst: 2,
        wins: 2,
        draws: 0,
        losses: 0,
      },
      {
        clubId: 102,
        groupIndex: 1,
        groupLabel: 'A',
        placement: 2,
        points: 3,
        goalDiff: 0,
        goalsFor: 3,
        goalsAgainst: 3,
        wins: 1,
        draws: 0,
        losses: 1,
      },
      {
        clubId: 103,
        groupIndex: 1,
        groupLabel: 'A',
        placement: 3,
        points: 0,
        goalDiff: -4,
        goalsFor: 1,
        goalsAgainst: 5,
        wins: 0,
        draws: 0,
        losses: 2,
      },
    ]

    const pairs = generateQualificationPairs4x3(standings)
    // Без групп B, C, D пары не могут быть сформированы
    expect(pairs).toHaveLength(0)
  })
})
