import { FastifyBaseLogger } from 'fastify'
import {
  AchievementMetric,
  BracketType,
  ClubSeasonStats,
  CompetitionType,
  DisqualificationReason,
  Match,
  MatchEvent,
  MatchEventType,
  MatchSeries,
  MatchStatus,
  PredictionEntryStatus,
  PredictionResult,
  Prisma,
  RoundType,
  RatingScope,
  SeriesFormat,
  SeriesStatus,
} from '@prisma/client'
import prisma from '../db'
import { defaultCache, resolveCacheOptions, PUBLIC_LEAGUE_TABLE_KEY, PUBLIC_LEAGUE_SCHEDULE_KEY, PUBLIC_LEAGUE_RESULTS_KEY } from '../cache'
import { buildLeagueTable } from './leagueTable'
import { refreshLeagueMatchAggregates } from './leagueSchedule'
import { refreshLeagueStats } from './leagueStats'
import { publicClubSummaryKey, refreshClubSummary } from './clubSummary'
import { invalidateClubMatchesCache } from './clubMatches'
import { USER_PREDICTION_CACHE_KEY, PREDICTION_UPCOMING_MAX_DAYS } from './predictionConstants'
import { incrementAchievementProgress } from './achievementProgress'
import {
  addDays,
  applyTimeToDate,
  createInitialPlayoffPlans,
  stageNameForTeams,
} from './seasonAutomation'
import { settlePredictionEntries } from './predictionSettlement'
import {
  recalculateUserRatings,
  ratingPublicCacheKey,
} from './ratingAggregation'
import { RATING_DEFAULT_PAGE_SIZE } from './ratingConstants'
import { ensurePredictionTemplatesForMatch } from './predictionTemplateService'
import {
  CUP_STAGE_NAMES,
  createGoldSemiFinalPlans,
  createSilverSemiFinalPlans,
  createGoldFinalPlans,
  createSilverFinalPlans,
} from './cupBracketLogic'

const YELLOW_CARD_LIMIT = 4
const RED_CARD_BAN_MATCHES = 2
const SECOND_YELLOW_BAN_MATCHES = 1

type MatchOutcomeSource = Pick<
  Match,
  | 'homeTeamId'
  | 'awayTeamId'
  | 'homeScore'
  | 'awayScore'
  | 'hasPenaltyShootout'
  | 'penaltyHomeScore'
  | 'penaltyAwayScore'
>

const resolveSeasonSeriesFormat = (season: {
  seriesFormat?: SeriesFormat | null
  competition: { seriesFormat: SeriesFormat }
}): SeriesFormat =>
  (season.seriesFormat as SeriesFormat | null | undefined) ?? season.competition.seriesFormat

const determineMatchWinnerClubId = (match: MatchOutcomeSource): number | null => {
  if (match.homeScore > match.awayScore) return match.homeTeamId
  if (match.homeScore < match.awayScore) return match.awayTeamId
  if (match.hasPenaltyShootout) {
    if (match.penaltyHomeScore > match.penaltyAwayScore) return match.homeTeamId
    if (match.penaltyHomeScore < match.penaltyAwayScore) return match.awayTeamId
  }
  return null
}

type FinalizationOptions = {
  publishTopic?: (topic: string, payload: unknown) => Promise<unknown>
}

type PredictionSettlementResult = {
  userIds: Set<number>
  settled: number
  won: number
  lost: number
  voided: number
  cancelled: number
  winsByUser: Map<number, number>
}

export async function handleMatchFinalization(
  matchId: bigint,
  logger: FastifyBaseLogger,
  options?: FinalizationOptions
)
{
  logger.info({ matchId: matchId.toString() }, 'handleMatchFinalization: starting')
  console.log('[SETTLEMENT DEBUG] handleMatchFinalization called for matchId:', matchId.toString())
  
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      season: { include: { competition: true } },
      events: true,
      lineups: true,
      series: { include: { matches: true } },
      predictions: { include: { user: { include: { achievements: true } } } },
    },
  })

  if (!match) {
    logger.warn({ matchId: matchId.toString() }, 'handleMatchFinalization: match not found')
    console.log('[SETTLEMENT DEBUG] Match not found:', matchId.toString())
    return
  }

  logger.info(
    { matchId: matchId.toString(), status: match.status, homeScore: match.homeScore, awayScore: match.awayScore },
    'handleMatchFinalization: match loaded'
  )
  console.log('[SETTLEMENT DEBUG] Match loaded:', {
    matchId: matchId.toString(),
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    seasonId: match.seasonId,
  })

  if (match.status !== MatchStatus.FINISHED) {
    logger.info(
      { matchId: matchId.toString(), status: match.status },
      'match not finished, skip aggregation'
    )
    console.log('[SETTLEMENT DEBUG] Match not finished, skipping. Status:', match.status)
    return
  }

  if (match.seasonId == null || !match.season) {
    logger.info(
      { matchId: matchId.toString() },
      'match has no season, skip aggregation'
    )
    return
  }

  const seasonId = match.seasonId

  // Инвалидируем кэш расписания и результатов сразу при завершении матча,
  // чтобы гарантировать, что клиенты получат актуальные данные
  await Promise.all([
    defaultCache.invalidate(PUBLIC_LEAGUE_SCHEDULE_KEY).catch(() => undefined),
    defaultCache.invalidate(`${PUBLIC_LEAGUE_SCHEDULE_KEY}:${seasonId}`).catch(() => undefined),
    defaultCache.invalidate(PUBLIC_LEAGUE_RESULTS_KEY).catch(() => undefined),
    defaultCache.invalidate(`${PUBLIC_LEAGUE_RESULTS_KEY}:${seasonId}`).catch(() => undefined),
  ])
  const competitionFormat = resolveSeasonSeriesFormat(match.season)
  const isBracketFormat =
    competitionFormat === ('PLAYOFF_BRACKET' as SeriesFormat) ||
    competitionFormat === SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF
  let predictionSettlement: PredictionSettlementResult | null = null

  await prisma.$transaction(
    async tx => {
      // Блокируем матч на время транзакции для предотвращения race condition
      // при одновременном завершении матча несколькими админами
      // Используем реальные имена таблицы и колонки из Prisma (@@map / @map)
      // В БД таблица называется "match", PK колонка — "match_id"
      await tx.$executeRaw`SELECT "match_id" FROM "match" WHERE "match_id" = ${matchId} FOR UPDATE`
      
      const includePlayoffRounds = isBracketFormat
      await rebuildClubSeasonStats(seasonId, tx, { includePlayoffRounds })
      await rebuildPlayerSeasonStats(seasonId, tx)
      await rebuildPlayerCareerStats(seasonId, tx)
      await processDisqualifications(match, tx)
      predictionSettlement = await updatePredictions(
        match as MatchWithPredictions,
        tx,
        logger
      )
      if (match.seriesId) {
        await updateSeriesState(match as SeriesMatch, tx, logger)
      }
    },
    { timeout: 20000 }
  )

  let settledUserIds: number[] = []
  if (predictionSettlement) {
    const settlementUserIds = (predictionSettlement as PredictionSettlementResult).userIds
    if (settlementUserIds.size > 0) {
      settledUserIds = Array.from(settlementUserIds.values())
    }
  }

  if (settledUserIds.length > 0) {
    try {
      await recalculateUserRatings({ userIds: settledUserIds })
    } catch (err) {
      logger.error({ err, matchId: match.id.toString() }, 'failed to recalculate user ratings')
    }

    const ratingCacheKeys = [
      ratingPublicCacheKey(RatingScope.CURRENT, 1, RATING_DEFAULT_PAGE_SIZE),
      ratingPublicCacheKey(RatingScope.YEARLY, 1, RATING_DEFAULT_PAGE_SIZE),
    ]

    const userCacheKeys = settledUserIds.flatMap(userId => [
      `user:rating:${userId}`,
      USER_PREDICTION_CACHE_KEY(userId),
    ])

    await Promise.all(
      [
        ...ratingCacheKeys.map(key => defaultCache.invalidate(key).catch(() => undefined)),
        ...userCacheKeys.map(key => defaultCache.invalidate(key).catch(() => undefined)),
      ]
    )
  }

  // invalidate caches related to season/club summaries
  const impactedClubIds = new Set<number>()
  if (match.homeTeamId) impactedClubIds.add(match.homeTeamId)
  if (match.awayTeamId) impactedClubIds.add(match.awayTeamId)
  for (const lineup of match.lineups) {
    if (lineup.clubId) impactedClubIds.add(lineup.clubId)
  }

  const competitionId = match.season.competitionId

  // Инвалидируем только те ключи, которые не будут переустановлены через set() ниже.
  // Ключи таблицы, расписания, результатов и статистики обновляются через set(),
  // что автоматически увеличит версию при изменении fingerprint
  const cacheKeys = [
    `season:${seasonId}:club-stats`,
    `season:${seasonId}:player-stats`,
    `season:${seasonId}:player-career`,
    `competition:${competitionId}:club-stats`,
    `competition:${competitionId}:player-stats`,
    `competition:${competitionId}:club-career`,
    `competition:${competitionId}:player-career`,
    'league:club-career',
    'league:player-career',
    `match:${matchId.toString()}`,
    ...Array.from(impactedClubIds).map(clubId => `club:${clubId}:player-career`),
    ...Array.from(impactedClubIds).map(clubId => publicClubSummaryKey(clubId)),
    // НЕ инвалидируем PUBLIC_LEAGUE_TABLE_KEY, PUBLIC_LEAGUE_STATS_KEY и т.д.
    // потому что они будут обновлены через set() ниже
  ]
  await Promise.all(cacheKeys.map(key => defaultCache.invalidate(key).catch(() => undefined)))

  try {
    const refreshedSeason = await prisma.season.findUnique({
      where: { id: seasonId },
      include: { competition: true },
    })
    if (refreshedSeason) {
      const table = await buildLeagueTable(refreshedSeason)
      const tableOptions = await resolveCacheOptions('leagueTable')
      await Promise.all([
        defaultCache.set(PUBLIC_LEAGUE_TABLE_KEY, table, tableOptions),
        defaultCache.set(`${PUBLIC_LEAGUE_TABLE_KEY}:${seasonId}`, table, tableOptions),
      ])
      await refreshLeagueMatchAggregates(refreshedSeason.id, {
        publishTopic: options?.publishTopic,
      })
      await refreshLeagueStats(refreshedSeason.id, {
        publishTopic: options?.publishTopic,
      })
      if (options?.publishTopic) {
        await options.publishTopic(PUBLIC_LEAGUE_TABLE_KEY, {
          type: 'league.table',
          seasonId: table.season.id,
          payload: table,
        })
      }
    }
  } catch (err) {
    logger.warn({ err, matchId: matchId.toString() }, 'failed to refresh league table cache')
  }

  try {
    const relatedClubIds = Array.from(new Set([match.homeTeamId, match.awayTeamId]))
    if (relatedClubIds.length) {
      const nowUtc = new Date()
      const horizon = new Date(
        nowUtc.getTime() + PREDICTION_UPCOMING_MAX_DAYS * 24 * 60 * 60 * 1000
      )
      const clubConditions = relatedClubIds.flatMap(clubId => [
        { homeTeamId: clubId },
        { awayTeamId: clubId },
      ])

      const upcomingMatches = await prisma.match.findMany({
        where: {
          status: MatchStatus.SCHEDULED,
          matchDateTime: {
            gte: nowUtc,
            lte: horizon,
          },
          OR: clubConditions,
        },
        select: { id: true },
      })

      const uniqueUpcomingIds = new Set<bigint>(upcomingMatches.map(entry => entry.id))
      for (const upcomingId of uniqueUpcomingIds) {
        try {
          await ensurePredictionTemplatesForMatch(upcomingId, prisma)
        } catch (err) {
          logger.warn(
            { err, matchId: upcomingId.toString() },
            'failed to update prediction templates for upcoming match'
          )
        }
      }
    }
  } catch (err) {
    logger.warn(
      { err, matchId: matchId.toString() },
      'failed to refresh upcoming prediction templates after finalization'
    )
  }

  if (impactedClubIds.size) {
    const refreshOptions = options?.publishTopic
      ? { publishTopic: options.publishTopic }
      : undefined

    await Promise.all(
      Array.from(impactedClubIds).map(async clubId => {
        // Инвалидируем кэш матчей клуба
        await invalidateClubMatchesCache(clubId).catch(err => {
          logger.warn({ err, clubId }, 'failed to invalidate club matches cache')
        })
        // Обновляем summary клуба
        return refreshClubSummary(clubId, refreshOptions).catch(err => {
          logger.warn({ err, clubId }, 'failed to refresh club summary')
          return null
        })
      })
    )
  }
}

