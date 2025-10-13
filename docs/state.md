# State / Store — контракт и текущее состояние

Дата: 2025-10-05

Цель:
- Задокументировать фасад стора (store façade) для фронтенда — типы, публичный API, сценарии использования и ожидаемое поведение при real-time обновлениях.

Общий контракт фасада (коротко)
- Inputs: HTTP API (ETag/If-None-Match), WebSocket (patch|full), local persistence (localStorage) для корзины.
- Outputs: подписываемые селекторы/колбеки, синхронные геттеры состояния и асинхронные экшены для мутирующих операций.
- Ошибки: сетевые ошибки/таймауты возвращаются в форме `{ ok: false, error }` для action-методов; store остаётся в консистентном состоянии.

Ядро: фасад store (пример API)
- createStoreFacade(): Store

Store — публичные методы и селекторы (пример)
- getState(): RootState — синхронный снимок
- subscribe(listener: (state) => void): Unsubscribe
- actions:
  - fetchDictionaries(options?: { force?: boolean }): Promise<{ ok: boolean }>
  - fetchSeasons(options?: { force?: boolean }), fetchSeries(seasonId?, options?), fetchMatches(seasonId?, options?) — синхронизируют данные выбранного сезона, поддерживают `force: true` для обхода TTL.
  - fetchMatch(id: number): Promise<{ ok: boolean }>
  - placeBet(betPayload): Promise<{ ok: boolean, id?: number }>
  - addToCart(itemId, qty): void
  - syncCart(): Promise<{ ok: boolean }>

Stores (модули)
- matchesStore
  - state: { items: Match[], byId: Record<number, Match>, loading: boolean, etag?: string }
  - actions: fetchMatches, fetchMatch, applyPatch
- leagueStore (frontend/src/store/appStore.ts)
  - state: { seasons: LeagueSeasonSummary[], tables: Record<seasonId, LeagueTableResponse>, schedules: Record<seasonId, LeagueRoundCollection>, results: Record<seasonId, LeagueRoundCollection>, stats: Record<seasonId, LeagueStatsResponse>, selectedSeasonId?: number, activeSeasonId?: number, seasonsFetchedAt: number, tableFetchedAt: Record<number, number>, scheduleFetchedAt: Record<number, number>, resultsFetchedAt: Record<number, number>, statsFetchedAt: Record<number, number>, seasonsVersion?: string, tableVersions: Record<number, string | undefined>, scheduleVersions: Record<number, string | undefined>, resultsVersions: Record<number, string | undefined>, statsVersions: Record<number, string | undefined>, loading: { seasons: boolean; table: boolean; schedule: boolean; results: boolean; stats: boolean }, errors: { seasons?: string; table?: string; schedule?: string; results?: string; stats?: string }, leagueMenuOpen: boolean, leagueSubTab: 'table'|'schedule'|'results'|'stats', currentTab: UITab, lastLeagueTapAt: number, realtimeAttached: boolean, teamView: { open: boolean; clubId?: number; activeTab: 'overview'|'form'|'achievements' }, teamSummaries: Record<number, ClubSummaryResponse>, teamSummaryFetchedAt: Record<number, number>, teamSummaryLoadingId: number | null, teamSummaryErrors: Record<number, string | undefined>, teamRealtimeAttached: boolean, teamRealtimeClubId?: number }
  - actions: setTab, tapLeagueNav (обрабатывает двойной тап по вкладке «Лига»), toggleLeagueMenu/closeLeagueMenu, setSelectedSeason, setLeagueSubTab, fetchLeagueSeasons(force?), fetchLeagueTable({ seasonId, force? }), fetchLeagueSchedule({ seasonId, force? }), fetchLeagueResults({ seasonId, force? }), fetchLeagueStats({ seasonId, force? }), applyRealtimeTable(table), applyRealtimeSchedule(collection), applyRealtimeResults(collection), applyRealtimeStats({ season, category, entries, generatedAt? }), ensureRealtime (подписки на topics `public:league:table`, `public:league:schedule`, `public:league:results`, `public:league:goal-contributors`, `public:league:top-scorers`, `public:league:top-assists`), openTeamView(clubId), closeTeamView(), setTeamSubTab(tab), fetchClubSummary(clubId, options?), applyRealtimeClubSummary(summary), ensureTeamRealtime().
  - SWR: сезоны кэшируются 55 c, таблица — 240 c, расписание — 7.5 c, результаты — 14 c, лидерборды — 300 c, клубное резюме — 1 200 c (20 минут); сохраняем `X-Resource-Version` и timestamp последнего fetch per season / club. При `force: true` TTL обходится.
  - WS: `ensureRealtime` открывает публичный сокет (без авторизации) и обновляет таблицу/расписание/результаты/лидерборды при получении `type: 'league.table' | 'league.schedule' | 'league.results' | 'league.goalContribution' | 'league.scorers' | 'league.assists'`; получение full snapshot сбрасывает TTL и актуализирует `activeSeasonId`. `ensureTeamRealtime` подключает топик `public:club:{id}:summary` только для выбранного клуба, автоматически отписываясь при закрытии Team View.
