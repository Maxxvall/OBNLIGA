import { FastifyInstance } from 'fastify'
import { BracketType, Prisma, SeriesFormat } from '@prisma/client'
import prisma from '../db'
import { serializePrisma } from '../utils/serialization'
import { getCupStageRank } from '../services/cupBracketLogic'

const includeConfig = {
  competition: true,
  participants: {
    include: {
      club: true,
    },
  },
  series: {
    include: {
      homeClub: true,
      awayClub: true,
      winnerClub: true,
    },
    orderBy: {
      stageName: 'asc',
    },
  },
  matches: {
    where: {
      seriesId: {
        not: null,
      },
    },
    include: {
      round: true,
    },
    orderBy: {
      matchDateTime: 'asc',
    },
  },
} satisfies Prisma.SeasonInclude

type SeasonWithRelations = Prisma.SeasonGetPayload<{ include: typeof includeConfig }>
type SeriesWithRelations = SeasonWithRelations['series'][number]

const stageSortValue = (stageName: string, bracketType?: BracketType | null): number => {
  // Для кубкового формата используем специальный rank (основан на stageName)
  if (bracketType) {
    return getCupStageRank(stageName)
  }
  
  const normalized = stageName.toLowerCase()
  const fraction = stageName.match(/1\/(\d+)/i)
  if (fraction) {
    const denom = Number(fraction[1])
    if (Number.isFinite(denom)) {
      return denom * 2
    }
  }
  const teamsMatch = stageName.match(/(\d+)\s*(команд|участ|teams?)/iu)
  if (teamsMatch) {
    const teams = Number(teamsMatch[1])
    if (Number.isFinite(teams) && teams > 0) {
      return teams
    }
  }
  if (normalized.includes('четверть')) return 8
  if (normalized.includes('quarter')) return 8
  if (normalized.includes('полуфин')) return 4
  if (normalized.includes('semi')) return 4
  if (normalized.includes('финал')) return 2
  if (normalized.includes('final')) return 2
  return 1000
}

const formatScoreLabel = (match: SeasonWithRelations['matches'][number]) => {
  if (match.status === 'SCHEDULED' || match.status === 'POSTPONED') {
    return '—'
  }
  return `${match.homeScore}:${match.awayScore}`
}

const formatKickoff = (iso: Date): string =>
  new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const summarizeSeries = (
  seriesMatches: SeasonWithRelations['matches']
): {
  homeLabel: string
  awayLabel: string
  mode: 'wins' | 'score'
} => {
  if (!seriesMatches.length) {
    return { homeLabel: '—', awayLabel: '—', mode: 'score' }
  }
  if (seriesMatches.length === 1) {
    const [single] = seriesMatches
    const showScore = single.status !== 'SCHEDULED' && single.status !== 'POSTPONED'
    return {
      homeLabel: showScore ? String(single.homeScore) : '—',
      awayLabel: showScore ? String(single.awayScore) : '—',
      mode: 'score',
    }
  }
  const finished = seriesMatches.filter(
    match => match.status === 'FINISHED' || match.status === 'LIVE'
  )
  const homeWins = finished.filter(match => match.homeScore > match.awayScore).length
  const awayWins = finished.filter(match => match.awayScore > match.homeScore).length
  return {
    homeLabel: homeWins.toString(),
    awayLabel: awayWins.toString(),
    mode: 'wins',
  }
}

