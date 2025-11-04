# State / Store: контракт и текущее состояние

Дата: 2025-10-15

Цель:
- Синхронизировать фактическое состояние стора с документацией и зафиксировать поведение HTTP polling + ETag после отказа от WebSocket в публичном клиенте.

## Общие принципы фасада

- Все HTTP-запросы проходят через `frontend/src/api/httpClient.ts`, который добавляет `If-None-Match` при наличии локальной версии и обрабатывает `304 Not Modified`.
- Ответы сервера должны возвращать `meta.version`, `ETag` или `X-Resource-Version`; store кэширует значение и переиспользует его в следующих запросах.
- Любое действие возвращает `{ ok: boolean }` и не ломает консистентность состояния: при ошибке обновляется только блок `errors`, данные остаются предыдущими.
- Локальные TTL реализованы через отметки времени в store; `force: true` обходят TTL, но по-прежнему отправляют версию.
- При ответе `304` мы продлеваем TTL и сбрасываем флаг загрузки, не меняя ссылки на данные - это важно для React `memo`.

## Публичное приложение (`frontend/src/store/appStore.ts`)

### Структура состояния

- `currentTab: UITab`: активная вкладка (`home`, `league`, `predictions`, `leaderboard`, `shop`, `profile`).
- `leagueSubTab: 'table' | 'schedule' | 'results' | 'stats'` и `leagueMenuOpen` контролируют UI вкладки «Лига».
- `seasons`, `tables`, `schedules`, `results`, `stats`: по одному словарю на сезон с данными, полученными от `/api/league/*`.
- `selectedSeasonId`: вручную выбранный сезон; `activeSeasonId`: последний активный сезон из API.
- `seasonsFetchedAt`, `tableFetchedAt`, `scheduleFetchedAt`, `resultsFetchedAt`, `statsFetchedAt`: отметки времени для TTL.
- `seasonsVersion`, `tableVersions`, `scheduleVersions`, `resultsVersions`, `statsVersions`: версии/ETag с сервера.
- `teamView`: открыта ли карточка клуба и активная вкладка `overview|matches|squad`.
- `teamView.matchesMode`: внутренняя вкладка раздела «Матчи» (`schedule` или `results`).
- `teamSummaries`, `teamSummaryVersions`, `teamSummaryFetchedAt`, `teamSummaryErrors`, `teamSummaryLoadingId`: данные `/api/clubs/:id/summary`.
- `teamMatches`, `teamMatchesVersions`, `teamMatchesFetchedAt`, `teamMatchesErrors`, `teamMatchesLoadingId`: агрегированные матчи клуба из `/api/clubs/:id/matches` (по всем сезонам).
- `loading` и `errors`: флаги загрузки и ошибочные состояния по категориям.
- `leaguePollingAttached`, `teamPollingAttached` и `teamPollingClubId`: контроль интервалов polling.

### TTL и версии (SWR)

| Endpoint | TTL в store | Версия хранится в | Комментарии |
| --- | --- | --- | --- |
| `/api/league/seasons` | 55 000 мс | `seasonsVersion` | Авто-подгрузка при входе во вкладку «Лига» и при смене сезона |
| `/api/league/table?seasonId={id}` | 30 000 мс на сезон | `tableVersions[seasonId]` | При `304` обновляется только `tableFetchedAt[seasonId]` |
| `/api/league/schedule?seasonId={id}` | 12 000 мс | `scheduleVersions[seasonId]` | Поллинг только при активной подвкладке «Расписание» |
| `/api/league/results?seasonId={id}` | 20 000 мс | `resultsVersions[seasonId]` | Аналогичное поведение для «Результатов» |
| `/api/league/stats?seasonId={id}` | 300 000 мс | `statsVersions[seasonId]` | Содержит лидерборды; поллинг включается только на подвкладке «Статистика» |
| `/api/clubs/{id}/summary` | 45 000 мс | `teamSummaryVersions[clubId]` | Интервал активен, пока открыт Team View конкретного клуба |
| `/api/clubs/{id}/matches` | 90 000 мс | `teamMatchesVersions[clubId]` | Возвращает все сыгранные и будущие матчи клуба по сезонам |
| `/api/public/matches/{id}/comments` | 10 000 мс (чат открыт) / 30 000 мс (чат свернут или режим landscape) при статусе LIVE | `matchDetails.commentsEtag` | Комментарии опрашиваются только на вкладке «Трансляция» во время LIVE; при `304` продлевается текущий интервал, вне LIVE polling отключается |
| `/api/news` | 60 000 мс между запросами, локальный cache 30 мин | `localStorage` + `etagRef` внутри компонента | Компонент запоминает snapshot и `etag`, чтобы мгновенно показать карусель |
| `/api/auth/me` | 90 000 мс между запросами, локальный cache 5 мин | `localStorage` | Профиль читает `ETag` из `/api/auth/telegram-init`, продлевает TTL при `304`; payload содержит `leaguePlayerStats` и массив `leaguePlayerCareer` по клубам |