type PrismaTx = Prisma.TransactionClient

async function rebuildClubSeasonStats(
  seasonId: number,
  tx: PrismaTx,
  options?: { includePlayoffRounds?: boolean }
) {
  const includePlayoffRounds = options?.includePlayoffRounds ?? false

  const finishedMatches = await tx.match.findMany({
    where: {
      seasonId,
      status: MatchStatus.FINISHED,
      isFriendly: false,
      ...(includePlayoffRounds
        ? {}
        : {
            OR: [{ roundId: null }, { round: { roundType: RoundType.REGULAR } }],
          }),
    },
  })

  const totals = new Map<number, ClubSeasonStats>()

  for (const m of finishedMatches) {
    const homeEntry = totals.get(m.homeTeamId) ?? newClubSeasonStats(seasonId, m.homeTeamId)
    const awayEntry = totals.get(m.awayTeamId) ?? newClubSeasonStats(seasonId, m.awayTeamId)

    homeEntry.goalsFor += m.homeScore
    homeEntry.goalsAgainst += m.awayScore
    awayEntry.goalsFor += m.awayScore
    awayEntry.goalsAgainst += m.homeScore

    const winnerClubId = determineMatchWinnerClubId(m)

    if (winnerClubId === m.homeTeamId) {
      homeEntry.points += 3
      homeEntry.wins += 1
      awayEntry.losses += 1
    } else if (winnerClubId === m.awayTeamId) {
      awayEntry.points += 3
      awayEntry.wins += 1
      homeEntry.losses += 1
    } else {
      homeEntry.points += 1
      awayEntry.points += 1
    }

    totals.set(m.homeTeamId, homeEntry)
    totals.set(m.awayTeamId, awayEntry)
  }

  const participants = await tx.seasonParticipant.findMany({
    where: { seasonId },
    select: { clubId: true },
  })

  for (const participant of participants) {
    if (!totals.has(participant.clubId)) {
      totals.set(participant.clubId, newClubSeasonStats(seasonId, participant.clubId))
    }
  }

  const clubIds = Array.from(totals.keys())
  await tx.clubSeasonStats.deleteMany({ where: { seasonId, clubId: { notIn: clubIds } } })

  for (const entry of totals.values()) {
    await tx.clubSeasonStats.upsert({
      where: { seasonId_clubId: { seasonId, clubId: entry.clubId } },
      create: {
        seasonId,
        clubId: entry.clubId,
        points: entry.points,
        wins: entry.wins,
        losses: entry.losses,
        goalsFor: entry.goalsFor,
        goalsAgainst: entry.goalsAgainst,
      },
      update: {
        points: entry.points,
        wins: entry.wins,
        losses: entry.losses,
        goalsFor: entry.goalsFor,
        goalsAgainst: entry.goalsAgainst,
      },
    })
  }
}

function newClubSeasonStats(seasonId: number, clubId: number): ClubSeasonStats {
  return {
    seasonId,
    clubId,
    points: 0,
    wins: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    updatedAt: new Date(),
  }
}

