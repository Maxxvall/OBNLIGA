/**
 * cupBracketLogic.ts — Логика эталонной системы кубка с группами и плей-офф
 *
 * Эталонная структура турнира:
 * 1. Групповой этап: 2-4 группы, круговая система (1-2 круга)
 * 2. Квалификация: 2-е и 3-е места из групп
 * 3. 1/4 финала: победители групп + победители квалификации
 * 4. Серебряный кубок: проигравшие 1/4 финала
 * 5. Золотой кубок: победители 1/4 финала
 */

import { BracketType } from '@prisma/client'

// ============================================================================
// Типы и интерфейсы
// ============================================================================

/** Результат группового этапа для команды */
export interface GroupStandingEntry {
  clubId: number
  groupIndex: number
  groupLabel: string
  placement: number // 1, 2, 3... (место в группе)
  points: number
  goalDiff: number
  goalsFor: number
  goalsAgainst: number
  wins: number
  draws: number
  losses: number
}

/** Конфигурация кубка */
export interface CupBracketConfig {
  groupCount: number
  groupSize: number
  groupRounds: number // количество кругов в группе (1 или 2)
  playoffBestOf: number // до скольких побед в плей-офф (1, 3, 5)
}

/** План серии для создания в БД */
export interface SeriesPlan {
  stageName: string
  homeClubId: number
  awayClubId: number
  bracketType: BracketType
  bracketSlot: number
  homeSeed?: number
  awaySeed?: number
}

/** Информация о команде в плей-офф */
export interface PlayoffTeamEntry {
  clubId: number
  groupIndex: number
  placement: number
  seed: number
  bracketSlot: number
}

/** Пара квалификации */
export interface QualificationPair {
  home: PlayoffTeamEntry
  away: PlayoffTeamEntry
  pairId: string // H, I, G, F и т.д.
  slot: number
}

/** Пара 1/4 финала */
export interface QuarterFinalPair {
  homeTeam: PlayoffTeamEntry | null // победитель группы или победитель квалификации
  awayTeam: PlayoffTeamEntry | null // победитель квалификации
  qualificationPairId?: string // ID квалификационной пары, если awaуTeam из квалификации
  groupWinnerIndex?: number // индекс группы, если homeTeam — победитель группы
  slot: number
}

// ============================================================================
// Валидация конфигурации
// ============================================================================

/** Допустимые конфигурации групп для кубка */
const VALID_CUP_CONFIGS = [
  { groupCount: 2, groupSize: 3 }, // 6 команд: 4 в полуфинал (кросс A1vsB2, B1vsA2)
  { groupCount: 2, groupSize: 4 }, // 8 команд: все 8 в 1/4 финала
  { groupCount: 2, groupSize: 5 }, // 10 команд: 8 лучших в 1/4 финала
  { groupCount: 3, groupSize: 3 }, // 9 команд: 6 лучших + 2 best third
  { groupCount: 3, groupSize: 4 }, // 12 команд: 8 лучших в 1/4 финала
  { groupCount: 4, groupSize: 3 }, // 12 команд: эталонная система с квалификацией
] as const

/**
 * Валидирует конфигурацию кубка
 */