### Товарищеские матчи (FRIENDLY_SEASON_ID)

- Для дружеских матчей зарезервирован сезон `FRIENDLY_SEASON_ID = -1` и виртуальное соревнование `FRIENDLY_COMPETITION_ID = -101`; записи лежат в `schedules` и `results` под ключом `-1` (строковый индекс при сериализации в `localStorage`).
- `fetchLeagueSchedule` и `fetchLeagueResults` при `seasonId === -1` обращаются к `/api/league/friendlies/schedule` и `/api/league/friendlies/results`, наследуя общие TTL (12/20 секунд) и версии (`scheduleVersions[-1]`, `resultsVersions[-1]`).
- `fetchLeagueTable` и `fetchLeagueStats` для дружеских матчей завершаются сразу без запросов: UI блокирует подвкладки «Таблица» и «Статистика» и переводит пользователя на «Календарь».
- После загрузки списка сезонов стор сохраняет выбор пользователя: если ранее был выбран `FRIENDLY_SEASON_ID`, он остаётся активным и триггерит принудительную загрузку расписания и результатов товарищеских матчей.
- Сводка сезона (`friendliesSeasonSummary`) собирается из расписания или результатов и использует стандартный контракт `LeagueSeasonSummary`, поэтому остальные компоненты работают без форков.
- `startLeaguePolling` независимо от выбранного сезона каждые 60 секунд проверяет `/api/league/friendlies/schedule`, чтобы UI реагировал на появление/удаление товарищеских матчей без перезагрузки.
- Когда расписание пустое (`rounds.length === 0`), стор скрывает блок «Товарищеские матчи» и автоматически возвращает пользователя на ближайший доступный сезон лиги.

Все TTL продлеваются при `304 Not Modified`. На `200 OK` данные проходят через merge-хелперы, чтобы сохранить ссылки на неизменившиеся сущности и не заставлять React перерисовывать списки.

### Действия стора

- `setTab`, `setLeagueSubTab`, `toggleLeagueMenu`, `tapLeagueNav`, `closeLeagueMenu`, `setSelectedSeason`: синхронные действия UI.
- `fetchLeagueSeasons({ force? })`, `fetchLeagueTable({ seasonId?, force? })`, `fetchLeagueSchedule`, `fetchLeagueResults`, `fetchLeagueStats`: HTTP polling с `If-None-Match`, управление TTL и merge-хелперами.
- `ensureLeaguePolling()` / `stopLeaguePolling()`: управление 10-секундным интервалом для активной вкладки «Лига» (интервал спит, если вкладка браузера скрыта или выбран другой таб).
- `openTeamView(clubId)`, `closeTeamView()`, `setTeamSubTab(tab)`: управление карточкой клуба.
- `setTeamMatchesMode(mode)`: переключатель под-вкладок «Расписание/Результаты» в карточке клуба.
- `fetchClubSummary(clubId, { force? })`, `fetchClubMatches(clubId, { force? })`, `ensureTeamPolling()`, `stopTeamPolling()`: Team View опрашивает сводку и агрегированные матчи клуба каждые 20 с, пока карточка открыта.
- `fetchMatchComments(matchId, { force? })` — условная загрузка комментариев с ETag, результат сохраняется в `matchDetailsCache` и состоянии модального окна.
- `submitMatchComment(matchId, payload)` — POST-запрос добавляет новую запись и синхронизирует кэш (UI обновляется оптимистично при успехе).

### Merge и минимальные перерисовки

- Таблица (`mergeLeagueTable`) и расписание/результаты (`mergeRoundCollection`) сравнивают входящие данные с предыдущими, переиспользуют объекты клубов, матчей и сезонов при отсутствии изменений.
- Лидерборды (`mergeStatsResponse`) также переиспользуют неизменившиеся записи, чтобы React не перерисовывал списки без нужды.
- После слияния `activeSeasonId` обновляется только если сервер сообщил, что сезон активен.

### Поллинг и паузы

- Таймеры создаются только в браузере. При первом старте регистрируется обработчик `beforeunload`, который гарантированно снимает все интервалы.
- Активная вкладка «Лига» опрашивает сервер каждые 10 секунд; карточка клуба (Team View) — каждые 20 секунд; профиль — раз в 90 секунд; новости — раз в 60 секунд.
- При `document.hidden === true` тик прерывается, чтобы не тратить запросы в фоновой вкладке. При возврате пользователя ближайший тик выполняется сразу и запрашивает данные с `force: true`, если TTL устарел.
- Переключение `currentTab` автоматически останавливает league polling; возврат на вкладку «Лига» возобновляет таймер и запускает `fetch*` по активным подвкладкам.
- Для «Расписания», «Результатов» и «Статистики» запросы отправляются только тогда, когда под-вкладка активна — это минимизирует трафик и нагрузку на сервер.

