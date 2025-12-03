/**
 * API для работы с архивами сезонов
 */
import { httpRequest, type ApiResponse } from './httpClient'

/** Краткая информация о клубе в архиве */
export interface ArchiveClubInfo {
  id: number
  name: string
  shortName: string
  logoUrl: string | null
}

/** Сводка архива сезона */
export interface SeasonArchiveSummary {
  seasonId: number
  seasonName: string
  competitionName: string
  competitionType: 'LEAGUE' | 'CUP'
  startDate: string
  endDate: string
  goldCupWinner: ArchiveClubInfo | null
  goldCupRunnerUp: ArchiveClubInfo | null
  goldCupThirdPlace: ArchiveClubInfo | null
  silverCupWinner: ArchiveClubInfo | null
  silverCupRunnerUp: ArchiveClubInfo | null
  totalMatches: number
  totalGoals: number
  totalYellowCards: number
  totalRedCards: number
  avgGoalsPerMatch: number
}

/** Строка таблицы в архиве */
export interface ArchiveStandingEntry {
  position: number
  clubId: number
  clubName: string
  shortName: string
  logoUrl: string | null
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

/** Таблица в архиве */
export interface SeasonArchiveStandings {
  groups: Array<{
    groupLabel: string
    standings: ArchiveStandingEntry[]
  }>
  overall?: ArchiveStandingEntry[]
}

/** Запись бомбардира/ассистента */
export interface ArchiveLeaderEntry {
  personId: number
  firstName: string
  lastName: string
  clubId: number
  clubName: string
  clubShortName: string
  clubLogoUrl: string | null
  goals: number
  assists: number
  penaltyGoals: number
  matchesPlayed: number
}

/** Полные данные архива сезона */
export interface SeasonArchiveData {
  summary: SeasonArchiveSummary
  standings: SeasonArchiveStandings
  topScorers: ArchiveLeaderEntry[]
  topAssists: ArchiveLeaderEntry[]
  archivedAt: string
  archivedBy: string
}

type RequestOptions = {
  signal?: AbortSignal
  version?: string
}

export const archiveApi = {
  /**
   * Получить архивные данные сезона
   */
  fetchSeasonArchive(seasonId: number, options?: RequestOptions) {
    return httpRequest<SeasonArchiveData>(`/api/archive/seasons/${seasonId}`, options)
  },
}

export type { ApiResponse }