export const validateCupConfiguration = (
  config: CupBracketConfig
): { valid: boolean; error?: string } => {
  const { groupCount, groupSize, groupRounds, playoffBestOf } = config

  // Проверяем количество групп
  if (groupCount < 2 || groupCount > 4) {
    return { valid: false, error: 'cup_invalid_group_count' }
  }

  // Проверяем размер группы
  if (groupSize < 3 || groupSize > 5) {
    return { valid: false, error: 'cup_invalid_group_size' }
  }

  // Проверяем количество кругов
  if (groupRounds < 1 || groupRounds > 2) {
    return { valid: false, error: 'cup_invalid_group_rounds' }
  }

  // Проверяем формат плей-офф
  const validBestOf = [1, 3, 5, 7]
  if (!validBestOf.includes(playoffBestOf)) {
    return { valid: false, error: 'cup_invalid_playoff_format' }
  }

  // Проверяем допустимую комбинацию групп и размера
  const isValidCombo = VALID_CUP_CONFIGS.some(
    combo => combo.groupCount === groupCount && combo.groupSize === groupSize
  )

  if (!isValidCombo) {
    // Особые правила:
    // - 2 группы: 3, 4 или 5 команд
    // - 3 группы: 3 или 4 команды
    // - 4 группы: только 3 команды
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

// ============================================================================
// Генерация структуры плей-офф
// ============================================================================

/**
 * Определяет структуру плей-офф на основе количества команд
 */
export const getCupPlayoffStructure = (
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

  // Для 4 групп по 3 команды (12 команд) — эталонная система
  if (groupCount === 4 && groupSize === 3) {
    return {
      totalTeams: 12,
      playoffTeams: 12, // все проходят
      hasQualification: true,
      qualificationPairs: 4, // 8 команд (все 2-е и 3-е места)
      quarterFinalPairs: 4, // 4 победителя групп + 4 победителя квалификации
    }
  }

  // Для 2 групп по 5 команд (10 команд) — 8 лучших в плей-офф
  if (groupCount === 2 && groupSize === 5) {
    return {
      totalTeams: 10,
      playoffTeams: 8, // по 4 из каждой группы, 5-е выбывают
      hasQualification: false, // сразу в 1/4
      qualificationPairs: 0,
      quarterFinalPairs: 4,
    }
  }

  // Для 2 групп по 4 команды (8 команд) — все в плей-офф
  if (groupCount === 2 && groupSize === 4) {
    return {
      totalTeams: 8,
      playoffTeams: 8, // все проходят
      hasQualification: false,
      qualificationPairs: 0,
      quarterFinalPairs: 4,
    }
  }

  // Для 3 групп по 4 команды (12 команд)
  if (groupCount === 3 && groupSize === 4) {
    return {
      totalTeams: 12,
      playoffTeams: 8, // по 2 из каждой группы + 2 лучших 3-х
      hasQualification: false,
      qualificationPairs: 0,
      quarterFinalPairs: 4,
    }
  }

  // Для 3 групп по 3 команды (9 команд)
  if (groupCount === 3 && groupSize === 3) {
    return {
      totalTeams: 9,
      playoffTeams: 8, // по 2 из каждой группы + 2 лучших 3-х
      hasQualification: false,
      qualificationPairs: 0,
      quarterFinalPairs: 4,
    }
  }

  // Для 2 групп по 3 команды (6 команд) — полуфинал
  if (groupCount === 2 && groupSize === 3) {
    return {
      totalTeams: 6,
      playoffTeams: 4, // по 2 из каждой группы
      hasQualification: false,
      qualificationPairs: 0,
      quarterFinalPairs: 0, // нет 1/4, сразу полуфинал
    }
  }

  // По умолчанию — стандартная структура
  return {
    totalTeams,
    playoffTeams: Math.min(8, totalTeams),
    hasQualification: false,
    qualificationPairs: 0,
    quarterFinalPairs: 4,
  }
}

// ============================================================================
// Генерация пар квалификации
// ============================================================================

/**
 * Генерирует пары квалификации для 4 групп по 3 команды
 * Схема: H=C2vsB3, I=B2vsC3, G=D2vsA3, F=A2vsD3
 */
export const generateQualificationPairs4x3 = (
  standings: GroupStandingEntry[]
): QualificationPair[] => {
  // Группируем по группам
  const byGroup = new Map<number, GroupStandingEntry[]>()
  for (const entry of standings) {
    const group = byGroup.get(entry.groupIndex) ?? []
    group.push(entry)
    byGroup.set(entry.groupIndex, group)
  }

  // Сортируем внутри каждой группы по месту
  for (const [, entries] of byGroup) {
    entries.sort((a, b) => a.placement - b.placement)
  }

  // Получаем 2-е и 3-е места
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

  // A=1, B=2, C=3, D=4
  const pairs: QualificationPair[] = []

  // H: C2 vs B3 (группа 3 место 2 vs группа 2 место 3)
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

// ============================================================================
// Генерация 1/4 финала
// ============================================================================

/**
 * Генерирует пары 1/4 финала для эталонной системы 4x3
 * Схема: QF1=A1vsH, QF2=D1vsI, QF3=B1vsF, QF4=C1vsG
 */
export const generateQuarterFinalPairs4x3 = (
  groupWinners: PlayoffTeamEntry[],
  qualificationResults: Map<string, number> // pairId -> winnerClubId
): QuarterFinalPair[] => {
  // Группируем победителей групп
  const winnerByGroup = new Map<number, PlayoffTeamEntry>()
  for (const winner of groupWinners) {
    if (winner.placement === 1) {
      winnerByGroup.set(winner.groupIndex, winner)
    }
  }

  const getGroupWinner = (groupIndex: number): PlayoffTeamEntry | null => {
    return winnerByGroup.get(groupIndex) ?? null
  }

  const getQualificationWinner = (pairId: string): number | null => {
    return qualificationResults.get(pairId) ?? null
  }

  const pairs: QuarterFinalPair[] = []

  // QF1: A1 vs H (группа 1 победитель vs победитель квалификации H)
  const A1 = getGroupWinner(1)
  const H = getQualificationWinner('H')
  pairs.push({
    homeTeam: A1,
    awayTeam: H ? { clubId: H, groupIndex: 0, placement: 0, seed: 0, bracketSlot: 1 } : null,
    qualificationPairId: 'H',
    groupWinnerIndex: 1,
    slot: 1,
  })

  // QF2: D1 vs I
  const D1 = getGroupWinner(4)
  const I = getQualificationWinner('I')
  pairs.push({
    homeTeam: D1,
    awayTeam: I ? { clubId: I, groupIndex: 0, placement: 0, seed: 0, bracketSlot: 2 } : null,
    qualificationPairId: 'I',
    groupWinnerIndex: 4,
    slot: 2,
  })

  // QF3: B1 vs F
  const B1 = getGroupWinner(2)
  const F = getQualificationWinner('F')
  pairs.push({
    homeTeam: B1,
    awayTeam: F ? { clubId: F, groupIndex: 0, placement: 0, seed: 0, bracketSlot: 3 } : null,
    qualificationPairId: 'F',
    groupWinnerIndex: 2,
    slot: 3,
  })

  // QF4: C1 vs G
  const C1 = getGroupWinner(3)
  const G = getQualificationWinner('G')
  pairs.push({
    homeTeam: C1,
    awayTeam: G ? { clubId: G, groupIndex: 0, placement: 0, seed: 0, bracketSlot: 4 } : null,
    qualificationPairId: 'G',
    groupWinnerIndex: 3,
    slot: 4,
  })

  return pairs
}

// ============================================================================
// Генерация следующих стадий плей-офф
// ============================================================================

/** Названия стадий для кубка */
export const CUP_STAGE_NAMES = {
  QUALIFICATION: 'Квалификация',
  QUARTER_FINAL: '1/4 финала',
  SEMI_FINAL_GOLD: 'Полуфинал Золотого кубка',
  SEMI_FINAL_SILVER: 'Полуфинал Серебряного кубка',
  FINAL_GOLD: 'Финал Золотого кубка',
  FINAL_SILVER: 'Финал Серебряного кубка',
  THIRD_PLACE_GOLD: '3 место Золотого кубка',
  THIRD_PLACE_SILVER: '3 место Серебряного кубка',
} as const

/**
 * Генерирует план серий для квалификации
 */
export const createQualificationSeriesPlans = (
  qualificationPairs: QualificationPair[]
): SeriesPlan[] => {
  return qualificationPairs.map(pair => ({
    stageName: CUP_STAGE_NAMES.QUALIFICATION,
    homeClubId: pair.home.clubId,
    awayClubId: pair.away.clubId,
    bracketType: BracketType.QUALIFICATION,
    bracketSlot: pair.slot,
    homeSeed: pair.home.seed,
    awaySeed: pair.away.seed,
  }))
}

/**
 * Генерирует план серий для 1/4 финала
 */
export const createQuarterFinalSeriesPlans = (
  groupWinners: GroupStandingEntry[],
  qualificationWinners: Map<string, number> // pairId -> clubId
): SeriesPlan[] => {
  const plans: SeriesPlan[] = []

  // Преобразуем победителей групп в PlayoffTeamEntry
  const winners: PlayoffTeamEntry[] = groupWinners
    .filter(e => e.placement === 1)
    .map(e => ({
      clubId: e.clubId,
      groupIndex: e.groupIndex,
      placement: 1,
      seed: e.groupIndex,
      bracketSlot: e.groupIndex,
    }))

  const qfPairs = generateQuarterFinalPairs4x3(winners, qualificationWinners)

  for (const pair of qfPairs) {
    if (pair.homeTeam && pair.awayTeam) {
      plans.push({
        stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
        homeClubId: pair.homeTeam.clubId,
        awayClubId: pair.awayTeam.clubId,
        bracketType: BracketType.GOLD, // 1/4 финала — часть золотого кубка
        bracketSlot: pair.slot,
        homeSeed: pair.homeTeam.seed,
        awaySeed: pair.awayTeam.seed,
      })
    }
  }

  return plans
}

/**
 * Генерирует план серий полуфиналов Золотого кубка
 * Победители QF1 и QF2 встречаются в SFg1
 * Победители QF3 и QF4 встречаются в SFg2
 */
export const createGoldSemiFinalPlans = (
  qfWinners: Array<{ qfSlot: number; clubId: number; seed?: number }>
): SeriesPlan[] => {
  const plans: SeriesPlan[] = []

  // Сортируем по слоту QF
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

/**
 * Генерирует план серий полуфиналов Серебряного кубка
 * Проигравшие QF1 и QF2 встречаются в SFs1
 * Проигравшие QF3 и QF4 встречаются в SFs2
 */
export const createSilverSemiFinalPlans = (
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

/**
 * Генерирует план финала и матча за 3 место Золотого кубка
 */
export const createGoldFinalPlans = (
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

/**
 * Генерирует план финала и матча за 3 место Серебряного кубка
 */
export const createSilverFinalPlans = (
  sfWinners: Array<{ sfSlot: number; clubId: number; seed?: number }>,
  sfLosers: Array<{ sfSlot: number; clubId: number; seed?: number }>
): SeriesPlan[] => {
  const plans: SeriesPlan[] = []

  // Финал Серебряного: Winner(SFs1) vs Winner(SFs2)
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

  // 3 место Серебряного: Loser(SFs1) vs Loser(SFs2)
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
// Универсальная генерация плей-офф для разных конфигураций
// ============================================================================

/**
 * Генерирует пары 1/4 финала для 2 групп по 4-5 команд
 * Схема кросс-матчей: A1vsB4, B1vsA4, A2vsB3, B2vsA3
 */
export const generateQuarterFinalPairs2Groups = (
  standings: GroupStandingEntry[]
): SeriesPlan[] => {
  const plans: SeriesPlan[] = []

  // Группируем по группам
  const byGroup = new Map<number, GroupStandingEntry[]>()
  for (const entry of standings) {
    const group = byGroup.get(entry.groupIndex) ?? []
    group.push(entry)
    byGroup.set(entry.groupIndex, group)
  }

  // Сортируем внутри каждой группы
  for (const [, entries] of byGroup) {
    entries.sort((a, b) => a.placement - b.placement)
  }

  const sortedGroups = Array.from(byGroup.entries()).sort((a, b) => a[0] - b[0])
  if (sortedGroups.length < 2) return plans
  const groupA = sortedGroups[0][1]
  const groupB = sortedGroups[1][1]

  const getTeam = (group: GroupStandingEntry[], placement: number) =>
    group.find(e => e.placement === placement)

  // QF1: A1 vs B4
  const a1 = getTeam(groupA, 1)
  const b4 = getTeam(groupB, 4)
  if (a1 && b4) {
    plans.push({
      stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
      homeClubId: a1.clubId,
      awayClubId: b4.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 1,
      homeSeed: 1,
      awaySeed: 8,
    })
  }

  // QF2: B1 vs A4
  const b1 = getTeam(groupB, 1)
  const a4 = getTeam(groupA, 4)
  if (b1 && a4) {
    plans.push({
      stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
      homeClubId: b1.clubId,
      awayClubId: a4.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 2,
      homeSeed: 2,
      awaySeed: 7,
    })
  }

  // QF3: A2 vs B3
  const a2 = getTeam(groupA, 2)
  const b3 = getTeam(groupB, 3)
  if (a2 && b3) {
    plans.push({
      stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
      homeClubId: a2.clubId,
      awayClubId: b3.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 3,
      homeSeed: 3,
      awaySeed: 6,
    })
  }

  // QF4: B2 vs A3
  const b2 = getTeam(groupB, 2)
  const a3 = getTeam(groupA, 3)
  if (b2 && a3) {
    plans.push({
      stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
      homeClubId: b2.clubId,
      awayClubId: a3.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 4,
      homeSeed: 4,
      awaySeed: 5,
    })
  }

  return plans
}

/**
 * Генерирует пары полуфинала для 2 групп по 3 команды (6 команд)
 * Схема кросс-матчей: SF1=A1vsB2, SF2=B1vsA2
 */
export const generateSemiFinalPairs2x3 = (
  standings: GroupStandingEntry[]
): SeriesPlan[] => {
  const plans: SeriesPlan[] = []

  // Группируем по группам
  const byGroup = new Map<number, GroupStandingEntry[]>()
  for (const entry of standings) {
    const group = byGroup.get(entry.groupIndex) ?? []
    group.push(entry)
    byGroup.set(entry.groupIndex, group)
  }

  // Сортируем внутри каждой группы
  for (const [, entries] of byGroup) {
    entries.sort((a, b) => a.placement - b.placement)
  }

  const groupA = byGroup.get(1) ?? []
  const groupB = byGroup.get(2) ?? []

  const getTeam = (group: GroupStandingEntry[], placement: number) =>
    group.find(e => e.placement === placement)

  // SF1: A1 vs B2
  const a1 = getTeam(groupA, 1)
  const b2 = getTeam(groupB, 2)
  if (a1 && b2) {
    plans.push({
      stageName: CUP_STAGE_NAMES.SEMI_FINAL_GOLD,
      homeClubId: a1.clubId,
      awayClubId: b2.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 1,
      homeSeed: 1,
      awaySeed: 4,
    })
  }

  // SF2: B1 vs A2
  const b1 = getTeam(groupB, 1)
  const a2 = getTeam(groupA, 2)
  if (b1 && a2) {
    plans.push({
      stageName: CUP_STAGE_NAMES.SEMI_FINAL_GOLD,
      homeClubId: b1.clubId,
      awayClubId: a2.clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 2,
      homeSeed: 2,
      awaySeed: 3,
    })
  }

  return plans
}

// ============================================================================
// Определение следующей стадии
// ============================================================================

/**
 * Определяет следующую стадию после текущей
 */
export const getNextCupStage = (
  currentStage: string,
  bracketType: BracketType
): string | null => {
  // Квалификация → 1/4 финала
  if (currentStage === CUP_STAGE_NAMES.QUALIFICATION) {
    return CUP_STAGE_NAMES.QUARTER_FINAL
  }

  // 1/4 финала → Полуфиналы (Gold для победителей, Silver для проигравших)
  if (currentStage === CUP_STAGE_NAMES.QUARTER_FINAL) {
    return bracketType === BracketType.GOLD
      ? CUP_STAGE_NAMES.SEMI_FINAL_GOLD
      : CUP_STAGE_NAMES.SEMI_FINAL_SILVER
  }

  // Полуфиналы Gold → Финал/3 место Gold
  if (currentStage === CUP_STAGE_NAMES.SEMI_FINAL_GOLD) {
    return CUP_STAGE_NAMES.FINAL_GOLD
  }

  // Полуфиналы Silver → Финал/3 место Silver
  if (currentStage === CUP_STAGE_NAMES.SEMI_FINAL_SILVER) {
    return CUP_STAGE_NAMES.FINAL_SILVER
  }

  // Финалы — это конец
  if (
    currentStage === CUP_STAGE_NAMES.FINAL_GOLD ||
    currentStage === CUP_STAGE_NAMES.FINAL_SILVER ||
    currentStage === CUP_STAGE_NAMES.THIRD_PLACE_GOLD ||
    currentStage === CUP_STAGE_NAMES.THIRD_PLACE_SILVER
  ) {
    return null
  }

  return null
}

/**
 * Проверяет, является ли текущая стадия финальной
 */
export const isFinalStage = (stageName: string): boolean => {
  return [
    CUP_STAGE_NAMES.FINAL_GOLD,
    CUP_STAGE_NAMES.FINAL_SILVER,
    CUP_STAGE_NAMES.THIRD_PLACE_GOLD,
    CUP_STAGE_NAMES.THIRD_PLACE_SILVER,
  ].includes(stageName as typeof CUP_STAGE_NAMES.FINAL_GOLD)
}

/**
 * Определяет порядок сортировки стадий кубка
 */
export const getCupStageRank = (stageName: string): number => {
  const ranks: Record<string, number> = {
    [CUP_STAGE_NAMES.QUALIFICATION]: 10,
    [CUP_STAGE_NAMES.QUARTER_FINAL]: 20,
    [CUP_STAGE_NAMES.SEMI_FINAL_GOLD]: 30,
    [CUP_STAGE_NAMES.SEMI_FINAL_SILVER]: 31,
    [CUP_STAGE_NAMES.THIRD_PLACE_GOLD]: 40,
    [CUP_STAGE_NAMES.THIRD_PLACE_SILVER]: 41,
    [CUP_STAGE_NAMES.FINAL_GOLD]: 50,
    [CUP_STAGE_NAMES.FINAL_SILVER]: 51,
  }
  return ranks[stageName] ?? 0
}

// ============================================================================
// Логика для 3 групп по 3 команды (9 команд → 8 в плей-офф)
// ============================================================================

/**
 * Информация о команде с дополнительными метриками для сравнения
 */
export interface TeamWithStats extends GroupStandingEntry {
  /** Разница мячей */
  goalDifference: number
  /** Голы забитые */
  goalsFor: number
  /** Голы пропущенные */
  goalsAgainst: number
  /** Результаты личных встреч с другими командами (clubId -> результат: 1=победа, 0=ничья, -1=поражение) */
  headToHead: Map<number, number>
}

/**
 * Сравнивает две команды для определения лучшей
 * Порядок сравнения:
 * 1. Очки
 * 2. Личные встречи (если играли между собой)
 * 3. Разница мячей
 * 4. Голы забитые
 */
export const compareTeams = (a: TeamWithStats, b: TeamWithStats): number => {
  // 1. По очкам (больше = лучше)
  if (a.points !== b.points) {
    return b.points - a.points
  }

  // 2. По личным встречам (если играли между собой)
  const h2hA = a.headToHead.get(b.clubId)
  const h2hB = b.headToHead.get(a.clubId)
  if (h2hA !== undefined && h2hB !== undefined) {
    // h2h: 1 = победа, 0 = ничья, -1 = поражение
    if (h2hA > h2hB) return -1 // A выиграл личную встречу
    if (h2hA < h2hB) return 1 // B выиграл личную встречу
  }

  // 3. По разнице мячей (больше = лучше)
  if (a.goalDifference !== b.goalDifference) {
    return b.goalDifference - a.goalDifference
  }

  // 4. По голам забитым (больше = лучше)
  if (a.goalsFor !== b.goalsFor) {
    return b.goalsFor - a.goalsFor
  }

  // Если всё равно — по clubId для стабильности
  return a.clubId - b.clubId
}

/**
 * Определяет 8 лучших команд из 9 (3 группы по 3)
 * 
 * Все команды ранжируются глобально:
 * - Сначала все 1-е места (3 команды)
 * - Затем все 2-е места (3 команды)
 * - Затем все 3-е места (3 команды) — выбывает худшая
 * 
 * Внутри каждой категории сравнение по:
 * 1. Очкам
 * 2. Личным встречам
 * 3. Разнице мячей
 * 4. Голам забитым
 */
export const selectBest8From3x3 = (
  standings: TeamWithStats[]
): TeamWithStats[] => {
  // Группируем по местам
  const firstPlace = standings.filter(t => t.placement === 1)
  const secondPlace = standings.filter(t => t.placement === 2)
  const thirdPlace = standings.filter(t => t.placement === 3)

  // Сортируем каждую группу
  firstPlace.sort(compareTeams)
  secondPlace.sort(compareTeams)
  thirdPlace.sort(compareTeams)

  // Все 1-е места проходят (3 команды)
  // Все 2-е места проходят (3 команды)
  // Из 3-х мест проходят только 2 лучших (2 команды)
  const qualified = [
    ...firstPlace,
    ...secondPlace,
    ...thirdPlace.slice(0, 2), // Только 2 лучших из 3-х мест
  ]

  return qualified
}

/**
 * Генерирует пары 1/4 финала для 3 групп по 3 команды
 * 
 * Схема посева:
 * Seed 1-3: 1-е места групп (сортированы по метрикам)
 * Seed 4-6: 2-е места групп (сортированы по метрикам)
 * Seed 7-8: 2 лучших 3-х места
 * 
 * Пары: 1vs8, 2vs7, 3vs6, 4vs5
 */
export const generateQuarterFinalPairs3x3 = (
  standings: TeamWithStats[]
): SeriesPlan[] => {
  const best8 = selectBest8From3x3(standings)
  
  // Присваиваем посев (seed) по порядку в отсортированном списке
  const seeded = best8.map((team, index) => ({
    ...team,
    seed: index + 1,
  }))

  const plans: SeriesPlan[] = []

  // QF1: Seed 1 vs Seed 8
  if (seeded[0] && seeded[7]) {
    plans.push({
      stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
      homeClubId: seeded[0].clubId,
      awayClubId: seeded[7].clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 1,
      homeSeed: 1,
      awaySeed: 8,
    })
  }

  // QF2: Seed 2 vs Seed 7
  if (seeded[1] && seeded[6]) {
    plans.push({
      stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
      homeClubId: seeded[1].clubId,
      awayClubId: seeded[6].clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 2,
      homeSeed: 2,
      awaySeed: 7,
    })
  }

  // QF3: Seed 3 vs Seed 6
  if (seeded[2] && seeded[5]) {
    plans.push({
      stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
      homeClubId: seeded[2].clubId,
      awayClubId: seeded[5].clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 3,
      homeSeed: 3,
      awaySeed: 6,
    })
  }

  // QF4: Seed 4 vs Seed 5
  if (seeded[3] && seeded[4]) {
    plans.push({
      stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
      homeClubId: seeded[3].clubId,
      awayClubId: seeded[4].clubId,
      bracketType: BracketType.GOLD,
      bracketSlot: 4,
      homeSeed: 4,
      awaySeed: 5,
    })
  }

  return plans
}

// ============================================================================
// Логика для 3 групп по 4 команды (12 команд → 8 в плей-офф)
// ============================================================================

/**
 * Определяет 8 лучших команд из 12 (3 группы по 4)
 * 
 * Все 1-е места (3) + Все 2-е места (3) + 2 лучших 3-х места
 */
export const selectBest8From3x4 = (
  standings: TeamWithStats[]
): TeamWithStats[] => {
  const firstPlace = standings.filter(t => t.placement === 1)
  const secondPlace = standings.filter(t => t.placement === 2)
  const thirdPlace = standings.filter(t => t.placement === 3)

  firstPlace.sort(compareTeams)
  secondPlace.sort(compareTeams)
  thirdPlace.sort(compareTeams)

  return [
    ...firstPlace,
    ...secondPlace,
    ...thirdPlace.slice(0, 2),
  ]
}

/**
 * Генерирует пары 1/4 финала для 3 групп по 4 команды
 */
export const generateQuarterFinalPairs3x4 = (
  standings: TeamWithStats[]
): SeriesPlan[] => {
  const best8 = selectBest8From3x4(standings)
  
  const seeded = best8.map((team, index) => ({
    ...team,
    seed: index + 1,
  }))

  const plans: SeriesPlan[] = []

  // Пары по посеву: 1vs8, 2vs7, 3vs6, 4vs5
  const pairings = [
    { home: 0, away: 7, slot: 1 },
    { home: 1, away: 6, slot: 2 },
    { home: 2, away: 5, slot: 3 },
    { home: 3, away: 4, slot: 4 },
  ]

  for (const pairing of pairings) {
    const home = seeded[pairing.home]
    const away = seeded[pairing.away]
    if (home && away) {
      plans.push({
        stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
        homeClubId: home.clubId,
        awayClubId: away.clubId,
        bracketType: BracketType.GOLD,
        bracketSlot: pairing.slot,
        homeSeed: pairing.home + 1,
        awaySeed: pairing.away + 1,
      })
    }
  }

  return plans
}

// ============================================================================
// Логика для 2 групп по 5 команд (10 команд → 8 в плей-офф)
// ============================================================================

/**
 * Определяет 8 лучших команд из 10 (2 группы по 5)
 * 
 * Все 1-4 места из каждой группы, 5-е места выбывают
 */
export const selectBest8From2x5 = (
  standings: TeamWithStats[]
): TeamWithStats[] => {
  // Группируем по группам
  const byGroup = new Map<number, TeamWithStats[]>()
  for (const team of standings) {
    const group = byGroup.get(team.groupIndex) ?? []
    group.push(team)
    byGroup.set(team.groupIndex, group)
  }

  const qualified: TeamWithStats[] = []
  
  for (const [, teams] of byGroup) {
    // Сортируем по месту и берём топ-4
    teams.sort((a, b) => a.placement - b.placement)
    qualified.push(...teams.slice(0, 4))
  }

  return qualified
}

/**
 * Генерирует пары 1/4 финала для 2 групп по 5 команд
 * Кросс-схема: A1vsB4, B1vsA4, A2vsB3, B2vsA3
 */
export const generateQuarterFinalPairs2x5 = (
  standings: TeamWithStats[]
): SeriesPlan[] => {
  return generateQuarterFinalPairs2Groups(standings)
}

// ============================================================================
// Универсальный диспетчер генерации плей-офф
// ============================================================================

/**
 * Генерирует пары 1/4 финала на основе конфигурации турнира
 */
export const generateQuarterFinalPairs = (
  config: CupBracketConfig,
  standings: TeamWithStats[]
): SeriesPlan[] => {
  const { groupCount, groupSize } = config

  // 4 группы по 3 команды — эталонная система с квалификацией
  // (квалификация обрабатывается отдельно)
  if (groupCount === 4 && groupSize === 3) {
    // Для эталонной системы используем отдельную логику через generateQuarterFinalPairs4x3
    // Эта функция вызывается только после завершения квалификации
    return []
  }

  // 3 группы по 3 команды — 8 из 9
  if (groupCount === 3 && groupSize === 3) {
    return generateQuarterFinalPairs3x3(standings)
  }

  // 3 группы по 4 команды — 8 из 12
  if (groupCount === 3 && groupSize === 4) {
    return generateQuarterFinalPairs3x4(standings)
  }

  // 2 группы по 5 команд — 8 из 10
  if (groupCount === 2 && groupSize === 5) {
    return generateQuarterFinalPairs2x5(standings)
  }

  // 2 группы по 4 команды — все 8 в плей-офф
  if (groupCount === 2 && groupSize === 4) {
    return generateQuarterFinalPairs2Groups(standings)
  }

  return []
}

/**
 * Проверяет, нужна ли квалификация для данной конфигурации
 */
export const needsQualification = (groupCount: number, groupSize: number): boolean => {
  // Квалификация нужна только для эталонной системы 4x3
  return groupCount === 4 && groupSize === 3
}

/**
 * Вычисляет количество команд, выходящих из группы для кубковой конфигурации
 * Учитывает специфику каждой конфигурации:
 * - 4×3: все 3 выходят (через квалификацию)
 * - 3×3: все 3 выходят (1,2 + лучшие 3-и места)
 * - 3×4: 3 выходят (1,2 + лучшие 3-и места)
 * - 2×3: 2 выходят (кросс-полуфинал)
 * - 2×4: все 4 выходят (все в 1/4)
 * - 2×5: 4 выходят (5-е выбывают)
 */
export const getCupQualifyCount = (groupCount: number, groupSize: number): number => {
  // 4×3 — эталонная система: все 3 команды из каждой группы проходят
  if (groupCount === 4 && groupSize === 3) {
    return 3 // все выходят через квалификацию
  }

  // 3×3 — 9 команд → 8 в плей-офф: все 3 из группы (включая лучших 3-х)
  if (groupCount === 3 && groupSize === 3) {
    return 3 // все проходят (1+2 гарантированно, 3-и сравниваются между собой)
  }

  // 3×4 — 12 команд → 8 в плей-офф: 1,2 + лучшие 3-и
  if (groupCount === 3 && groupSize === 4) {
    return 3 // 1,2 гарантированно, 3-и сравниваются
  }

  // 2×3 — 6 команд → 4 в полуфинал: топ-2 из каждой группы
  if (groupCount === 2 && groupSize === 3) {
    return 2
  }

  // 2×4 — 8 команд → все 8 в 1/4: все 4 из каждой группы
  if (groupCount === 2 && groupSize === 4) {
    return 4
  }

  // 2×5 — 10 команд → 8 в 1/4: топ-4 из каждой группы
  if (groupCount === 2 && groupSize === 5) {
    return 4
  }

  // По умолчанию — половина группы (минимум 1)
  return Math.max(1, Math.floor(groupSize / 2))
}