### Локальное кэширование

- Новости: `NewsSection` хранит snapshot и `etag` в `localStorage` на 30 минут. Даже при `304` компонент продлевает TTL и переиспользует закэшированные карточки.
- Профиль: `Profile.tsx` складывает данные пользователя в `localStorage` на 5 минут и передаёт `If-None-Match` в `telegram-init`. Это позволяет возвращать пользователя к актуальному профилю без повторной авторизации.
- При получении `leaguePlayerCareer` фронтенд кэширует массив как часть профиля: диапазоны лет рассчитываются на бэкенде, клиент лишь выводит таблицу и пересчитывает totals по числовым полям.
- Публичный store не использует `localStorage` — все TTL in-memory, чтобы избежать устаревших payload после deploy.

### Инвалидация данных

- Бэкенд (`defaultCache`) вычисляет fingerprint payload и хранит его в Redis/LRU. При изменении данных увеличивается версия ключа, что приводит к новому `ETag`.
- Клиент сохраняет версии в `*Versions`. При `force: true` запрос всё равно условный, поэтому сервер вернёт `304`, если данные не менялись.
- При сетевых сбоях TTL не продлевается — это позволяет следующему успешному запросу обновить данные сразу же после восстановления соединения.

### Team View и обработка ошибок

- `fetchClubSummary` и `fetchClubMatches` валидируют входящий payload перед записью в store, чтобы избежать рендера невалидных данных.
- `teamMatches` содержит готовую выборку матчей по всем сезонам; фильтрация по режимам (`schedule/results`) происходит на клиенте, без повторных запросов к `/api/league/*`.
- При ошибке запросов сводки или матчей соответствующие флаги (`teamSummaryErrors`, `teamMatchesErrors`) получают код ошибки, polling останавливается до ручного перезапроса.

### Матчевое модальное окно

- `matchDetails.comments` хранит массив `MatchComment` для вкладки «Трансляция». Значение берётся из Redis-кеша `/api/public/matches/:id/comments` и переиспользуется через `matchDetailsCache`.
- `matchDetails.commentsEtag` — последняя версия ресурса; `fetchMatchComments` всегда отправляет `If-None-Match` и на `304` лишь продлевает lifetime записи в LRU.
- `matchDetails.loadingComments` управляет skeleton-отрисовкой списка; `matchDetails.submittingComment` блокирует форму отправки до ответа сервера.
- Вкладка «Трансляция» активируется только при доступной ссылке и статусе матча `LIVE`. При переходе статуса в `FINISHED` пользователю показывается уведомление и через 10 секунд вкладка автоматически переключается на «События».
- Обновление комментариев выполняется адаптивным polling: 10 секунд при раскрытом чате, 30 секунд при свернутом или принудительном landscape-режиме (включая pseudo fullscreen). Таймеры работают лишь пока матч в статусе `LIVE` и вкладка активна.
- `matchDetailsCache[matchId]` дополнен полями `comments` и `commentsEtag`, чтобы комментарии подключались мгновенно при повторном открытии окна.
- `fetchMatchComments(matchId, { force? })` запускается при первом переходе на вкладку «Трансляция» или по кнопке «Повторить», синхронизирует store и кэш при `304/200`.
- `submitMatchComment(matchId, payload)` делает POST, добавляет новый `MatchComment` в store и кеш `matchDetailsCache` при успехе; версию берёт из `ETag`/`X-Resource-Version` ответа.

## HTTP клиент (`frontend/src/api/httpClient.ts`)

- Каждому запросу передаём `If-None-Match`, если известна версия (`W/"{cacheKey}:{version}"`). Сервер сопоставляет ключ и возвращает `304`, если fingerprint payload не изменился.
- При ответе сервер может вернуть `meta.version`, `ETag` или `X-Resource-Version`. Клиент собирает их в порядке приоритета: сначала `meta.version`, затем `ETag`, затем `X-Resource-Version`.
- На `304` клиент возвращает `{ ok: true, notModified: true }`; стор только продлевает соответствующий `*_FetchedAt` и снимает `loading`.
- На `200` клиент возвращает `{ ok: true, data, version }`, где `version` уже нормализована; дальше merge-хелперы решают, какие ссылки сохранять.
- Любая ошибка превращается в `{ ok: false, error, status }`. Если сервер не прислал JSON, `error` формируется из текста ответа или кода статуса. Для сетевых ошибок используем `network_error`, чтобы UI мог запустить экспоненциальный бэкофф.