async function rebuildPlayerSeasonStats(seasonId: number, tx: PrismaTx) {
  const events = await tx.matchEvent.findMany({
    where: {
      match: { seasonId, status: MatchStatus.FINISHED, isFriendly: false },
    },
    select: {
      matchId: true,
      playerId: true,
      relatedPlayerId: true,
      teamId: true,
      eventType: true,
    },
  })

  const statsMap = new Map<
    number,
    {
      clubId: number
      goals: number
      penaltyGoals: number
      assists: number
      yellow: number
      red: number
      matches: number
    }
  >()
  const eventMatchesMap = new Map<number, Set<bigint>>()

  for (const ev of events) {
    const primary = statsMap.get(ev.playerId) ?? {
      clubId: ev.teamId,
      goals: 0,
      penaltyGoals: 0,
      assists: 0,
      yellow: 0,
      red: 0,
      matches: 0,
    }
    primary.clubId = ev.teamId
    if (ev.eventType === MatchEventType.GOAL || ev.eventType === MatchEventType.PENALTY_GOAL) {
      primary.goals += 1
      if (ev.eventType === MatchEventType.PENALTY_GOAL) {
        primary.penaltyGoals += 1
      }
    }
    if (ev.eventType === MatchEventType.YELLOW_CARD) {
      primary.yellow += 1
    }
    if (
      ev.eventType === MatchEventType.RED_CARD ||
      ev.eventType === MatchEventType.SECOND_YELLOW_CARD
    ) {
      primary.red += 1
    }
    statsMap.set(ev.playerId, primary)

    const playerMatches = eventMatchesMap.get(ev.playerId) ?? new Set<bigint>()
    playerMatches.add(ev.matchId)
    eventMatchesMap.set(ev.playerId, playerMatches)

    if (
      (ev.eventType === MatchEventType.GOAL || ev.eventType === MatchEventType.PENALTY_GOAL) &&
      ev.relatedPlayerId
    ) {
      const assist = statsMap.get(ev.relatedPlayerId) ?? {
        clubId: ev.teamId,
        goals: 0,
        penaltyGoals: 0,
        assists: 0,
        yellow: 0,
        red: 0,
        matches: 0,
      }
      assist.clubId = ev.teamId
      assist.assists += 1
      statsMap.set(ev.relatedPlayerId, assist)

      const assistMatches = eventMatchesMap.get(ev.relatedPlayerId) ?? new Set<bigint>()
      assistMatches.add(ev.matchId)
      eventMatchesMap.set(ev.relatedPlayerId, assistMatches)
    }
  }

  const lineupAggregates = await tx.matchLineup.groupBy({
    by: ['personId', 'clubId'],
    where: {
      match: { seasonId, status: MatchStatus.FINISHED, isFriendly: false },
    },
    _count: { matchId: true },
  })

  for (const lineup of lineupAggregates) {
    const entry = statsMap.get(lineup.personId) ?? {
      clubId: lineup.clubId,
      goals: 0,
      penaltyGoals: 0,
      assists: 0,
      yellow: 0,
      red: 0,
      matches: 0,
    }
    entry.clubId = lineup.clubId
    entry.matches += lineup._count.matchId ?? 0
    statsMap.set(lineup.personId, entry)
  }

  for (const [personId, matches] of eventMatchesMap.entries()) {
    const entry = statsMap.get(personId)
    if (!entry) continue
    entry.matches = Math.max(entry.matches, matches.size)
    statsMap.set(personId, entry)
  }

  await tx.playerSeasonStats.deleteMany({ where: { seasonId } })

  for (const [personId, entry] of statsMap.entries()) {
    await tx.playerSeasonStats.upsert({
      where: { seasonId_personId: { seasonId, personId } },
      create: {
        seasonId,
        personId,
        clubId: entry.clubId,
        goals: entry.goals,
        penaltyGoals: entry.penaltyGoals,
        assists: entry.assists,
        yellowCards: entry.yellow,
        redCards: entry.red,
        matchesPlayed: entry.matches,
      },
      update: {
        clubId: entry.clubId,
        goals: entry.goals,
        penaltyGoals: entry.penaltyGoals,
        assists: entry.assists,
        yellowCards: entry.yellow,
        redCards: entry.red,
        matchesPlayed: entry.matches,
      },
    })
  }
}

async function rebuildPlayerCareerStats(seasonId: number, tx: PrismaTx) {
  const participants = await tx.seasonParticipant.findMany({
    where: { seasonId },
    select: { clubId: true },
  })

  const clubIds = Array.from(new Set(participants.map(item => item.clubId)))
  if (!clubIds.length) return

  await rebuildCareerStatsForClubs(clubIds, tx)
}

export async function rebuildCareerStatsForClubs(clubIds: number[], tx: PrismaTx) {
  if (!clubIds.length) return

  const aggregates = await tx.playerSeasonStats.groupBy({
    by: ['clubId', 'personId'],
    where: { clubId: { in: clubIds } },
    _sum: {
      goals: true,
      penaltyGoals: true,
      assists: true,
      yellowCards: true,
      redCards: true,
      matchesPlayed: true,
    },
  })

  const recordMap = new Map<string, Prisma.PlayerClubCareerStatsCreateManyInput>()

  for (const aggregate of aggregates) {
    const sum = aggregate._sum ?? {}
    const totalGoals = sum.goals ?? 0
    const totalPenaltyGoals = sum.penaltyGoals ?? 0
    const totalAssists = sum.assists ?? 0
    const yellowCards = sum.yellowCards ?? 0
    const redCards = sum.redCards ?? 0
    const totalMatches = sum.matchesPlayed ?? 0

    recordMap.set(`${aggregate.personId}:${aggregate.clubId}`, {
      personId: aggregate.personId,
      clubId: aggregate.clubId,
      totalGoals,
      penaltyGoals: totalPenaltyGoals,
      totalMatches,
      totalAssists,
      yellowCards,
      redCards,
    })
  }

  const rosterLinks = await tx.clubPlayer.findMany({
    where: { clubId: { in: clubIds } },
    select: { clubId: true, personId: true },
  })

  for (const link of rosterLinks) {
    const key = `${link.personId}:${link.clubId}`
    if (!recordMap.has(key)) {
      recordMap.set(key, {
        personId: link.personId,
        clubId: link.clubId,
        totalGoals: 0,
        penaltyGoals: 0,
        totalMatches: 0,
        totalAssists: 0,
        yellowCards: 0,
        redCards: 0,
      })
    }
  }

  await tx.playerClubCareerStats.deleteMany({ where: { clubId: { in: clubIds } } })

  const payload = Array.from(recordMap.values())
  if (payload.length) {
    await tx.playerClubCareerStats.createMany({ data: payload })
  }
}

type MatchWithEvents = Match & { events: Pick<MatchEvent, 'playerId' | 'teamId' | 'eventType'>[] }

async function processDisqualifications(match: MatchWithEvents, tx: PrismaTx) {
  if (!match.seasonId || match.isFriendly) {
    return
  }

  const { homeTeamId, awayTeamId } = match
  const involvedClubs = [homeTeamId, awayTeamId]

  const activeDisquals = await tx.disqualification.findMany({
    where: { isActive: true, clubId: { in: involvedClubs } },
    select: { id: true, matchesMissed: true, banDurationMatches: true },
  })

  for (const dq of activeDisquals) {
    const newMissed = dq.matchesMissed + 1
    await tx.disqualification.update({
      where: { id: dq.id },
      data: {
        matchesMissed: newMissed,
        isActive: newMissed >= dq.banDurationMatches ? false : true,
      },
    })
  }

  for (const ev of match.events) {
    if (
      ev.eventType === MatchEventType.RED_CARD ||
      ev.eventType === MatchEventType.SECOND_YELLOW_CARD
    ) {
      const reason =
        ev.eventType === MatchEventType.SECOND_YELLOW_CARD
          ? DisqualificationReason.SECOND_YELLOW
          : DisqualificationReason.RED_CARD
      const banDuration =
        ev.eventType === MatchEventType.SECOND_YELLOW_CARD
          ? SECOND_YELLOW_BAN_MATCHES
          : RED_CARD_BAN_MATCHES
      const exists = await tx.disqualification.findFirst({
        where: {
          personId: ev.playerId,
          reason,
          isActive: true,
        },
      })
      if (!exists) {
        await tx.disqualification.create({
          data: {
            personId: ev.playerId,
            clubId: ev.teamId,
            reason,
            sanctionDate: match.matchDateTime,
            banDurationMatches: banDuration,
            matchesMissed: 0,
            isActive: true,
          },
        })
      }
    }
  }

  const seasonStats = await tx.playerSeasonStats.findMany({ where: { seasonId: match.seasonId } })
  for (const stat of seasonStats) {
    if (stat.yellowCards >= YELLOW_CARD_LIMIT) {
      const exists = await tx.disqualification.findFirst({
        where: {
          personId: stat.personId,
          reason: DisqualificationReason.ACCUMULATED_CARDS,
          isActive: true,
        },
      })
      if (!exists) {
        await tx.disqualification.create({
          data: {
            personId: stat.personId,
            clubId: stat.clubId,
            reason: DisqualificationReason.ACCUMULATED_CARDS,
            sanctionDate: match.matchDateTime,
            banDurationMatches: 1,
            matchesMissed: 0,
            isActive: true,
          },
        })
      }
    }
  }
}

