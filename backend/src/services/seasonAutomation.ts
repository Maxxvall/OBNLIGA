import {
  Competition,
  MatchStatus,
  Prisma,
  PrismaClient,
  RoundType,
  SeriesFormat,
  SeriesStatus,
} from '@prisma/client'
import { FastifyBaseLogger } from 'fastify'

type ClubId = number

const getSeasonSeriesFormat = (season: {
  seriesFormat?: SeriesFormat | null
  competition: { seriesFormat: SeriesFormat }
}): SeriesFormat => (season.seriesFormat ?? season.competition.seriesFormat) as SeriesFormat

type RoundRobinPair = {
  roundIndex: number
  homeClubId: ClubId
  awayClubId: ClubId
}

type GroupStageSlotInput = {
  position: number
  clubId: ClubId
}

type GroupStageGroupInput = {
  groupIndex: number
  label: string
  qualifyCount: number
  slots: GroupStageSlotInput[]
}

type GroupStageConfigInput = {
  groupCount: number
  groupSize: number
  qualifyCount: number
  groups: GroupStageGroupInput[]
}

type ValidatedGroupStage = {
  groupSize: number
  groups: GroupStageGroupInput[]
  clubIds: ClubId[]
}

const MATCH_INTERVAL_MINUTES = 60

const validateGroupStageConfig = (config?: GroupStageConfigInput): ValidatedGroupStage => {
  if (!config) {
    throw new Error('group_stage_missing')
  }

  const { groupCount, groupSize, groups } = config
  if (!Number.isFinite(groupCount) || groupCount <= 0) {
    throw new Error('group_stage_invalid_count')
  }
  if (!Number.isFinite(groupSize) || groupSize < 2) {
    throw new Error('group_stage_invalid_size')
  }
  if (!Array.isArray(groups) || groups.length !== groupCount) {
    throw new Error('group_stage_count_mismatch')
  }

  const seenGroupIndexes = new Set<number>()
  const seenClubIds = new Set<number>()

  const normalizedGroups = [...groups]
    .map(group => {
      const { groupIndex, label, qualifyCount, slots } = group

      if (!Number.isFinite(groupIndex) || groupIndex <= 0) {
        throw new Error('group_stage_invalid_index')
      }
      if (seenGroupIndexes.has(groupIndex)) {
        throw new Error('group_stage_duplicate_index')
      }
      seenGroupIndexes.add(groupIndex)

      if (!label || !label.trim()) {
        throw new Error('group_stage_missing_label')
      }

      if (!Number.isFinite(qualifyCount) || qualifyCount < 1 || qualifyCount > groupSize) {
        throw new Error('group_stage_invalid_qualify')
      }

      if (!Array.isArray(slots) || slots.length !== groupSize) {
        throw new Error('group_stage_slot_mismatch')
      }

      const normalizedSlots = slots.map((slot, index) => {
        const position = index + 1
        if (slot.position && slot.position !== position) {
          throw new Error('group_stage_invalid_slot_position')
        }

        const clubId = slot.clubId
        if (typeof clubId === 'number' && clubId > 0) {
          if (seenClubIds.has(clubId)) {
            throw new Error('group_stage_duplicate_club')
          }
          seenClubIds.add(clubId)
        }

        return {
          ...slot,
          position,
        }
      })

      return {
        ...group,
        slots: normalizedSlots,
      }
    })
    .sort((left, right) => left.groupIndex - right.groupIndex)

  return {
    groupSize,
    groups: normalizedGroups,
    clubIds: Array.from(seenClubIds),
  }
}

interface SeasonAutomationInput {
  competition: Competition
  seasonName: string
  startDateISO: string
  matchDayOfWeek: number
  matchTime?: string | null
  city?: string | null
  seriesFormat: SeriesFormat
  bestOfLength?: number
  groupStage?: GroupStageConfigInput
  clubIds: ClubId[]
  /** Количество кругов в групповом этапе (1 или 2). По умолчанию 1. */
  groupRounds?: number
  /** До скольких побед играется серия плей-офф (1, 3, 5). По умолчанию 1. */
  playoffBestOf?: number
}

export type SeasonAutomationResult = {
  seasonId: number
  matchesCreated: number
  participantsCreated: number
  rosterEntriesCreated: number
  seriesCreated: number
  groupsCreated: number
  groupSlotsCreated: number
}

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

const getGroupStageRounds = (format: SeriesFormat): number => {
  if (format === ('PLAYOFF_BRACKET' as SeriesFormat)) {
    return 0
  }
  switch (format) {
    case SeriesFormat.TWO_LEGGED:
      return 2
    case SeriesFormat.DOUBLE_ROUND_PLAYOFF:
      return 2
    case SeriesFormat.SINGLE_MATCH:
    case SeriesFormat.BEST_OF_N:
    default:
      return 1
  }
}

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