## Админские сторы (Vite-проект `admin/`)

- `admin/src/store/adminStore.ts`: управляет аутентификацией, словарями, сезонами, матчами и статистикой. Критичные значения: TTL словарей 60 000 мс, сезонов 30 000 мс, серий 15 000 мс, матчей 10 000 мс, товарищеских матчей 45 000 мс, статистики 20 000 мс. Для админской вкладки прогнозов добавлен список `predictionMatches` и TTL 20 000 мс с загрузчиком `fetchPredictionMatches({ force? })`, который обращается к `GET /api/admin/predictions/matches` и поддерживает сезонный ключ кэша. В стора появились действия `setPredictionTemplateAuto` и `setPredictionTemplateManual` — они используют `PATCH /api/admin/matches/:matchId/prediction-template`, обновляют локальное состояние через `applyPredictionTemplateOverride` и при необходимости принудительно перезагружают список матчей. Модуль также хранит `ads: AdBanner[]` с TTL 60 000 мс и действиями `fetchAds`, `upsertAd`, `removeAd`; после авторизации подписывается на топик `home`, где приходят патчи `news.full`/`news.remove` и `ads.full`/`ads.remove`. Вкладка «Матчи» по‑прежнему полагается на TTL вместо принудительного `force`, так что лишние запросы при переключении подвкладок отсутствуют. Во вкладке «Новости» появилось управление баннерами: форма создания/редактирования вызывает `adminCreateAd`/`adminUpdateAd`, список синхронизируется через `upsertAd`/`removeAd` и веб-события.
- `admin/src/store/adminStore.ts`: управляет аутентификацией, словарями, сезонами, матчами и статистикой. Критичные значения: TTL словарей 60 000 мс, сезонов 30 000 мс, серий 15 000 мс, матчей 10 000 мс, товарищеских матчей 45 000 мс, статистики 20 000 мс. Для админской вкладки прогнозов добавлен список `predictionMatches` и TTL 20 000 мс с загрузчиком `fetchPredictionMatches({ force? })`, который обращается к `GET /api/admin/predictions/matches` и поддерживает сезонный ключ кэша. В стора появились действия `setPredictionTemplateAuto` и `setPredictionTemplateManual` — они используют `PATCH /api/admin/matches/:matchId/prediction-template`, обновляют локальное состояние через `applyPredictionTemplateOverride` и при необходимости принудительно перезагружают список матчей. Модуль также хранит `ads: AdBanner[]` с TTL 60 000 мс и действиями `fetchAds`, `upsertAd`, `removeAd`; после авторизации подписывается на топики `home` и `admin.predictions`: первый приносит патчи `news.full`/`news.remove` и `ads.full`/`ads.remove`, второй рассылает `prediction.template.override`, который либо обновляет локальное состояние матчей, либо инициирует повторный fetch при несоответствии. Вкладка «Матчи» по‑прежнему полагается на TTL вместо принудительного `force`, так что лишние запросы при переключении подвкладок отсутствуют. Во вкладке «Новости» появилось управление баннерами: форма создания/редактирования вызывает `adminCreateAd`/`adminUpdateAd`, список синхронизируется через `upsertAd`/`removeAd` и веб-события.
- `admin/src/store/assistantStore.ts`: панель помощника матча, хранит текущий матч, события и статистику, слушает топики `match:{id}:events` и `match:{id}:stats`.
- `admin/src/store/judgeStore.ts`: панель судьи, временно хранит список матчей и событий, использует тот же токен, что и admin fallback.

## UX и клиентское поведение

- Двойной тап по иконке «Лига» открывает боковое меню и скрывает нижнюю навигацию; повторное нажатие закрывает меню. Порог двойного нажатия - 280 мс.
- Вкладка «Профиль» обновляет данные каждые 90 с (см. `frontend/src/Profile.tsx`).
- Компонент новостей (`frontend/src/components/NewsSection.tsx`) выполняет фоновые опросы и использует тот же httpClient, поэтому поведение ETag единообразно.

## Тестирование

- Модульные тесты: покрыть happy-path и `304` для каждого fetch-действия, отдельный тест на merge-хелперы (влияют на ссылочное равенство).
- Интеграционные проверки: smoke-прогон `npm run build` + ручной сценарий переключения подвкладок с активным polling, чтобы контролировать, что запросы не дублируются при быстром переключении.

## Документы к обновлению при изменениях

- `docs/state.md`: при изменении shape или TTL.
- `docs/cache.md`: при корректировке серверных TTL и стратегии SWR.
- `docs/TTL.md`: справочник по клиентским TTL и поведению `304`.
- `audit/changes/<ID>.md`: краткое описание изменений стора для истории.