type MatchWithPredictions = Match & {
  events: MatchEvent[]
  predictions: { id: bigint; result1x2: PredictionResult | null; userId: number }[]
}

async function updatePredictions(
  match: MatchWithPredictions,
  tx: PrismaTx,
  logger: FastifyBaseLogger
): Promise<PredictionSettlementResult | null> {
  const result = resolveMatchResult(match)

  for (const prediction of match.predictions) {
    const isCorrect = prediction.result1x2 != null && prediction.result1x2 === result
    await tx.prediction.update({
      where: { id: prediction.id },
      data: {
        isCorrect,
        pointsAwarded: isCorrect ? 3 : 0,
      },
    })

    // Инкрементируем прогресс достижения "Угаданные прогнозы" при верном прогнозе
    if (isCorrect) {
      await incrementAchievementProgress(prediction.userId, AchievementMetric.CORRECT_PREDICTIONS, 1, tx).catch(err => {
        logger.warn({ err, userId: prediction.userId }, 'Failed to increment CORRECT_PREDICTIONS achievement')
      })
    }

    await tx.appUser.update({
      where: { id: prediction.userId },
      data: {
        totalPredictions: {
          increment: 0,
        },
      },
    })
  }

  const achievementTypes = await tx.achievementType.findMany()

  if (achievementTypes.length > 0) {
    const usersToCheck = [...new Set(match.predictions.map(p => p.userId))]

    for (const userId of usersToCheck) {
      const user = await tx.appUser.findUnique({
        where: { id: userId },
        include: {
          predictions: true,
          achievements: true,
        },
      })
      if (!user) continue

      const correctCount = user.predictions.filter(p => p.isCorrect).length
      const totalPredictions = user.predictions.length

      for (const achievement of achievementTypes) {
        let achieved = false
        if (achievement.metric === AchievementMetric.TOTAL_PREDICTIONS) {
          achieved = totalPredictions >= achievement.requiredValue
        } else if (achievement.metric === AchievementMetric.CORRECT_PREDICTIONS) {
          achieved = correctCount >= achievement.requiredValue
        }

        if (achieved) {
          const already = user.achievements.find(ua => ua.achievementTypeId === achievement.id)
          if (!already) {
            await tx.userAchievement.create({
              data: {
                userId,
                achievementTypeId: achievement.id,
                achievedDate: new Date(),
              },
            })
          }
        }
      }
    }
  }

  let settlementSummary: PredictionSettlementResult | null = null

  try {
    const templates = await tx.predictionTemplate.findMany({
      where: { matchId: match.id },
      include: {
        entries: {
          where: { status: PredictionEntryStatus.PENDING },
          select: {
            id: true,
            userId: true,
            selection: true,
            status: true,
            submittedAt: true,
          },
        },
      },
    })

    const pendingEntriesCount = templates.reduce((sum, t) => sum + t.entries.length, 0)
    logger.info(
      { matchId: match.id.toString(), templatesCount: templates.length, pendingEntriesCount },
      'updatePredictions: found templates and pending entries'
    )
    console.log('[SETTLEMENT DEBUG] Templates and entries found:', {
      matchId: match.id.toString(),
      templatesCount: templates.length,
      pendingEntriesCount,
      templateIds: templates.map(t => t.id.toString()),
    })

    if (templates.length > 0) {
      const settlement = await settlePredictionEntries(
        {
          id: match.id,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          hasPenaltyShootout: match.hasPenaltyShootout,
          penaltyHomeScore: match.penaltyHomeScore,
          penaltyAwayScore: match.penaltyAwayScore,
          events: match.events.map(event => ({ eventType: event.eventType })),
          predictionTemplates: templates,
        },
        tx,
        logger
      )
      settlementSummary = settlement as PredictionSettlementResult
      logger.info(
        { matchId: match.id.toString(), settled: settlement.settled, won: settlement.won, lost: settlement.lost },
        'updatePredictions: settlement completed'
      )
      console.log('[SETTLEMENT DEBUG] Settlement completed:', {
        matchId: match.id.toString(),
        settled: settlement.settled,
        won: settlement.won,
        lost: settlement.lost,
        userIds: Array.from(settlement.userIds),
      })
    }
  } catch (err) {
    logger.error({ err, matchId: match.id.toString() }, 'failed to settle prediction entries')
  }

  if (settlementSummary && settlementSummary.winsByUser.size > 0) {
    for (const [userId, wins] of settlementSummary.winsByUser.entries()) {
      if (wins <= 0) continue
      await incrementAchievementProgress(userId, AchievementMetric.CORRECT_PREDICTIONS, wins, tx).catch(err => {
        logger.warn({ err, userId }, 'Failed to increment CORRECT_PREDICTIONS from prediction entries')
      })
    }
  }

  return settlementSummary
}

function resolveMatchResult(match: Match): PredictionResult | null {
  const winnerClubId = determineMatchWinnerClubId(match as unknown as MatchOutcomeSource)
  if (winnerClubId === match.homeTeamId) return PredictionResult.ONE
  if (winnerClubId === match.awayTeamId) return PredictionResult.TWO
  return PredictionResult.DRAW
}

type SeriesMatch = Match & {
  season: { competition: { seriesFormat: SeriesFormat } }
  series: (MatchSeries & { matches: Match[] }) | null
}

async function updateSeriesState(match: SeriesMatch, tx: PrismaTx, logger: FastifyBaseLogger) {
  if (!match.seriesId) return

  const series = await tx.matchSeries.findUnique({
    where: { id: match.seriesId },
    include: {
      season: { include: { competition: true } },
      matches: {
        orderBy: { seriesMatchNumber: 'asc' },
      },
    },
  })

  if (!series) return
  if (series.seriesStatus === SeriesStatus.FINISHED) return

  const format = resolveSeasonSeriesFormat(series.season)
  const isMultiMatchSeries =
    format === SeriesFormat.BEST_OF_N || format === SeriesFormat.DOUBLE_ROUND_PLAYOFF
  const isBracketFormat =
    format === ('PLAYOFF_BRACKET' as SeriesFormat) ||
    format === SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF

  if (isMultiMatchSeries) {
    const scheduledMatches = series.matches
    const finishedMatches = scheduledMatches.filter(m => m.status === MatchStatus.FINISHED)
    if (finishedMatches.length === 0) return
    const totalPlannedMatches = scheduledMatches.length

    let winnerClubId: number | null = null
    {
      let homeWins = 0
      let awayWins = 0
      for (const m of finishedMatches) {
        const winner = determineMatchWinnerClubId(m as unknown as MatchOutcomeSource)
        if (!winner) continue
        if (winner === series.homeClubId) homeWins += 1
        else if (winner === series.awayClubId) awayWins += 1
      }
      const requiredWins = Math.floor(totalPlannedMatches / 2) + 1
      if (homeWins >= requiredWins) winnerClubId = series.homeClubId
      if (awayWins >= requiredWins) winnerClubId = series.awayClubId
    }

    if (winnerClubId != null) {
      await tx.matchSeries.update({
        where: { id: series.id },
        data: {
          seriesStatus: SeriesStatus.FINISHED,
          winnerClubId,
        },
      })

      await tx.match.deleteMany({
        where: {
          seriesId: series.id,
          status: {
            in: [MatchStatus.SCHEDULED, MatchStatus.LIVE, MatchStatus.POSTPONED],
          },
        },
      })

      await maybeCreateNextPlayoffStage(tx, {
        seasonId: series.seasonId,
        currentStageName: series.stageName,
        bestOfLength: totalPlannedMatches,
        format,
        logger,
        competitionType: series.season.competition.type,
        bracketType: series.bracketType,
      })
    }
    return
  }

  if (isBracketFormat) {
    const winnerClubId = determineMatchWinnerClubId(match as unknown as MatchOutcomeSource)
    if (!winnerClubId) {
      logger.warn(
        {
          matchId: match.id.toString(),
          seriesId: series.id,
          stage: series.stageName,
        },
        'playoff bracket match finished in draw, unable to determine winner automatically'
      )
      return
    }

    await tx.matchSeries.update({
      where: { id: series.id },
      data: {
        seriesStatus: SeriesStatus.FINISHED,
        winnerClubId,
      },
    })

    await tx.match.deleteMany({
      where: {
        seriesId: series.id,
        status: {
          in: [MatchStatus.SCHEDULED, MatchStatus.LIVE, MatchStatus.POSTPONED],
        },
      },
    })

    await maybeCreateNextPlayoffStage(tx, {
      seasonId: series.seasonId,
      currentStageName: series.stageName,
      bestOfLength: 1,
      format,
      logger,
      competitionType: series.season.competition.type,
      bracketType: series.bracketType,
    })
  }
}