const buildBracketPayload = (season: SeasonWithRelations) => {
  const matchesBySeries = new Map<string, SeasonWithRelations['matches']>()
  for (const match of season.matches) {
    if (!match.seriesId) continue
    const key = match.seriesId.toString()
    if (!matchesBySeries.has(key)) {
      matchesBySeries.set(key, [])
    }
    matchesBySeries.get(key)!.push(match)
  }
  matchesBySeries.forEach((list, key) => {
    const sorted = [...list].sort((a, b) => {
      const leftNumber = a.seriesMatchNumber ?? 0
      const rightNumber = b.seriesMatchNumber ?? 0
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber
      }
      return new Date(a.matchDateTime).getTime() - new Date(b.matchDateTime).getTime()
    })
    matchesBySeries.set(key, sorted)
  })

  const clubMap = new Map<number, SeasonWithRelations['participants'][number]['club']>()
  for (const participant of season.participants) {
    clubMap.set(participant.clubId, participant.club)
  }

  // Проверяем, есть ли у сезона кубковый формат (с bracketType)
  const hasCupFormat = season.series.some(s => s.bracketType != null)

  const stageBuckets = new Map<
    string,
    {
      stageName: string
      rank: number
      bracketType: BracketType | null
      series: Array<{
        id: bigint
        stageName: string
        seriesStatus: string
        isBye: boolean
        winnerClubId?: number | null
        homeClubId: number
        awayClubId: number
        bracketType: BracketType | null
        bracketSlot: number | null
        homeClub?: { id: number; name: string; shortName: string; logoUrl: string | null }
        awayClub?: { id: number; name: string; shortName: string; logoUrl: string | null }
        summary: ReturnType<typeof summarizeSeries>
        matches: Array<{
          id: bigint
          label: string
          kickoff: string
          status: string
          scoreLabel: string
        }>
        order: number
      }>
    }
  >()

  for (const series of season.series) {
    const stageMatches = matchesBySeries.get(series.id.toString()) ?? []
    const summary = summarizeSeries(stageMatches)
    const bracketType = (series as SeriesWithRelations & { bracketType?: BracketType | null }).bracketType ?? null
    const bracketSlot = (series as SeriesWithRelations & { bracketSlot?: number | null }).bracketSlot ?? null
    const stageRank = stageSortValue(series.stageName, bracketType)
    
    // Для кубкового формата ключ включает bracketType для группировки
    const bucketKey = hasCupFormat && bracketType
      ? `${bracketType}:${series.stageName}`
      : series.stageName
    
    const existing = stageBuckets.get(bucketKey) ?? {
      stageName: series.stageName,
      rank: stageRank,
      bracketType,
      series: [],
    }

    existing.series.push({
      id: series.id,
      stageName: series.stageName,
      seriesStatus: series.seriesStatus,
      isBye: series.homeClubId === series.awayClubId,
      winnerClubId: series.winnerClubId,
      homeClubId: series.homeClubId,
      awayClubId: series.awayClubId,
      bracketType,
      bracketSlot,
      homeClub: clubMap.get(series.homeClubId) ?? undefined,
      awayClub: clubMap.get(series.awayClubId) ?? undefined,
      summary,
      matches: stageMatches.map((match, index) => ({
        id: match.id,
        label:
          match.round?.label?.trim() ||
          (match.seriesMatchNumber ? `Игра ${match.seriesMatchNumber}` : `Матч ${index + 1}`),
        kickoff: formatKickoff(match.matchDateTime),
        status: match.status,
        scoreLabel: formatScoreLabel(match),
      })),
      order: stageMatches[0]
        ? new Date(stageMatches[0].matchDateTime).getTime()
        : Number.MAX_SAFE_INTEGER,
    })

    stageBuckets.set(bucketKey, existing)
  }

  const stages = Array.from(stageBuckets.values())
    .sort((left, right) => {
      // Сначала сортируем по bracketType (null < QUALIFICATION < GOLD < SILVER)
      const bracketOrder = (bt: BracketType | null) => {
        if (bt === null) return 0
        if (bt === 'QUALIFICATION') return 1
        if (bt === 'GOLD') return 2
        if (bt === 'SILVER') return 3
        return 4
      }
      const leftBracketOrder = bracketOrder(left.bracketType)
      const rightBracketOrder = bracketOrder(right.bracketType)
      if (leftBracketOrder !== rightBracketOrder) {
        return leftBracketOrder - rightBracketOrder
      }
      // Затем по рангу стадии (больший rank = ранняя стадия)
      if (left.rank !== right.rank) {
        return right.rank - left.rank
      }
      return left.stageName.localeCompare(right.stageName, 'ru')
    })
    .map(stage => ({
      stageName: stage.stageName,
      bracketType: stage.bracketType,
      series: stage.series
        .sort((left, right) => left.order - right.order)
        .map(item => ({
          id: item.id,
          stageName: item.stageName,
          seriesStatus: item.seriesStatus,
          isBye: item.isBye,
          winnerClubId: item.winnerClubId,
          homeClubId: item.homeClubId,
          awayClubId: item.awayClubId,
          bracketType: item.bracketType,
          bracketSlot: item.bracketSlot,
          homeClub: item.homeClub
            ? {
                id: item.homeClub.id,
                name: item.homeClub.name,
                shortName: item.homeClub.shortName,
                logoUrl: item.homeClub.logoUrl ?? null,
              }
            : null,
          awayClub: item.awayClub
            ? {
                id: item.awayClub.id,
                name: item.awayClub.name,
                shortName: item.awayClub.shortName,
                logoUrl: item.awayClub.logoUrl ?? null,
              }
            : null,
          summary: item.summary,
          matches: item.matches,
        })),
    }))

  // Определяем, есть ли у сезона кубковый формат
  const isCupFormat = hasCupFormat || season.seriesFormat === SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF

  return {
    season: {
      id: season.id,
      name: season.name,
      startDate: season.startDate,
      endDate: season.endDate,
      seriesFormat: season.seriesFormat ?? season.competition.seriesFormat,
      groupRounds: (season as SeasonWithRelations & { groupRounds?: number }).groupRounds ?? 1,
      playoffBestOf: (season as SeasonWithRelations & { playoffBestOf?: number }).playoffBestOf ?? 1,
      isCupFormat,
      competition: {
        id: season.competition.id,
        name: season.competition.name,
        seriesFormat: season.competition.seriesFormat,
      },
    },
    stages,
  }
}