- lineupStore
  - state: { lineups: Record<number, MatchLineup>, validationErrors: ValidationError[], saveSuccess: boolean }
  - actions: fetchLineup, saveLineup, setPlayerNumber, validateLineup
- realtimeStore
  - state: { connected: boolean, topics: string[] }
  - actions: connect(url), subscribe(topic), unsubscribe(topic), applyPatch
- userStore
  - state: { me?: User, loggedIn: boolean }
  - actions: telegramInit(initData) — flow with server verification
- shopStore
  - state: { items: ShopItem[], cart: Cart }
  - actions: loadItems, addToCart, removeFromCart, placeOrder

UI / Navigation state
- currentTab: 'home'|'league'|'predictions'|'leaderboard'|'shop'|'profile' — текущее активное представление.
- Поведение:
  - 'home' — основная страница с контентом (новости + лента).
  - 'league' — полноценная страница с сайдбаром сезонов, подвкладками и таблицей; двойной тап по кнопке «Лига» открывает боковое меню и скрывает нижнюю навигацию, повторное нажатие закрывает.
  - остальные значения — пока показывают placeholder ("Страница в разработке") до внедрения функционала.
  - На touch-устройствах сайдбар автоматически раскрывается при первом открытии вкладки, на десктопе работает как постоянная панель.

Пример добавления в фасад стора/контракта:

```ts
type UITab = 'home'|'league'|'predictions'|'leaderboard'|'shop'|'profile'
interface UIState { currentTab: UITab }
// actions
setTab(tab: UITab): void
```

Замечания по UX
- Закрытие/переход со сплеша: сплеш скрывается только после завершения прогресса (100%) и небольшой задержки (примерно 350ms), чтобы избежать мерцания при коротких задержках загрузки.
- Модальные окна составов: поддерживают скролл и адаптивную сетку на мобильных устройствах.
- Ошибки валидации: отображаются внутри модальных окон, не закрывая их.
- Успешное сохранение: показывается уведомление на 3 секунды с сохранением при закрытии модального окна.

Типы и shape (коротко)
- Match { id: number, homeTeamId: number, awayTeamId: number, matchDate: string, homeScore: number, awayScore: number, hasPenaltyShootout?: boolean, penaltyHomeScore?: number, penaltyAwayScore?: number, status: 'scheduled'|'live'|'finished' }
- MatchLineupEntry { id: number, matchId: number, playerId: number, shirtNumber?: number | null, confirmed: boolean }
- ValidationError { field: string, message: string, playerId?: number }
- ShopItem { id: number, title: string, price: number }
- Cart { items: { itemId: number, qty: number }[] }

ETag / SWR behaviour (client-side)
- При fetchMatches: если локально известен `etag`, отправляем `If-None-Match`.
- При 304 — не обновляем state; при 200 — сохраняем тело и новый `ETag`.
- При получении WS-патча для matches — применяем патч к store через `applyPatch`, опционально инвалидация ETag.

Edge cases
- Пустой ответ / отсутствие данных — store держит `items = []` и `loading = false`.
- Конфликты между WS-патчем и локальным optimistic update — оптимистичные апдейты должны быть отменяемы при ошибке сервера.
- Большие payloads — при необходимости использовать pagination / incremental fetch.

Тесты (минимальный набор)
- Unit: matchesStore.fetchMatches happy path + 304 handling + error handling.
- Integration: WS patch apply → store state changes (mock WS).

Документы к обновлению при изменениях
- При любом изменении shape стора обновлять `docs/state.md`.

Следующие шаги
- Реализовать `frontend/src/api/etag.ts` с поддержкой If-None-Match и SWR.
- Создать `src/store/facade.ts` и покрыть unit тестами (Jest + msw / nock).

Обновление: User / Profile / Realtime

- User shape (DB / shared types)

```ts
interface DbUser {
  id: number;
  userId: string; // telegram numeric id as string (BigInt in DB)
  tgUsername?: string | null;
  photoUrl?: string | null;
  createdAt: string; // ISO UTC in DB
  updatedAt: string; // ISO UTC in DB
}
```