export const stageNameForTeams = (teamCount: number): string => {
  if (teamCount <= 2) return 'Финал'
  if (teamCount <= 4) return 'Полуфинал'
  if (teamCount <= 8) return 'Четвертьфинал'
  if (teamCount <= 16) return '1/8 финала'
  if (teamCount <= 32) return '1/16 финала'
  return `Плей-офф (${teamCount} команд)`
}

const toOdd = (value: number): number => {
  const normalized = Math.max(1, Math.floor(value))
  return normalized % 2 === 0 ? normalized + 1 : normalized
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

type InitialPlayoffPlanResult = {
  plans: PlayoffSeriesPlan[]
  byeSeries: PlayoffByePlan[]
}

export const createInitialPlayoffPlans = (
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
        matchDates.push(applyTimeToDate(scheduled, matchTime))
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

export const createRandomPlayoffPlans = (
  clubIds: number[],
  startDate: Date,
  matchTime: string | null | undefined,
  bestOfLength = 1,
  options?: { shuffle?: boolean }
): InitialPlayoffPlanResult => {
  if (clubIds.length < 2) {
    const byeSeries = clubIds[0]
      ? [
          {
            clubId: clubIds[0],
            seed: 1,
            targetSlot: 1,
          },
        ]
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
        matchDates.push(applyTimeToDate(scheduled, matchTime))
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
    ? [
        {
          clubId: ordered[ordered.length - 1],
          seed: stageTeamsCount + 1,
          targetSlot: stageTeamsCount + 1,
        },
      ]
    : []

  return { plans, byeSeries }
}

const generateRoundRobinPairs = (clubIds: ClubId[], roundsPerPair: number): RoundRobinPair[] => {
  const uniqueClubs = ensureUniqueClubs(clubIds)
  if (uniqueClubs.length < 2) {
    return []
  }

  const teams = [...uniqueClubs]
  const hasBye = teams.length % 2 === 1
  if (hasBye) {
    teams.push(-1)
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

const alignDateToWeekday = (date: Date, weekday: number): Date => {
  const clone = new Date(date)
  const currentWeekday = clone.getDay()
  const normalizedWeekday = ((weekday % 7) + 7) % 7
  const delta = (normalizedWeekday - currentWeekday + 7) % 7
  clone.setDate(clone.getDate() + delta)
  return clone
}

export const applyTimeToDate = (date: Date, time?: string | null): Date => {
  if (!time) return date
  const match = /^([0-2]\d):([0-5]\d)$/.exec(time.trim())
  if (!match) return date
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const withTime = new Date(date)
  withTime.setHours(hours, minutes, 0, 0)
  return withTime
}

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export const addMinutes = (date: Date, minutes: number): Date => {
  if (!Number.isFinite(minutes) || minutes === 0) {
    return new Date(date)
  }
  const next = new Date(date)
  next.setMinutes(next.getMinutes() + minutes)
  return next
}

export const runSeasonAutomation = async (
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  input: SeasonAutomationInput
): Promise<SeasonAutomationResult> => {
  const cityValue = (input.city ?? '').trim()
  const seasonCity = cityValue ? cityValue : null
  const isGroupStageFormat =
    input.seriesFormat === (SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF as SeriesFormat)
  const validatedGroupStage = isGroupStageFormat
    ? validateGroupStageConfig(input.groupStage)
    : undefined

  const sourceClubIds = isGroupStageFormat ? validatedGroupStage!.clubIds : input.clubIds
  const uniqueClubIds = ensureUniqueClubs(sourceClubIds)
  if (uniqueClubIds.length < 2) {
    throw new Error('not_enough_participants')
  }

  const groupRounds = isGroupStageFormat ? 0 : getGroupStageRounds(input.seriesFormat)
  const pairs = isGroupStageFormat ? [] : generateRoundRobinPairs(uniqueClubIds, groupRounds)
  const alignedStartDate = alignDateToWeekday(new Date(input.startDateISO), input.matchDayOfWeek)
  const kickoffDate = applyTimeToDate(alignedStartDate, input.matchTime)
  const matchesPerRound = new Map<number, number>()
  for (const pair of pairs) {
    matchesPerRound.set(pair.roundIndex, (matchesPerRound.get(pair.roundIndex) ?? 0) + 1)
  }
  const totalRounds = isGroupStageFormat
    ? 0
    : pairs.reduce((max, pair) => Math.max(max, pair.roundIndex), 0) + (pairs.length ? 1 : 0)

  let maxMatchesInRound = 1
  for (const count of matchesPerRound.values()) {
    if (count > maxMatchesInRound) {
      maxMatchesInRound = count
    }
  }

  const seasonEndBase = totalRounds > 0 ? addDays(kickoffDate, (totalRounds - 1) * 7) : kickoffDate
  const seasonEndDate =
    maxMatchesInRound > 1
      ? addMinutes(seasonEndBase, (maxMatchesInRound - 1) * MATCH_INTERVAL_MINUTES)
      : seasonEndBase

  // Определяем параметры для кубка
  const groupRoundsValue = Math.max(1, Math.min(2, input.groupRounds ?? 1))
  const playoffBestOfValue = [1, 3, 5, 7].includes(input.playoffBestOf ?? 1)
    ? (input.playoffBestOf ?? 1)
    : 1

  const season = await prisma.$transaction(async tx => {
    const createdSeason = await tx.season.create({
      data: {
        competitionId: input.competition.id,
        name: input.seasonName.trim(),
        startDate: kickoffDate,
        endDate: seasonEndDate,
        city: seasonCity,
        seriesFormat: input.seriesFormat,
        groupRounds: isGroupStageFormat ? groupRoundsValue : 1,
        playoffBestOf: playoffBestOfValue,
      },
    })

    const participantsData = uniqueClubIds.map(clubId => ({ seasonId: createdSeason.id, clubId }))
    let participantsCreated = 0
    if (participantsData.length) {
      const result = await tx.seasonParticipant.createMany({
        data: participantsData,
        skipDuplicates: true,
      })
      participantsCreated = result.count
    }

    if (participantsData.length) {
      const statsPayload = uniqueClubIds.map(clubId => ({
        seasonId: createdSeason.id,
        clubId,
        points: 0,
        wins: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      }))
      await tx.clubSeasonStats.createMany({ data: statsPayload, skipDuplicates: true })
    }

    let rosterEntriesCreated = 0
    const clubPlayers = await tx.clubPlayer.findMany({
      where: { clubId: { in: uniqueClubIds } },
      orderBy: [{ clubId: 'asc' }, { defaultShirtNumber: 'asc' }, { personId: 'asc' }],
    })

    if (clubPlayers.length) {
      const clubToNumbers = new Map<number, Set<number>>()
      const rosterPayload: {
        seasonId: number
        clubId: number
        personId: number
        shirtNumber: number
        registrationDate: Date
      }[] = []

      for (const player of clubPlayers) {
        const takenNumbers = clubToNumbers.get(player.clubId) ?? new Set<number>()
        if (!clubToNumbers.has(player.clubId)) {
          clubToNumbers.set(player.clubId, takenNumbers)
        }
        let shirtNumber = player.defaultShirtNumber ?? 0
        if (shirtNumber && takenNumbers.has(shirtNumber)) {
          shirtNumber = 0
        }
        if (!shirtNumber || shirtNumber <= 0) {
          shirtNumber = 1
          while (takenNumbers.has(shirtNumber)) {
            shirtNumber += 1
          }
        }
        takenNumbers.add(shirtNumber)
        rosterPayload.push({
          seasonId: createdSeason.id,
          clubId: player.clubId,
          personId: player.personId,
          shirtNumber,
          registrationDate: new Date(),
        })
      }

      if (rosterPayload.length) {
        const result = await tx.seasonRoster.createMany({
          data: rosterPayload,
          skipDuplicates: true,
        })
        rosterEntriesCreated = result.count
      }
    }

    const isRandomPlayoff = input.seriesFormat === ('PLAYOFF_BRACKET' as SeriesFormat)
    const roundIndexToId = new Map<number, number>()
    if (!isGroupStageFormat && !isRandomPlayoff && totalRounds > 0) {
      for (let roundIndex = 0; roundIndex < totalRounds; roundIndex += 1) {
        const label = `${roundIndex + 1} тур`
        const existing = await tx.seasonRound.findFirst({
          where: { seasonId: createdSeason.id, label },
        })
        const round =
          existing ??
          (await tx.seasonRound.create({
            data: {
              seasonId: createdSeason.id,
              roundType: RoundType.REGULAR,
              roundNumber: roundIndex + 1,
              label,
            },
          }))
        roundIndexToId.set(roundIndex, round.id)
      }
    }

    let matchesCreated = 0
    let seriesCreated = 0
    let groupsCreated = 0
    let groupSlotsCreated = 0
    const bracketByeSeries: PlayoffByePlan[] = []

    if (isGroupStageFormat && validatedGroupStage) {
      const groupStageResult = await createGroupStageSchedule(tx, {
        seasonId: createdSeason.id,
        seasonStart: kickoffDate,
        matchTime: input.matchTime ?? null,
        groups: validatedGroupStage.groups,
        groupRounds: groupRoundsValue,
      })
      matchesCreated += groupStageResult.matchesCreated
      groupsCreated += groupStageResult.groupsCreated
      groupSlotsCreated += groupStageResult.groupSlotsCreated

      if (
        groupStageResult.lastMatchDate &&
        groupStageResult.lastMatchDate > createdSeason.endDate
      ) {
        await tx.season.update({
          where: { id: createdSeason.id },
          data: { endDate: groupStageResult.lastMatchDate },
        })
        createdSeason.endDate = groupStageResult.lastMatchDate
      }
    } else if (isRandomPlayoff) {
      const { plans, byeSeries } = createRandomPlayoffPlans(
        uniqueClubIds,
        kickoffDate,
        input.matchTime,
        1
      )
      if (byeSeries.length) {
        bracketByeSeries.push(...byeSeries)
      }
      let latestMatchDate: Date | null = null

      for (const plan of plans) {
        let playoffRound = await tx.seasonRound.findFirst({
          where: { seasonId: createdSeason.id, label: plan.stageName },
        })
        if (!playoffRound) {
          playoffRound = await tx.seasonRound.create({
            data: {
              seasonId: createdSeason.id,
              roundType: RoundType.PLAYOFF,
              roundNumber: null,
              label: plan.stageName,
            },
          })
        }

        const series = await tx.matchSeries.create({
          data: {
            seasonId: createdSeason.id,
            stageName: plan.stageName,
            homeClubId: plan.homeClubId,
            awayClubId: plan.awayClubId,
            seriesStatus: SeriesStatus.IN_PROGRESS,
            homeSeed: plan.homeSeed,
            awaySeed: plan.awaySeed,
            bracketSlot: plan.targetSlot,
          },
        })
        seriesCreated += 1

        const seriesMatches = plan.matchDateTimes.map((date, index) => {
          if (!latestMatchDate || date > latestMatchDate) {
            latestMatchDate = date
          }
          return {
            seasonId: createdSeason.id,
            matchDateTime: date,
            homeTeamId: plan.homeClubId,
            awayTeamId: plan.awayClubId,
            status: MatchStatus.SCHEDULED,
            seriesId: series.id,
            seriesMatchNumber: index + 1,
            roundId: playoffRound?.id ?? null,
          }
        })

        if (seriesMatches.length) {
          const result = await tx.match.createMany({ data: seriesMatches })
          matchesCreated += result.count
        }
      }

      if (byeSeries.length) {
        const fallbackStage =
          plans[0]?.stageName ?? stageNameForTeams(Math.max(2, uniqueClubIds.length))
        for (const bye of byeSeries) {
          await tx.matchSeries.create({
            data: {
              seasonId: createdSeason.id,
              stageName: fallbackStage,
              homeClubId: bye.clubId,
              awayClubId: bye.clubId,
              seriesStatus: SeriesStatus.FINISHED,
              winnerClubId: bye.clubId,
              homeSeed: bye.seed,
              awaySeed: bye.seed,
              bracketSlot: bye.targetSlot,
            },
          })
          seriesCreated += 1
        }
      }

      if (latestMatchDate) {
        await tx.season.update({
          where: { id: createdSeason.id },
          data: { endDate: latestMatchDate },
        })
        createdSeason.endDate = latestMatchDate
      }
    } else {
      const roundMatchCounters = new Map<number, number>()
      const matchPayload = pairs.map(pair => {
        const matchDay = addDays(kickoffDate, pair.roundIndex * 7)
        const scheduledBase = applyTimeToDate(matchDay, input.matchTime)
        const matchIndexInRound = roundMatchCounters.get(pair.roundIndex) ?? 0
        const matchDate =
          matchIndexInRound === 0
            ? scheduledBase
            : addMinutes(scheduledBase, matchIndexInRound * MATCH_INTERVAL_MINUTES)
        roundMatchCounters.set(pair.roundIndex, matchIndexInRound + 1)
        return {
          seasonId: createdSeason.id,
          matchDateTime: matchDate,
          homeTeamId: pair.homeClubId,
          awayTeamId: pair.awayClubId,
          status: MatchStatus.SCHEDULED,
          roundId: roundIndexToId.get(pair.roundIndex) ?? null,
        }
      })

      if (matchPayload.length) {
        const result = await tx.match.createMany({ data: matchPayload })
        matchesCreated += result.count
      }
    }

    logger.info(
      {
        seasonId: createdSeason.id,
        participantsCreated,
        matchesCreated,
        rosterEntriesCreated,
        seriesCreated,
        groupsCreated,
        groupSlotsCreated,
        format: input.seriesFormat,
        byeSeries: bracketByeSeries,
      },
      'season automation completed'
    )

    return {
      season: createdSeason,
      stats: {
        participantsCreated,
        matchesCreated,
        rosterEntriesCreated,
        seriesCreated,
        groupsCreated,
        groupSlotsCreated,
      },
    }
  })

  return {
    seasonId: season.season.id,
    participantsCreated: season.stats.participantsCreated,
    matchesCreated: season.stats.matchesCreated,
    rosterEntriesCreated: season.stats.rosterEntriesCreated,
    seriesCreated: season.stats.seriesCreated,
    groupsCreated: season.stats.groupsCreated,
    groupSlotsCreated: season.stats.groupSlotsCreated,
  }
}

type GroupStageCreationResult = {
  matchesCreated: number
  groupsCreated: number
  groupSlotsCreated: number
  lastMatchDate: Date | null
}

const createGroupStageSchedule = async (
  tx: Prisma.TransactionClient,
  params: {
    seasonId: number
    seasonStart: Date
    matchTime: string | null | undefined
    groups: GroupStageGroupInput[]
    groupRounds?: number
  }
): Promise<GroupStageCreationResult> => {
  let matchesCreated = 0
  let groupsCreated = 0
  let groupSlotsCreated = 0
  let latestMatchDate: Date | null = null

  // Количество кругов: 1 или 2 (по умолчанию 1)
  const roundsPerGroup = Math.max(1, Math.min(2, params.groupRounds ?? 1))

  for (const group of params.groups) {
    const seasonGroup = await tx.seasonGroup.create({
      data: {
        seasonId: params.seasonId,
        groupIndex: group.groupIndex,
        label: group.label.trim(),
        qualifyCount: group.qualifyCount,
      },
    })
    groupsCreated += 1

    const slotsPayload = group.slots.map(slot => ({
      groupId: seasonGroup.id,
      position: slot.position,
      clubId: slot.clubId,
    }))
    if (slotsPayload.length) {
      const createdSlots = await tx.seasonGroupSlot.createMany({
        data: slotsPayload,
        skipDuplicates: true,
      })
      groupSlotsCreated += createdSlots.count
    }

    const clubIds = group.slots.map(slot => slot.clubId)
    // Генерируем пары с учетом количества кругов
    const pairs = generateRoundRobinPairs(clubIds, roundsPerGroup)
    if (!pairs.length) {
      continue
    }

    const roundCache = new Map<number, number>()
    const matchesPayload: Array<{
      seasonId: number
      matchDateTime: Date
      homeTeamId: number
      awayTeamId: number
      status: MatchStatus
      roundId: number | null
      groupId: number
    }> = []

    const roundMatchCounters = new Map<number, number>()

    for (const pair of pairs) {
      let roundId = roundCache.get(pair.roundIndex) ?? null
      if (!roundId) {
        const round = await tx.seasonRound.create({
          data: {
            seasonId: params.seasonId,
            roundType: RoundType.REGULAR,
            roundNumber: pair.roundIndex + 1,
            label: `${group.label.trim()} — тур ${pair.roundIndex + 1}`,
            groupId: seasonGroup.id,
          },
        })
        roundId = round.id
        roundCache.set(pair.roundIndex, roundId)
      }

      const baseDate = addDays(params.seasonStart, pair.roundIndex * 7)
      const scheduledBase = applyTimeToDate(baseDate, params.matchTime)
      const matchIndexInRound = roundMatchCounters.get(pair.roundIndex) ?? 0
      const scheduled =
        matchIndexInRound === 0
          ? scheduledBase
          : addMinutes(scheduledBase, matchIndexInRound * MATCH_INTERVAL_MINUTES)
      roundMatchCounters.set(pair.roundIndex, matchIndexInRound + 1)
      if (!latestMatchDate || scheduled > latestMatchDate) {
        latestMatchDate = scheduled
      }

      matchesPayload.push({
        seasonId: params.seasonId,
        matchDateTime: scheduled,
        homeTeamId: pair.homeClubId,
        awayTeamId: pair.awayClubId,
        status: MatchStatus.SCHEDULED,
        roundId,
        groupId: seasonGroup.id,
      })
    }

    if (matchesPayload.length) {
      const result = await tx.match.createMany({ data: matchesPayload })
      matchesCreated += result.count
    }
  }

  return {
    matchesCreated,
    groupsCreated,
    groupSlotsCreated,
    lastMatchDate: latestMatchDate,
  }
}

type GroupStandingRow = {
  clubId: number
  points: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
}

type HeadToHeadRecord = {
  points: number
  goalsFor: number
  goalsAgainst: number
}

const buildGroupStandings = (
  clubIds: number[],
  matches: Array<{
    homeTeamId: number
    awayTeamId: number
    homeScore: number
    awayScore: number
    status: MatchStatus
  }>
): GroupStandingRow[] => {
  const clubSet = new Set(clubIds)
  const statsMap = new Map<number, GroupStandingRow>()
  const headToHead = new Map<number, Map<number, HeadToHeadRecord>>()

  const ensureRow = (clubId: number): GroupStandingRow => {
    let row = statsMap.get(clubId)
    if (!row) {
      row = {
        clubId,
        points: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      }
      statsMap.set(clubId, row)
    }
    return row
  }

  const ensureHeadToHead = (clubId: number, opponentId: number): HeadToHeadRecord => {
    let opponents = headToHead.get(clubId)
    if (!opponents) {
      opponents = new Map<number, HeadToHeadRecord>()
      headToHead.set(clubId, opponents)
    }
    let record = opponents.get(opponentId)
    if (!record) {
      record = { points: 0, goalsFor: 0, goalsAgainst: 0 }
      opponents.set(opponentId, record)
    }
    return record
  }

  for (const id of clubSet) {
    ensureRow(id)
  }

  for (const match of matches) {
    if (match.status !== MatchStatus.FINISHED) continue
    if (!clubSet.has(match.homeTeamId) || !clubSet.has(match.awayTeamId)) continue

    const home = ensureRow(match.homeTeamId)
    const away = ensureRow(match.awayTeamId)

    home.goalsFor += match.homeScore
    home.goalsAgainst += match.awayScore
    away.goalsFor += match.awayScore
    away.goalsAgainst += match.homeScore

    const homeRecord = ensureHeadToHead(match.homeTeamId, match.awayTeamId)
    const awayRecord = ensureHeadToHead(match.awayTeamId, match.homeTeamId)

    homeRecord.goalsFor += match.homeScore
    homeRecord.goalsAgainst += match.awayScore
    awayRecord.goalsFor += match.awayScore
    awayRecord.goalsAgainst += match.homeScore

    if (match.homeScore > match.awayScore) {
      home.points += 3
      home.wins += 1
      away.losses += 1
      homeRecord.points += 3
    } else if (match.homeScore < match.awayScore) {
      away.points += 3
      away.wins += 1
      home.losses += 1
      awayRecord.points += 3
    } else {
      home.points += 1
      away.points += 1
      home.draws += 1
      away.draws += 1
      homeRecord.points += 1
      awayRecord.points += 1
    }
  }

  const getHeadToHead = (clubId: number, opponentId: number): HeadToHeadRecord => {
    return headToHead.get(clubId)?.get(opponentId) ?? { points: 0, goalsFor: 0, goalsAgainst: 0 }
  }

  const rows = Array.from(statsMap.values())
  rows.sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points

    const leftVsRight = getHeadToHead(left.clubId, right.clubId)
    const rightVsLeft = getHeadToHead(right.clubId, left.clubId)

    if (rightVsLeft.points !== leftVsRight.points) return rightVsLeft.points - leftVsRight.points

    const leftHeadDiff = leftVsRight.goalsFor - leftVsRight.goalsAgainst
    const rightHeadDiff = rightVsLeft.goalsFor - rightVsLeft.goalsAgainst
    if (rightHeadDiff !== leftHeadDiff) return rightHeadDiff - leftHeadDiff

    if (
      rightVsLeft.goalsFor - rightVsLeft.goalsAgainst !==
      leftVsRight.goalsFor - leftVsRight.goalsAgainst
    ) {
      return (
        rightVsLeft.goalsFor -
        rightVsLeft.goalsAgainst -
        (leftVsRight.goalsFor - leftVsRight.goalsAgainst)
      )
    }
    if (rightVsLeft.goalsFor !== leftVsRight.goalsFor)
      return rightVsLeft.goalsFor - leftVsRight.goalsFor
    if (leftVsRight.goalsAgainst !== rightVsLeft.goalsAgainst)
      return leftVsRight.goalsAgainst - rightVsLeft.goalsAgainst

    const leftDiff = left.goalsFor - left.goalsAgainst
    const rightDiff = right.goalsFor - right.goalsAgainst
    if (rightDiff !== leftDiff) return rightDiff - leftDiff

    if (right.goalsFor !== left.goalsFor) return right.goalsFor - left.goalsFor

    return left.clubId - right.clubId
  })

  return rows
}

type SeasonGroupWithSlots = Prisma.SeasonGroupGetPayload<{
  include: { slots: true }
}>

type GroupMatchSummary = {
  groupId: number | null
  homeTeamId: number
  awayTeamId: number
  homeScore: number
  awayScore: number
  status: MatchStatus
}

type GroupPlayoffSeed = {
  clubId: number
  groupIndex: number
  placement: number
  points: number
  goalDiff: number
  goalsFor: number
  wins: number
  preRank: number
  seedPosition: number
}

const computeGroupPlayoffSeeds = (
  groups: SeasonGroupWithSlots[],
  matches: GroupMatchSummary[]
): GroupPlayoffSeed[] => {
  if (!groups.length) {
    throw new Error('group_playoffs_not_configured')
  }

  const matchesByGroup = new Map<number, GroupMatchSummary[]>()
  for (const match of matches) {
    if (typeof match.groupId !== 'number') continue
    if (!matchesByGroup.has(match.groupId)) {
      matchesByGroup.set(match.groupId, [])
    }
    matchesByGroup.get(match.groupId)!.push(match)
  }

  const seeds: Array<{
    clubId: number
    groupIndex: number
    placement: number
    points: number
    wins: number
    goalDiff: number
    goalsFor: number
    goalsAgainst: number
    preRank: number
  }> = []

  for (const group of groups) {
    if (group.qualifyCount < 1) {
      throw new Error('group_playoffs_incomplete')
    }
    const filledSlots = group.slots.filter(
      slot => typeof slot.clubId === 'number' && slot.clubId && slot.clubId > 0
    )
    if (filledSlots.length < group.qualifyCount) {
      throw new Error('group_playoffs_incomplete')
    }

    const clubIds = filledSlots.map(slot => Number(slot.clubId))
    const groupMatches = matchesByGroup.get(group.id) ?? []
    const standings = buildGroupStandings(clubIds, groupMatches)

    if (standings.length < group.qualifyCount) {
      throw new Error('group_playoffs_results_incomplete')
    }

    const slotRankByClub = new Map<number, number>()
    for (const slot of group.slots) {
      if (typeof slot.clubId === 'number' && slot.clubId > 0) {
        slotRankByClub.set(slot.clubId, slot.position)
      }
    }

    for (let index = 0; index < group.qualifyCount; index += 1) {
      const row = standings[index]
      const goalDiff = row.goalsFor - row.goalsAgainst
      const slotRank = slotRankByClub.get(row.clubId) ?? index + 1
      const preRank = group.groupIndex * 100 + slotRank
      seeds.push({
        clubId: row.clubId,
        groupIndex: group.groupIndex,
        placement: index + 1,
        points: row.points,
        wins: row.wins,
        goalDiff,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        preRank,
      })
    }
  }

  if (seeds.length < 2) {
    throw new Error('not_enough_pairs')
  }

  seeds.sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points
    if (right.goalDiff !== left.goalDiff) return right.goalDiff - left.goalDiff
    if (right.goalsFor !== left.goalsFor) return right.goalsFor - left.goalsFor
    if (left.preRank !== right.preRank) return left.preRank - right.preRank
    if (right.wins !== left.wins) return right.wins - left.wins
    return left.clubId - right.clubId
  })

  return seeds.map((entry, index) => ({
    clubId: entry.clubId,
    groupIndex: entry.groupIndex,
    placement: entry.placement,
    points: entry.points,
    goalDiff: entry.goalDiff,
    goalsFor: entry.goalsFor,
    wins: entry.wins,
    preRank: entry.preRank,
    seedPosition: index + 1,
  }))
}

export type PlayoffCreationResult = {
  seriesCreated: number
  matchesCreated: number
  byeSeries?: PlayoffByePlan[]
}

export const createSeasonPlayoffs = async (
  prisma: PrismaClient,
  logger: FastifyBaseLogger,
  input: { seasonId: number; bestOfLength?: number }
): Promise<PlayoffCreationResult> => {
  const { seasonId } = input

  return prisma.$transaction(async tx => {
    const season = await tx.season.findUnique({
      where: { id: seasonId },
      include: { competition: true },
    })

    if (!season) {
      throw new Error('season_not_found')
    }
    const seasonFormat = getSeasonSeriesFormat(season)
    const isGroupPlayoffFormat = seasonFormat === SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF

    if (
      seasonFormat !== SeriesFormat.BEST_OF_N &&
      seasonFormat !== SeriesFormat.DOUBLE_ROUND_PLAYOFF &&
      !isGroupPlayoffFormat
    ) {
      throw new Error('playoffs_not_supported')
    }

    const existingSeries = await tx.matchSeries.count({ where: { seasonId } })
    if (existingSeries > 0) {
      throw new Error('series_already_exist')
    }

    const unfinishedMatches = await tx.match.count({
      where: { seasonId, NOT: { status: MatchStatus.FINISHED } },
    })
    if (unfinishedMatches > 0) {
      throw new Error('matches_not_finished')
    }

    const participants = await tx.seasonParticipant.findMany({
      where: { seasonId },
      include: { club: true },
    })
    if (participants.length < 2) {
      throw new Error('not_enough_participants')
    }

    let seededClubIds: number[] = []
    let groupSeedDetails: GroupPlayoffSeed[] | null = null
    let bestOfLength = 1

    if (isGroupPlayoffFormat) {
      const groups = await tx.seasonGroup.findMany({
        where: { seasonId },
        include: { slots: true },
      })

      if (!groups.length) {
        throw new Error('group_playoffs_not_configured')
      }

      const groupMatchSummaries = await tx.match.findMany({
        where: { seasonId },
        select: {
          groupId: true,
          homeTeamId: true,
          awayTeamId: true,
          homeScore: true,
          awayScore: true,
          status: true,
        },
      })

      groupSeedDetails = computeGroupPlayoffSeeds(groups, groupMatchSummaries)
      seededClubIds = groupSeedDetails.map(entry => entry.clubId)
      bestOfLength = 1
    } else {
      const stats = await tx.clubSeasonStats.findMany({
        where: { seasonId },
        orderBy: [
          { points: 'desc' },
          { wins: 'desc' },
          { goalsFor: 'desc' },
          { goalsAgainst: 'asc' },
        ],
      })

      const statsMap = new Map<number, (typeof stats)[number]>()
      for (const stat of stats) {
        statsMap.set(stat.clubId, stat)
      }

      for (const participant of participants) {
        if (!statsMap.has(participant.clubId)) {
          const zeroStat = await tx.clubSeasonStats.upsert({
            where: { seasonId_clubId: { seasonId, clubId: participant.clubId } },
            create: {
              seasonId,
              clubId: participant.clubId,
              points: 0,
              wins: 0,
              losses: 0,
              goalsFor: 0,
              goalsAgainst: 0,
            },
            update: {},
          })
          statsMap.set(participant.clubId, zeroStat)
        }
      }

      const compareClubs = (left: number, right: number): number => {
        const l = statsMap.get(left) ?? {
          points: 0,
          wins: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
        }
        const r = statsMap.get(right) ?? {
          points: 0,
          wins: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
        }
        if (l.points !== r.points) return r.points - l.points
        if (l.wins !== r.wins) return r.wins - l.wins
        const lDiff = l.goalsFor - l.goalsAgainst
        const rDiff = r.goalsFor - r.goalsAgainst
        if (lDiff !== rDiff) return rDiff - lDiff
        if (l.goalsFor !== r.goalsFor) return r.goalsFor - l.goalsFor
        return l.goalsAgainst - r.goalsAgainst
      }

      seededClubIds = participants.map(participant => participant.clubId).sort(compareClubs)

      const configuredBestOf =
        input.bestOfLength && input.bestOfLength >= 3 ? input.bestOfLength : 3
      bestOfLength = toOdd(configuredBestOf)
    }

    const lastMatch = await tx.match.findFirst({
      where: { seasonId },
      orderBy: { matchDateTime: 'desc' },
    })
    const matchTime = lastMatch
      ? `${String(lastMatch.matchDateTime.getHours()).padStart(2, '0')}:${String(
          lastMatch.matchDateTime.getMinutes()
        ).padStart(2, '0')}`
      : null
    const playoffStart = addDays(season.endDate, 7)

    const { plans, byeSeries } = createInitialPlayoffPlans(
      seededClubIds,
      playoffStart,
      matchTime,
      bestOfLength
    )
    if (plans.length === 0 && byeSeries.length === 0) {
      throw new Error('not_enough_pairs')
    }

    let latestDate: Date | null = null
    let matchesCreated = 0
    let seriesCreated = 0

    const roundCache = new Map<string, number>()
    const ensurePlayoffRound = async (label: string): Promise<number> => {
      if (roundCache.has(label)) {
        return roundCache.get(label) as number
      }
      let playoffRound = await tx.seasonRound.findFirst({
        where: { seasonId, label },
      })
      if (!playoffRound) {
        playoffRound = await tx.seasonRound.create({
          data: {
            seasonId,
            roundType: RoundType.PLAYOFF,
            roundNumber: null,
            label,
          },
        })
      }
      roundCache.set(label, playoffRound.id)
      return playoffRound.id
    }

    for (const plan of plans) {
      const roundId = await ensurePlayoffRound(plan.stageName)

      const series = await tx.matchSeries.create({
        data: {
          seasonId,
          stageName: plan.stageName,
          homeClubId: plan.homeClubId,
          awayClubId: plan.awayClubId,
          seriesStatus: SeriesStatus.IN_PROGRESS,
          homeSeed: plan.homeSeed,
          awaySeed: plan.awaySeed,
          bracketSlot: plan.targetSlot,
        },
      })
      seriesCreated += 1

      const seriesMatches = plan.matchDateTimes.map((date, index) => {
        if (!latestDate || date > latestDate) {
          latestDate = date
        }
        return {
          seasonId,
          matchDateTime: date,
          homeTeamId: index % 2 === 0 ? plan.homeClubId : plan.awayClubId,
          awayTeamId: index % 2 === 0 ? plan.awayClubId : plan.homeClubId,
          status: MatchStatus.SCHEDULED,
          seriesId: series.id,
          seriesMatchNumber: index + 1,
          roundId,
        }
      })

      if (seriesMatches.length) {
        const created = await tx.match.createMany({ data: seriesMatches })
        matchesCreated += created.count
      }
    }

    if (byeSeries.length) {
      const stageLabel = plans[0]?.stageName ?? stageNameForTeams(seededClubIds.length)
      await ensurePlayoffRound(stageLabel)
      for (const bye of byeSeries) {
        await tx.matchSeries.create({
          data: {
            seasonId,
            stageName: stageLabel,
            homeClubId: bye.clubId,
            awayClubId: bye.clubId,
            seriesStatus: SeriesStatus.FINISHED,
            winnerClubId: bye.clubId,
            homeSeed: bye.seed,
            awaySeed: bye.seed,
            bracketSlot: bye.targetSlot,
          },
        })
        seriesCreated += 1
      }
    }

    if (latestDate) {
      await tx.season.update({ where: { id: seasonId }, data: { endDate: latestDate } })
    }

    logger.info(
      { seasonId, seriesCreated, matchesCreated, byeSeries, groupSeedDetails },
      'playoff series created'
    )

    return {
      seriesCreated,
      matchesCreated,
      byeSeries: byeSeries.length ? byeSeries : undefined,
    }
  })
}