type PlayoffProgressionContext = {
  seasonId: number
  currentStageName: string
  bestOfLength: number
  format: SeriesFormat
  logger: FastifyBaseLogger
  competitionType?: CompetitionType
  bracketType?: BracketType | null
}

async function maybeCreateNextPlayoffStage(tx: PrismaTx, context: PlayoffProgressionContext) {
  const stageSeries = await tx.matchSeries.findMany({
    where: { seasonId: context.seasonId, stageName: context.currentStageName },
    orderBy: { createdAt: 'asc' },
  })

  if (!stageSeries.length) return
  if (stageSeries.some(item => item.seriesStatus !== SeriesStatus.FINISHED)) return

  const orderedWinners = stageSeries
    .map(item => item.winnerClubId)
    .filter((clubId): clubId is number => typeof clubId === 'number')

  const uniqueWinners: number[] = []
  for (const clubId of orderedWinners) {
    if (!uniqueWinners.includes(clubId)) {
      uniqueWinners.push(clubId)
    }
  }

  // Для кубков с групповой стадией используем специальную логику Gold/Silver
  const isCupFormat =
    context.competitionType === CompetitionType.CUP &&
    context.format === SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF

  if (isCupFormat) {
    await maybeCreateCupNextStage(tx, context, stageSeries)
    return
  }

  if (uniqueWinners.length < 2) return

  const isMultiMatchSeries =
    context.format === SeriesFormat.BEST_OF_N ||
    context.format === SeriesFormat.DOUBLE_ROUND_PLAYOFF
  const isBracketFormat =
    context.format === ('PLAYOFF_BRACKET' as SeriesFormat) ||
    context.format === SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF

  if (isMultiMatchSeries) {
    const stats = await tx.clubSeasonStats.findMany({ where: { seasonId: context.seasonId } })
    const statsMap = new Map<number, (typeof stats)[number]>()
    for (const stat of stats) {
      statsMap.set(stat.clubId, stat)
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

    const seededWinners = [...uniqueWinners].sort(compareClubs)
    if (seededWinners.length < 2) return

    const nextStageName = stageNameForTeams(seededWinners.length)
    const existingNextStage = await tx.matchSeries.count({
      where: { seasonId: context.seasonId, stageName: nextStageName },
    })

    if (existingNextStage > 0) return

    const latestMatch = await tx.match.findFirst({
      where: { seasonId: context.seasonId },
      orderBy: { matchDateTime: 'desc' },
    })

    const matchTime = latestMatch ? latestMatch.matchDateTime.toISOString().slice(11, 16) : null
    const startDate = latestMatch ? addDays(latestMatch.matchDateTime, 7) : new Date()

    const { plans, byeSeries } = createInitialPlayoffPlans(
      seededWinners,
      startDate,
      matchTime,
      context.bestOfLength
    )

    if (plans.length === 0 && byeSeries.length === 0) return

    let latestDate: Date | null = latestMatch?.matchDateTime ?? null
    let createdSeries = 0
    let createdMatches = 0

    for (const plan of plans) {
      let playoffRound = await tx.seasonRound.findFirst({
        where: { seasonId: context.seasonId, label: plan.stageName },
      })
      if (!playoffRound) {
        playoffRound = await tx.seasonRound.create({
          data: {
            seasonId: context.seasonId,
            roundType: RoundType.PLAYOFF,
            roundNumber: null,
            label: plan.stageName,
          },
        })
      }

      const series = await tx.matchSeries.create({
        data: {
          seasonId: context.seasonId,
          stageName: plan.stageName,
          homeClubId: plan.homeClubId,
          awayClubId: plan.awayClubId,
          seriesStatus: SeriesStatus.IN_PROGRESS,
          homeSeed: plan.homeSeed,
          awaySeed: plan.awaySeed,
          bracketSlot: plan.targetSlot,
        },
      })
      createdSeries += 1

      const matches = plan.matchDateTimes.map((date, index) => {
        if (!latestDate || date > latestDate) {
          latestDate = date
        }
        return {
          seasonId: context.seasonId,
          matchDateTime: date,
          homeTeamId: index % 2 === 0 ? plan.homeClubId : plan.awayClubId,
          awayTeamId: index % 2 === 0 ? plan.awayClubId : plan.homeClubId,
          status: MatchStatus.SCHEDULED,
          seriesId: series.id,
          seriesMatchNumber: index + 1,
          roundId: playoffRound?.id ?? null,
        }
      })

      if (matches.length) {
        const created = await tx.match.createMany({ data: matches })
        createdMatches += created.count
      }
    }

    if (byeSeries.length) {
      for (const bye of byeSeries) {
        await tx.matchSeries.create({
          data: {
            seasonId: context.seasonId,
            stageName: nextStageName,
            homeClubId: bye.clubId,
            awayClubId: bye.clubId,
            seriesStatus: SeriesStatus.FINISHED,
            winnerClubId: bye.clubId,
            homeSeed: bye.seed,
            awaySeed: bye.seed,
            bracketSlot: bye.targetSlot,
          },
        })
        createdSeries += 1
      }
    }

    const thirdPlaceOutcome = await scheduleThirdPlaceIfFinal(tx, {
      context,
      stageSeries,
      nextStageName,
      startDate,
      matchTime,
      bestOfLength: context.bestOfLength,
      latestDate,
    })

    createdSeries += thirdPlaceOutcome.seriesCreated
    createdMatches += thirdPlaceOutcome.matchesCreated
    latestDate = thirdPlaceOutcome.latestDate

    if (latestDate) {
      await tx.season.update({ where: { id: context.seasonId }, data: { endDate: latestDate } })
    }

    context.logger.info(
      {
        seasonId: context.seasonId,
        stageName: nextStageName,
        seriesCreated: createdSeries,
        matchesCreated: createdMatches,
        byeClubIds: byeSeries.map(entry => entry.clubId),
        thirdPlaceCreated: thirdPlaceOutcome.seriesCreated > 0,
      },
      'playoff stage progressed'
    )

    return
  }

  if (isBracketFormat) {
    type BracketAdvanceEntry = { clubId: number; seed?: number; slot: number }

    const stageEntries: BracketAdvanceEntry[] = stageSeries.reduce<BracketAdvanceEntry[]>(
      (acc, series) => {
        if (!series.winnerClubId || typeof series.bracketSlot !== 'number') {
          return acc
        }

        const entry: BracketAdvanceEntry = {
          clubId: series.winnerClubId,
          slot: series.bracketSlot,
        }

        const winnerSeed =
          series.winnerClubId === series.homeClubId ? series.homeSeed : series.awaySeed
        if (typeof winnerSeed === 'number') {
          entry.seed = winnerSeed
        }

        acc.push(entry)
        return acc
      },
      []
    )

    stageEntries.sort((left, right) => left.slot - right.slot)

    if (stageEntries.length < 2) return

    const nextStageName = stageNameForTeams(stageEntries.length)
    const existingNextStage = await tx.matchSeries.count({
      where: { seasonId: context.seasonId, stageName: nextStageName },
    })

    if (existingNextStage > 0) return

    const latestMatch = await tx.match.findFirst({
      where: { seasonId: context.seasonId },
      orderBy: { matchDateTime: 'desc' },
    })

    const matchTime = latestMatch ? latestMatch.matchDateTime.toISOString().slice(11, 16) : null
    const startDate = latestMatch ? addDays(latestMatch.matchDateTime, 7) : new Date()

    const bestOfLength = Math.max(1, context.bestOfLength ?? 1)
    let latestDate: Date | null = latestMatch?.matchDateTime ?? null
    let createdSeries = 0
    let createdMatches = 0

    let playoffRound = await tx.seasonRound.findFirst({
      where: { seasonId: context.seasonId, label: nextStageName },
    })
    if (!playoffRound) {
      playoffRound = await tx.seasonRound.create({
        data: {
          seasonId: context.seasonId,
          roundType: RoundType.PLAYOFF,
          roundNumber: null,
          label: nextStageName,
        },
      })
    }

    const autoAdvance: { clubId: number; seed?: number; targetSlot: number }[] = []

    const pickHomeAway = (left: BracketAdvanceEntry, right: BracketAdvanceEntry) => {
      if (typeof left.seed === 'number' && typeof right.seed === 'number') {
        return left.seed <= right.seed ? [left, right] : [right, left]
      }
      if (typeof left.seed === 'number') return [left, right]
      if (typeof right.seed === 'number') return [right, left]
      return left.slot <= right.slot ? [left, right] : [right, left]
    }

    const normalizeSeed = (value?: number | null) => (typeof value === 'number' ? value : null)

    for (let index = 0; index < stageEntries.length; index += 2) {
      const left = stageEntries[index]
      if (!left) continue
      const right = stageEntries[index + 1]
      const targetSlot = right
        ? Math.ceil(Math.min(left.slot, right.slot) / 2)
        : Math.ceil(left.slot / 2)

      if (!right) {
        await tx.matchSeries.create({
          data: {
            seasonId: context.seasonId,
            stageName: nextStageName,
            homeClubId: left.clubId,
            awayClubId: left.clubId,
            seriesStatus: SeriesStatus.FINISHED,
            winnerClubId: left.clubId,
            homeSeed: normalizeSeed(left.seed),
            awaySeed: normalizeSeed(left.seed),
            bracketSlot: targetSlot,
          },
        })
        createdSeries += 1
        autoAdvance.push({ clubId: left.clubId, seed: left.seed, targetSlot })
        continue
      }

      const pairIndex = Math.floor(index / 2)
      const seriesBaseDate = addDays(startDate, pairIndex * 2)
      const matchDateTimes: Date[] = []
      for (let game = 0; game < bestOfLength; game += 1) {
        const scheduled = addDays(seriesBaseDate, game * 3)
        matchDateTimes.push(applyTimeToDate(scheduled, matchTime))
      }

      const [homeEntry, awayEntry] = pickHomeAway(left, right)

      const series = await tx.matchSeries.create({
        data: {
          seasonId: context.seasonId,
          stageName: nextStageName,
          homeClubId: homeEntry.clubId,
          awayClubId: awayEntry.clubId,
          seriesStatus: SeriesStatus.IN_PROGRESS,
          homeSeed: normalizeSeed(homeEntry.seed),
          awaySeed: normalizeSeed(awayEntry.seed),
          bracketSlot: targetSlot,
        },
      })
      createdSeries += 1

      const matches = matchDateTimes.map((date, gameIndex) => {
        if (!latestDate || date > latestDate) {
          latestDate = date
        }
        return {
          seasonId: context.seasonId,
          matchDateTime: date,
          homeTeamId: gameIndex % 2 === 0 ? homeEntry.clubId : awayEntry.clubId,
          awayTeamId: gameIndex % 2 === 0 ? awayEntry.clubId : homeEntry.clubId,
          status: MatchStatus.SCHEDULED,
          seriesId: series.id,
          seriesMatchNumber: gameIndex + 1,
          roundId: playoffRound?.id ?? null,
        }
      })

      if (matches.length) {
        const created = await tx.match.createMany({ data: matches })
        createdMatches += created.count
      }
    }

    const thirdPlaceOutcome = await scheduleThirdPlaceIfFinal(tx, {
      context,
      stageSeries,
      nextStageName,
      startDate,
      matchTime,
      bestOfLength,
      latestDate,
    })

    createdSeries += thirdPlaceOutcome.seriesCreated
    createdMatches += thirdPlaceOutcome.matchesCreated
    latestDate = thirdPlaceOutcome.latestDate

    if (latestDate) {
      await tx.season.update({ where: { id: context.seasonId }, data: { endDate: latestDate } })
    }

    context.logger.info(
      {
        seasonId: context.seasonId,
        stageName: nextStageName,
        seriesCreated: createdSeries,
        matchesCreated: createdMatches,
        autoAdvance,
        thirdPlaceCreated: thirdPlaceOutcome.seriesCreated > 0,
      },
      'playoff stage progressed'
    )

    return
  }
}

type ThirdPlaceScheduleInput = {
  context: PlayoffProgressionContext
  stageSeries: MatchSeries[]
  nextStageName: string
  startDate: Date
  matchTime: string | null
  bestOfLength: number
  latestDate: Date | null
}

type ThirdPlaceScheduleResult = {
  seriesCreated: number
  matchesCreated: number
  latestDate: Date | null
}

async function scheduleThirdPlaceIfFinal(
  tx: PrismaTx,
  input: ThirdPlaceScheduleInput
): Promise<ThirdPlaceScheduleResult> {
  if (input.nextStageName !== 'Финал') {
    return { seriesCreated: 0, matchesCreated: 0, latestDate: input.latestDate }
  }

  const thirdPlaceStageName = 'Матч за 3 место'
  const existingThirdPlace = await tx.matchSeries.count({
    where: { seasonId: input.context.seasonId, stageName: thirdPlaceStageName },
  })

  if (existingThirdPlace > 0) {
    return { seriesCreated: 0, matchesCreated: 0, latestDate: input.latestDate }
  }

  type SeriesWithSeeds = MatchSeries & {
    homeSeed?: number | null
    awaySeed?: number | null
  }

  const stageWithSeeds = input.stageSeries as SeriesWithSeeds[]
  const uniqueLosers: { clubId: number; seed?: number }[] = []
  const seenLosers = new Set<number>()

  for (const series of stageWithSeeds) {
    const { winnerClubId, homeClubId, awayClubId } = series
    if (winnerClubId == null || homeClubId == null || awayClubId == null) continue

    const isHomeWinner = winnerClubId === homeClubId
    const losingClubId = isHomeWinner ? awayClubId : homeClubId
    if (losingClubId == null || seenLosers.has(losingClubId)) continue

    const losingSeedValue = isHomeWinner ? series.awaySeed : series.homeSeed
    const normalizedSeed = typeof losingSeedValue === 'number' ? losingSeedValue : undefined

    seenLosers.add(losingClubId)
    uniqueLosers.push({ clubId: losingClubId, seed: normalizedSeed })
  }

  if (uniqueLosers.length < 2) {
    return { seriesCreated: 0, matchesCreated: 0, latestDate: input.latestDate }
  }

  const sorted = [...uniqueLosers].sort((a, b) => {
    const seedA = a.seed ?? Number.MAX_SAFE_INTEGER
    const seedB = b.seed ?? Number.MAX_SAFE_INTEGER
    if (seedA !== seedB) return seedA - seedB
    return a.clubId - b.clubId
  })

  const home = sorted[0]
  const away = sorted[1]

  let thirdPlaceRound = await tx.seasonRound.findFirst({
    where: { seasonId: input.context.seasonId, label: thirdPlaceStageName },
  })

  if (!thirdPlaceRound) {
    thirdPlaceRound = await tx.seasonRound.create({
      data: {
        seasonId: input.context.seasonId,
        roundType: RoundType.PLAYOFF,
        roundNumber: null,
        label: thirdPlaceStageName,
      },
    })
  }

  const seriesData: Prisma.MatchSeriesUncheckedCreateInput = {
    seasonId: input.context.seasonId,
    stageName: thirdPlaceStageName,
    homeClubId: home.clubId,
    awayClubId: away.clubId,
    seriesStatus: SeriesStatus.IN_PROGRESS,
    bracketSlot: null,
  }

  if (typeof home.seed === 'number') {
    seriesData.homeSeed = home.seed
  }
  if (typeof away.seed === 'number') {
    seriesData.awaySeed = away.seed
  }

  const thirdPlaceSeries = await tx.matchSeries.create({ data: seriesData })

  const bestOfLength = Math.max(1, input.bestOfLength)
  const baseDate = addDays(input.startDate, 1)
  let latestDate = input.latestDate

  const matches = Array.from({ length: bestOfLength }).map((_, index) => {
    const scheduledBase = addDays(baseDate, index * 3)
    const scheduled = applyTimeToDate(scheduledBase, input.matchTime)
    if (!latestDate || scheduled > latestDate) {
      latestDate = scheduled
    }
    return {
      seasonId: input.context.seasonId,
      matchDateTime: scheduled,
      homeTeamId: index % 2 === 0 ? home.clubId : away.clubId,
      awayTeamId: index % 2 === 0 ? away.clubId : home.clubId,
      status: MatchStatus.SCHEDULED,
      seriesId: thirdPlaceSeries.id,
      seriesMatchNumber: index + 1,
      roundId: thirdPlaceRound?.id ?? null,
    }
  })

  let createdMatches = 0
  if (matches.length) {
    const created = await tx.match.createMany({ data: matches })
    createdMatches = created.count
  }

  return {
    seriesCreated: 1,
    matchesCreated: createdMatches,
    latestDate,
  }
}

/**
 * Обработка прогрессии плей-офф для кубкового формата с Gold/Silver brackets
 */
async function maybeCreateCupNextStage(
  tx: PrismaTx,
  context: PlayoffProgressionContext,
  stageSeries: MatchSeries[]
): Promise<void> {
  const currentStage = context.currentStageName

  // Получаем настройки сезона для bestOf
  const season = await tx.season.findUnique({
    where: { id: context.seasonId },
    select: { playoffBestOf: true },
  })
  const bestOfLength = season?.playoffBestOf ?? 1

  // Получаем последний матч для определения даты и времени
  const latestMatch = await tx.match.findFirst({
    where: { seasonId: context.seasonId },
    orderBy: { matchDateTime: 'desc' },
  })
  const matchTime = latestMatch ? latestMatch.matchDateTime.toISOString().slice(11, 16) : null
  const startDate = latestMatch ? addDays(latestMatch.matchDateTime, 7) : new Date()

  // Собираем победителей и проигравших текущей стадии
  const winners: Array<{ qfSlot: number; sfSlot: number; clubId: number; seed?: number }> = []
  const losers: Array<{ qfSlot: number; sfSlot: number; clubId: number; seed?: number }> = []

  for (const series of stageSeries) {
    if (!series.winnerClubId) continue

    const slot = series.bracketSlot ?? 0
    const winnerSeed =
      series.winnerClubId === series.homeClubId ? series.homeSeed : series.awaySeed
    const loserClubId =
      series.winnerClubId === series.homeClubId ? series.awayClubId : series.homeClubId
    const loserSeed =
      series.winnerClubId === series.homeClubId ? series.awaySeed : series.homeSeed

    winners.push({
      qfSlot: slot,
      sfSlot: slot,
      clubId: series.winnerClubId,
      seed: winnerSeed ?? undefined,
    })

    if (loserClubId !== series.winnerClubId) {
      losers.push({
        qfSlot: slot,
        sfSlot: slot,
        clubId: loserClubId,
        seed: loserSeed ?? undefined,
      })
    }
  }

  let createdSeries = 0
  let createdMatches = 0
  let latestDate: Date | null = latestMatch?.matchDateTime ?? null

  // Обработка Квалификации (4x3) — создаем 1/4 финала
  if (currentStage === CUP_STAGE_NAMES.QUALIFICATION) {
    // Получаем группы
    const groups = await tx.seasonGroup.findMany({
      where: { seasonId: context.seasonId },
      include: { slots: true },
      orderBy: { groupIndex: 'asc' },
    })

    if (groups.length !== 4) {
      context.logger.warn(
        { seasonId: context.seasonId, groupCount: groups.length },
        'cup qualification: expected 4 groups for 4x3 configuration'
      )
      return
    }

    // Получаем только ГРУППОВЫЕ матчи (с groupId != null)
    const groupMatches = await tx.match.findMany({
      where: {
        seasonId: context.seasonId,
        groupId: { not: null },
        status: MatchStatus.FINISHED,
      },
      select: {
        groupId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
      },
    })

    // Группируем матчи по groupId (это id группы, не groupIndex!)
    const matchesByGroupId = new Map<number, typeof groupMatches>()
    for (const match of groupMatches) {
      if (match.groupId === null) continue
      const existing = matchesByGroupId.get(match.groupId) ?? []
      existing.push(match)
      matchesByGroupId.set(match.groupId, existing)
    }

    // Собираем победителей групп (1-е места) по групповым матчам
    const groupWinners: Array<{ groupIndex: number; clubId: number }> = []
    for (const group of groups) {
      const groupClubIds = group.slots.map(s => s.clubId).filter(id => id !== null) as number[]
      const gMatches = matchesByGroupId.get(group.id) ?? []
      
      // Считаем статистику по групповым матчам
      const clubStats = new Map<number, { points: number; goalDiff: number; goalsFor: number }>()
      for (const clubId of groupClubIds) {
        clubStats.set(clubId, { points: 0, goalDiff: 0, goalsFor: 0 })
      }

      for (const m of gMatches) {
        const homeStat = clubStats.get(m.homeTeamId)
        const awayStat = clubStats.get(m.awayTeamId)
        if (!homeStat || !awayStat) continue

        homeStat.goalsFor += m.homeScore
        homeStat.goalDiff += m.homeScore - m.awayScore
        awayStat.goalsFor += m.awayScore
        awayStat.goalDiff += m.awayScore - m.homeScore

        if (m.homeScore > m.awayScore) {
          homeStat.points += 3
        } else if (m.homeScore < m.awayScore) {
          awayStat.points += 3
        } else {
          homeStat.points += 1
          awayStat.points += 1
        }
      }

      // Сортируем по очкам, разнице голов, забитым
      const sorted = Array.from(clubStats.entries()).sort((a, b) => {
        if (b[1].points !== a[1].points) return b[1].points - a[1].points
        if (b[1].goalDiff !== a[1].goalDiff) return b[1].goalDiff - a[1].goalDiff
        if (b[1].goalsFor !== a[1].goalsFor) return b[1].goalsFor - a[1].goalsFor
        return a[0] - b[0]
      })

      if (sorted[0]) {
        groupWinners.push({ groupIndex: group.groupIndex, clubId: sorted[0][0] })
      }
    }

    // Создаём 1/4 финала согласно эталонной схеме:
    // QF1: A1 vs H (winner), QF2: D1 vs I, QF3: B1 vs F, QF4: C1 vs G
    // Где H, I, G, F — слоты квалификации 1, 2, 3, 4
    const qualWinnersBySlot = new Map<number, number>()
    for (const series of stageSeries) {
      if (series.winnerClubId && series.bracketSlot) {
        qualWinnersBySlot.set(series.bracketSlot, series.winnerClubId)
      }
    }

    const getGroupWinner = (groupIdx: number): number | null => {
      return groupWinners.find(w => w.groupIndex === groupIdx)?.clubId ?? null
    }

    // Эталонная схема пар 1/4 финала:
    // QF1 (slot=1): A1 vs winner(H=slot1)
    // QF2 (slot=2): D1 vs winner(I=slot2)
    // QF3 (slot=3): B1 vs winner(F=slot4)
    // QF4 (slot=4): C1 vs winner(G=slot3)
    const qfPairs = [
      { slot: 1, groupIdx: 1, qualSlot: 1 }, // A1 vs H winner
      { slot: 2, groupIdx: 4, qualSlot: 2 }, // D1 vs I winner
      { slot: 3, groupIdx: 2, qualSlot: 4 }, // B1 vs F winner
      { slot: 4, groupIdx: 3, qualSlot: 3 }, // C1 vs G winner
    ]

    for (const pair of qfPairs) {
      const homeClubId = getGroupWinner(pair.groupIdx)
      const awayClubId = qualWinnersBySlot.get(pair.qualSlot)

      if (!homeClubId || !awayClubId) {
        context.logger.warn(
          { seasonId: context.seasonId, slot: pair.slot, homeClubId, awayClubId },
          'cup qualification: missing team for quarter-final'
        )
        continue
      }

      const result = await createCupSeriesWithMatches(tx, {
        seasonId: context.seasonId,
        plan: {
          stageName: CUP_STAGE_NAMES.QUARTER_FINAL,
          homeClubId,
          awayClubId,
          bracketType: BracketType.GOLD, // 1/4 финала — часть Gold bracket
          bracketSlot: pair.slot,
          homeSeed: pair.groupIdx,
          awaySeed: pair.qualSlot + 4, // Победители квалификации имеют seed 5-8
        },
        bestOfLength,
        startDate,
        matchTime,
        latestDate,
      })
      createdSeries += result.seriesCreated
      createdMatches += result.matchesCreated
      if (result.latestDate) latestDate = result.latestDate
    }

    context.logger.info(
      {
        seasonId: context.seasonId,
        stage: currentStage,
        quarterFinalsCreated: createdSeries,
        matchesCreated: createdMatches,
      },
      'cup qualification completed, quarter-finals created'
    )
  }

  // Обработка 1/4 финала — создаем Gold полуфиналы и Silver полуфиналы
  if (currentStage === CUP_STAGE_NAMES.QUARTER_FINAL) {
    // Создаем полуфиналы Золотого кубка (победители QF)
    const goldSfPlans = createGoldSemiFinalPlans(winners)
    for (const plan of goldSfPlans) {
      const result = await createCupSeriesWithMatches(tx, {
        seasonId: context.seasonId,
        plan,
        bestOfLength,
        startDate,
        matchTime,
        latestDate,
      })
      createdSeries += result.seriesCreated
      createdMatches += result.matchesCreated
      if (result.latestDate) latestDate = result.latestDate
    }

    // Создаем полуфиналы Серебряного кубка (проигравшие QF)
    const silverSfPlans = createSilverSemiFinalPlans(losers)
    for (const plan of silverSfPlans) {
      const result = await createCupSeriesWithMatches(tx, {
        seasonId: context.seasonId,
        plan,
        bestOfLength,
        startDate: addDays(startDate, 1), // Silver на день позже
        matchTime,
        latestDate,
      })
      createdSeries += result.seriesCreated
      createdMatches += result.matchesCreated
      if (result.latestDate) latestDate = result.latestDate
    }

    context.logger.info(
      {
        seasonId: context.seasonId,
        stage: currentStage,
        goldSemiFinalsCreated: goldSfPlans.length,
        silverSemiFinalsCreated: silverSfPlans.length,
        seriesCreated: createdSeries,
        matchesCreated: createdMatches,
      },
      'cup quarter finals completed, semi-finals created'
    )
  }

  // Обработка полуфиналов Золотого кубка — создаем финал и матч за 3 место
  if (currentStage === CUP_STAGE_NAMES.SEMI_FINAL_GOLD) {
    const finalPlans = createGoldFinalPlans(winners, losers)
    for (const plan of finalPlans) {
      const result = await createCupSeriesWithMatches(tx, {
        seasonId: context.seasonId,
        plan,
        bestOfLength,
        startDate,
        matchTime,
        latestDate,
      })
      createdSeries += result.seriesCreated
      createdMatches += result.matchesCreated
      if (result.latestDate) latestDate = result.latestDate
    }

    context.logger.info(
      {
        seasonId: context.seasonId,
        stage: currentStage,
        seriesCreated: createdSeries,
        matchesCreated: createdMatches,
      },
      'gold semi-finals completed, finals created'
    )
  }

  // Обработка полуфиналов Серебряного кубка — создаем финал и матч за 3 место
  if (currentStage === CUP_STAGE_NAMES.SEMI_FINAL_SILVER) {
    const finalPlans = createSilverFinalPlans(winners, losers)
    for (const plan of finalPlans) {
      const result = await createCupSeriesWithMatches(tx, {
        seasonId: context.seasonId,
        plan,
        bestOfLength,
        startDate,
        matchTime,
        latestDate,
      })
      createdSeries += result.seriesCreated
      createdMatches += result.matchesCreated
      if (result.latestDate) latestDate = result.latestDate
    }

    context.logger.info(
      {
        seasonId: context.seasonId,
        stage: currentStage,
        seriesCreated: createdSeries,
        matchesCreated: createdMatches,
      },
      'silver semi-finals completed, finals created'
    )
  }

  // Обновляем дату окончания сезона
  if (latestDate) {
    await tx.season.update({
      where: { id: context.seasonId },
      data: { endDate: latestDate },
    })
  }
}

/**
 * Создание серии и матчей для кубка
 */
async function createCupSeriesWithMatches(
  tx: PrismaTx,
  params: {
    seasonId: number
    plan: {
      stageName: string
      homeClubId: number
      awayClubId: number
      bracketType: BracketType
      bracketSlot: number
      homeSeed?: number
      awaySeed?: number
    }
    bestOfLength: number
    startDate: Date
    matchTime: string | null
    latestDate: Date | null
  }
): Promise<{ seriesCreated: number; matchesCreated: number; latestDate: Date | null }> {
  const { seasonId, plan, bestOfLength, startDate, matchTime } = params
  let latestDate = params.latestDate

  // Проверяем, существует ли уже такая серия
  const existingSeries = await tx.matchSeries.findFirst({
    where: {
      seasonId,
      stageName: plan.stageName,
      homeClubId: plan.homeClubId,
      awayClubId: plan.awayClubId,
    },
  })

  if (existingSeries) {
    return { seriesCreated: 0, matchesCreated: 0, latestDate }
  }

  // Создаем или находим раунд
  let round = await tx.seasonRound.findFirst({
    where: { seasonId, label: plan.stageName },
  })
  if (!round) {
    round = await tx.seasonRound.create({
      data: {
        seasonId,
        roundType: RoundType.PLAYOFF,
        roundNumber: null,
        label: plan.stageName,
      },
    })
  }

  // Создаем серию
  const series = await tx.matchSeries.create({
    data: {
      seasonId,
      stageName: plan.stageName,
      homeClubId: plan.homeClubId,
      awayClubId: plan.awayClubId,
      seriesStatus: SeriesStatus.IN_PROGRESS,
      bracketType: plan.bracketType,
      bracketSlot: plan.bracketSlot,
      homeSeed: plan.homeSeed ?? null,
      awaySeed: plan.awaySeed ?? null,
    },
  })

  // Создаем матчи
  const matchDates: Date[] = []
  for (let i = 0; i < bestOfLength; i++) {
    const scheduled = addDays(startDate, i * 3)
    matchDates.push(applyTimeToDate(scheduled, matchTime))
  }

  const matchData = matchDates.map((date, index) => {
    if (!latestDate || date > latestDate) {
      latestDate = date
    }
    // Чередуем хозяев/гостей для серии
    const isHomeGame = index % 2 === 0
    return {
      seasonId,
      matchDateTime: date,
      homeTeamId: isHomeGame ? plan.homeClubId : plan.awayClubId,
      awayTeamId: isHomeGame ? plan.awayClubId : plan.homeClubId,
      status: MatchStatus.SCHEDULED,
      seriesId: series.id,
      seriesMatchNumber: index + 1,
      roundId: round.id,
    }
  })

  let matchesCreated = 0
  if (matchData.length) {
    const result = await tx.match.createMany({ data: matchData })
    matchesCreated = result.count
  }

  return {
    seriesCreated: 1,
    matchesCreated,
    latestDate,
  }
}