- userStore behaviour
  - `telegramInit(initData)` — отправляет `initData` на `/api/auth/telegram-init`; сервер валидирует строку и возвращает { ok, user, token } где token — JWT. При успехе store сохраняет `me = user` и `loggedIn = true`.
  - Отображение дат: frontend конвертирует UTC в МСК (UTC+3) и форматирует как `dd.MM.yyyy` для `createdAt` / `updatedAt`.

- realtimeStore / WS рекомендации
  - Клиент WS должен поддерживать reconnect с экспоненциальным бэкоффом (начиная с 500ms, cap ~30s) и jitter.
  - Подписки происходят по топикам; текущая реализация использует имя вкладки (`tab:<name>`) и `user:<userId>` как возможные топики. Сервер должен валидировать права подписки (ACL) — реализовать проверку в `backend/src/realtime/index.ts`.
  - Для локальной отладки запускайте Redis и убедитесь, что `REDIS_URL` корректен.

Edge cases / Notes
- Если token истёк — WS клиент должен попытаться повторно получить токен (refresh flow не реализован — требование для следующего этапа) и переавторизоваться.


## Admin Dashboard Store

- Расположение: `admin/src/store/adminStore.ts` (отдельный Vite-проект `admin/`).
- Состояние:
  - `status: 'idle' | 'authenticating' | 'authenticated' | 'error'`
  - `token?: string` — JWT после успешного входа.
  - `assistantToken?: string` — токен помощника (SUDIA/POMOSH роли), хранится в `localStorage` (`obnliga-assistant-token`).
  - `activeTab: 'teams' | 'matches' | 'stats' | 'players' | 'news'`
  - `error?: string`
  - `data`: сезоны, серии, матчи и отдельный список `friendlyMatches` (товарищеские встречи вне сезона), а также справочники (клубы, стадионы, люди).
  - `data.persons` дополнен полями `currentClubId` / `currentClub` (короткая информация о текущем клубе) и массивом `clubs` с историей привязок — используется вкладкой «Игроки и дисциплина» для отображения переходов.
  - `data.clubCareerTotals`: агрегированные показатели клубов за все турниры лиги (`tournaments`, `matchesPlayed`, `goalsFor`, `goalsAgainst`, `yellowCards`, `redCards`, `cleanSheets`).
  - `matchStats`: `Record<clubId, MatchStatisticEntry>` + `matchStatsVersion?: number` — загруженные показатели матча; обновляются через HTTP (`GET /matches/:id/statistics`) и patch-публикации `match:{id}:stats`.
  - `matchStatsLoading` / `matchStatsUpdating`: индикаторы загрузки и оптимистичных апдейтов; используются для дизейбла контролов
    статистики в модалке матча.
- Плей-офф формат:
  - конкурсы (`Competition`) теперь содержат `seriesFormat`, поддерживающий `PLAYOFF_BRACKET`;
  - `fetchSeasons` и `fetchSeries` обязаны быть вызваны до визуализации сетки — компонент `PlayoffBracket` использует `data.series`, `data.matches` и `data.clubs`;
  - при автоматизации сезона `SeasonAutomationPayload.seriesFormat` выбирается из `SeriesFormat`, опция `PLAYOFF_BRACKET` активирует генерацию случайной сетки (локальный state `automationRandomBracket` блочит ручные посевы);
  - для `BEST_OF_N` сохраняем прежнюю логику биндинга посевов (`automationSeedingEnabled`).
- Действия (ключевые):
  - `login(login: string, password: string)` — обращается к `/api/admin/login`, сохраняет JWT в `localStorage` (`obnliga-admin-token`). Fallback-порядок: admin → judge → assistant → lineup; при успешном входе в один режим остальные токены очищаются, а вспомогательные store (`judgeStore`, `assistantStore`) сбрасываются.
  - `logout()` — очищает токен, сбрасывает вкладку.
  - `setTab(tab)` — переключает активную вкладку.
  - `clearError()` — сбрасывает сообщение об ошибке при фокусе формы.
  - `fetchSeasons()`, `fetchSeries(seasonId?)`, `fetchMatches(seasonId?)` — синхронизируют данные выбранного сезона.
  - `fetchFriendlyMatches()` — загружает список товарищеских игр через `/api/admin/friendly-matches`.
  - Кэширование данных без фонового воркера: все fetch-* действия используют локальный TTL (SWR) поверх Zustand. TTL (мс): `dictionaries = 60000`, `seasons = 30000`, `series = 15000`, `matches = 10000`, `friendlyMatches = 45000`, `stats = 20000`, `users/predictions = 60000`, `achievements = 120000`, `disqualifications = 30000`. Ключи параметризуются сезон/турнир; сброс кеша происходит при `login/logout` и выборах, которые меняют параметры (сезон/турнир).
  - Версии ответов: сервер возвращает заголовок `X-Resource-Version` и `meta.version` для всех `/api/admin/stats/*`. Store планирует сохранять версии в `fetchTimestamps` для будущей сверки с WS-патчами.
  - Для серий плей-офф до двух побед (LEAGUE + BEST_OF_N / DOUBLE_ROUND_PLAYOFF) редактор матча поддерживает флаг серии пенальти: переключатель доступен только при ничейном счёте, результаты пенальти сохраняются отдельно и не затрагивают основную статистику голов.