const findSeasonForBracket = async (seasonId?: number): Promise<SeasonWithRelations | null> => {
  if (seasonId) {
    return prisma.season.findUnique({
      where: { id: seasonId },
      include: includeConfig,
    })
  }

  return prisma.season.findFirst({
    where: {
      OR: [
        {
          seriesFormat: {
            in: [
              SeriesFormat.BEST_OF_N,
              SeriesFormat.DOUBLE_ROUND_PLAYOFF,
              SeriesFormat.PLAYOFF_BRACKET,
              SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF,
            ],
          },
        },
        {
          AND: [
            { seriesFormat: null },
            {
              competition: {
                seriesFormat: {
                  in: [
                    SeriesFormat.BEST_OF_N,
                    SeriesFormat.DOUBLE_ROUND_PLAYOFF,
                    SeriesFormat.PLAYOFF_BRACKET,
                    SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF,
                  ],
                },
              },
            },
          ],
        },
      ],
      series: {
        some: {},
      },
    },
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
    include: includeConfig,
  })
}

export default async function bracketRoutes(server: FastifyInstance) {
  server.get('/api/bracket', async (request, reply) => {
    const { seasonId } = request.query as { seasonId?: string }

    let numericSeasonId: number | undefined
    if (seasonId) {
      const parsed = Number(seasonId)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return reply.status(400).send({ ok: false, error: 'invalid_season_id' })
      }
      numericSeasonId = parsed
    }

    const season = await findSeasonForBracket(numericSeasonId)
    if (!season) {
      return reply.status(404).send({ ok: false, error: 'bracket_not_found' })
    }

    if (!season.series.length) {
      return reply.status(404).send({ ok: false, error: 'no_series' })
    }

    const payload = buildBracketPayload(season)
    return reply.send({ ok: true, data: serializePrisma(payload) })
  })
}