- TBD (после интеграции портала): `fetchBracket(seasonId?)` планируется как фасад поверх `/api/bracket`, сейчас данные подгружаются отдельным запросом в компоненте.
- Вкладка «Матчи» использует эти действия для комплексного управления: автоматическое создание сезона, ручное добавление серий, live-редактирование матчей регулярки, а теперь и форму для товарищеских встреч с отдельной таблицей под основным расписанием.
- Редактор статистики матча синхронизирован с событиями: нажатие `+/-` по метрике вызывает `POST /matches/:id/statistics/adjust`,
  удары в створ автоматически подтягивают счётчик «Всего ударов», жёлтые/красные карточки синхронизируются с CRUD событий.
  После каждой операции store принимает `meta.version` и ждёт patch с топика `match:{id}:stats`.
- Визуализация сетки:
  - компонент `PlayoffBracket` группирует серии по стадиям, сортирует игры и подсвечивает победителей;
  - для сезонов без игр/серий отображаются информативные заглушки;
  - требуется синхронизация с WS/ETag, поэтому реализация помечена как **temporary stub**.
- Вкладка «Статистика»:
  - «Команды — сводная статистика» выводит полный перечень клубов из `data.clubs`, даже если у клуба нет сыгранных турниров (значения = 0).
  - Таблица «Бомбардиры» содержит колонку «Кф.эфф» (отношение голов к матчам); сортировка по голам и матчам сохраняется.
  - Раздел «Карьера игроков» скрывает таблицу до выбора клуба и фильтрует записи строго по выбранному клубу.
- Вкладка «Игроки и дисциплина»:
  - При создании дисквалификации сначала выбирается клуб; список игроков подгружается из `/api/admin/clubs/:id/players` и включает только игроков выбранного клуба.
  - Поле «Игрок» отключено до выбора клуба, что исключает ошибочные привязки.
- Влияние на realtime/кэш: пока отсутствует, но данные матча подтягиваются по запросу; интеграция ETag/WS остаётся в планах.
- **Judge Store (temporary stub до синхронизации с Context7)**
  - Расположение: `admin/src/store/judgeStore.ts`, используется в компоненте `JudgePanel` для судейского входа.
  - Состояние: `status`, `matches`, `events`, `selectedMatchId`, `loading`, `error`.
  - Действия: `loadMatches`, `refreshMatches`, `selectMatch`, `updateScore`, `createEvent`, `updateEvent`, `deleteEvent`, `reset`, `clearError`.
  - Хранение токена: `adminStore` сохраняет `obnliga-judge-token`; логика входа добавлена в `adminStore.login` с fallback-порядком admin → judge → assistant → lineup.
  - Ограничение: создание событий требует ручного ввода ID игроков. После получения артефактов Context7 планируется интеграция выпадающих списков на основе заявки клуба и текущей заявки матча.
- **Assistant Store (temporary stub до синхронизации с Context7)**
  - Расположение: `admin/src/store/assistantStore.ts`, используется компонентом `AssistantPanel` для роли помощника матча.
  - Состояние: `status`, `token`, `matches`, `selectedMatchId`, `events`, `lineup`, `statistics`, `statisticsVersion`, `loading`, `error`.
  - Действия: `fetchMatches`, `selectMatch`, `refreshSelected`, `createEvent`, `updateEvent`, `deleteEvent`, `updateScore`, `adjustStatistic`, `reset`, `clearError`.
  - Особенности: локально хранит токен в `obnliga-assistant-token`, поддерживает двойное подтверждение перевода матча в статус `FINISHED`, применяет контроль версий (`X-Resource-Version`) для статистики и подписывается на WebSocket-топики `match:{id}:events` и `match:{id}:stats` через `admin/src/wsClient.ts`; события и статистика обновляются в сторе по патчам без ручного рефреша.

