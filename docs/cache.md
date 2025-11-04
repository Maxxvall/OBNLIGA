# Политика кэширования — Лига Обнинска

(окончательная версия с динамическим TTL и хелпером для матчевого окна, готовая для роста до ~5 000 пользователей)

## Цель

Надёжно и экономно обслуживать live‑матчи, прогнозы и все страницы лиги при росте до ~5k пользователей. Стартуем с бесплатных планов (Render + Free Redis + Free DB), применяем versioned ETag fast‑path, разделение static ↔ live, time‑aware TTL, adaptive polling, SWR, batch‑write и защиту от stampede. Match-window helper реализован в `backend/src/cache/matchWindowHelper.ts` и автоматизирует подбор TTL по датам матчей.

---

## Ключевые изменения (итог)

* **Динамический TTL (time‑aware TTL)** — TTL автоматически уменьшается в период ближайших матчей и увеличивается в не‑матчевые дни.
* **Match‑Window Helper (`backend/src/cache/matchWindowHelper.ts`)** — утилита, которая читает даты матчей из БД/Redis, вычисляет матчевое окно (включая pre‑warm) и кеширует результат; на основе окна автоматически выбирается TTL для ресурсов.
* **Pre‑warm** — за configurable время (например, 30–60 минут) до первых матчей выполняется прогрев ключей в Redis.
* **SWR + SETNX lock** — при промахе отдаём stale snapshot и регенерируем асинхронно; только один воркер выполняет тяжёлую регенерацию.
* **Admin atomic bump + publish** — при финализации матча новые payload записываются атомарно, сразу выставляется новый ETag и публикуется событие инвалидации.

---

## Общие правила

* **ETag fast‑path (O(1))** — сначала проверяем ETag/version в Redis; при совпадении — `304 Not Modified`.
* **Разделение static ↔ live** — статичная часть: long TTL; live: короткий TTL + push/fallback poll.
* **Event‑driven invalidation** — bump версии при `match_finalized`, `match_results_update`, `vote_cast`.
* **Buffer & batch** — голосования и мелкие частые обновления → Redis queue → batch write в БД каждые 5–10s.
* **Stampede protection (SETNX + SWR)** — предотвращение лавины регенераций.
* **Compression & aggregation** — сжимать payload (brotli/gzip/msgpack) и агрегировать ключи.
* **WebSocket только для админки/защищённых панелей**; клиенты используют HTTP Polling + ETag.
* **Lazy loading** — данные загружаются только для активной подвкладки/страницы (например, при открытии вкладки "Лига" загружается только таблица, остальные подвкладки — по требованию).

---

## Match‑Window Helper

**Реализация:** `backend/src/cache/matchWindowHelper.ts` + `backend/src/cache/multilevelCache.ts`

**Задача:** автоматически вычислять «матчевое окно» (prewarm, live, post‑grace) и на его основе подбирать TTL/lock/SWR для публичных ресурсов лиги.

**Что делает хелпер:**

* читает ближайшие матчи из БД (`Match`) на интервал `LOOKAHEAD_DAYS` (по умолчанию 7 суток);
* учитывает pre‑warm буфер `PREWARM_MINUTES` (по умолчанию 45 минут) и post‑grace `POST_GRACE_MINUTES` (по умолчанию 30 минут);
* кеширует расчёт окна в Redis через `defaultCache` (`cache:match-window:v1`) на 30 секунд, чтобы не бить БД на каждом запросе;
* предоставляет API: `getMatchWindow()`, `isMatchWindowActive()`, `resolveCacheOptions(resource)` и `maybePrewarmPublicLeagueCaches()`.

**Adaptive TTL:**

* `resolveCacheOptions` возвращает набор `{ ttlSeconds, staleWhileRevalidateSeconds, lockTimeoutSeconds }` для ресурсов `leagueTable`, `leagueSchedule`, `leagueResults`, `leagueStats`.
* Внутри матч-окна (prewarm/live/post) используются короткие TTL (30/20/15/45 секунд) и расширенное SWR; вне окна — долгие TTL (7 дней / 7 дней / 15 минут / 1 час).
* `defaultCache` (см. `backend/src/cache/multilevelCache.ts`) уважает эти параметры, хранит `expiresAt` и `staleUntil` в обоих слоях (LRU + Redis) и защищает регенерацию через `SETNX`/локальный lock.

**Pre-warm:**

* `maybePrewarmPublicLeagueCaches()` (см. `backend/src/services/cachePrewarm.ts`) прогревает таблицу, расписание, результаты и статистику для затронутых сезонов. Метод вызывается вручную (`/api/cache/prewarm`) или из внутренних воркеров.
* Секрет для pre-warm (`CACHE_PREWARM_TOKEN`) передаётся через заголовок `x-prewarm-token`.

**Настройка через env:**

```
MATCH_WINDOW_LOOKAHEAD_DAYS=7
MATCH_WINDOW_PREWARM_MINUTES=45
MATCH_WINDOW_POST_GRACE_MINUTES=30
```

При отсутствии переменных используются значения по умолчанию (7 дней / 45 минут / 30 минут).

---

## Схема ключей

Формат: `категория:тип[:id][:version]`.
Примеры: `league:table`, `md:123:live`, `etag:md:123`, `public:matches:live`.

---

## Ресурсы и рекомендованные TTL (учитывая match‑window)

**Общие принципы:** в матчевом окне — короткие TTL; вне окна — длинные TTL (часы/дни).

### League (Лига)

* `league:table` — будни/вне окна: **7d**; в окне: **30s** (возможна адаптация до 10–15s при пиковой активности).
* `league:schedule` — вне окна: **7d**; в окне: **15–30s**.
* `league:stats` — вне окна: **1h**; live‑поля кешируются отдельно с TTL **3–30s**; в окне: **30–60s** для агрегатов.
* `league:results` — в окне: **10–20s**; вне окна: можно увеличить до минут/часов.
* `league:bracket` — versioned, TTL **1h–24h**.

### Match Details (split static / live)

* `md:{match_id}:meta` — статичная часть: **10 min** (или дольше вне окна).
* `md:{match_id}:live` — live‑поля (score, events): **3–5s** в окне; автоудаление через 3 часа после окончания.
* `md:{match_id}:comments` — временные комментарии под трансляцией: **4h** (SWR **4h**), хранит до 120 последних сообщений.
* `etag:md:{match_id}` — atomic bump при изменениях.

### Predictions

* `predictions:active:6d` — **300s** (SWR **120s**), ETag обновляется при изменении окна матчей или bump шаблонов; ключ зависит от диапазона (по умолчанию 6 суток).
* `predictions:user:{user_id}` — **300s** (SWR **120s**), приватный ключ с защитой по пользовательскому ID и сессии.
* `predictions:legacy` — временный namespace для миграции старых записей (`Prediction`). TTL **5 min**, только для фоновых задач.
* Голосования / подтверждения прогнозов — Redis queue → batch write каждые **5–10s** → bump version → publish.

### Leaderboards

* `lb:*` — versioned, TTL **60s** (SWR **120s**); каждые 6 часов бэкграундная задача пересчитывает рейтинги и прогревает первый лист таблицы.

### Achievements / Ads / Admin stats

* Achievements — TTL **30 min**.
* Ads — TTL **600 s**, ключ `ads:all`; отдаём через `defaultCache` + `ETag`/`X-Resource-Version` и инвалидируем при любом CRUD из админки. Клиент кеширует снапшот и ETag в localStorage на 14 суток и всегда запрашивает `If-None-Match`.
* Admin stats — TTL **1–2 h**; event‑driven инвалидация при финализации.

### Public aggregates / client store

* `public:matches:live` — TTL **3–5s** (SWR **10–15s**), но при старте/предматчевой подготовке — pre‑warm.
* `public:club:{id}:matches` — TTL **1 200s** (20 мин) вне матчевого окна, содержит агрегированные матчи клуба по всем сезонам.
* Static assets (JS/CSS/images) — long cache (1y) + content hash.

---

#### Admin workflow (обновлённый — для бесплатной инфраструктуры)

1. Админ финализирует матч через админ-панель или через панель помощника.  
2. Бэкенд пересчитывает таблицу/статистику (можно в background, но важно — результат готов к записи).  
3. Записать новые payloads + etag **атомарно** через `defaultCache.set(...)`. Версия ресурса (`__v:key`) увеличивается автоматически — 304/ETag обновляются без сторонних сигналов.  
4. При необходимости вызвать `maybePrewarmPublicLeagueCaches()` (внутренне либо через POST `/api/cache/prewarm` с заголовком `x-prewarm-token`). Это прогреет расписание/результаты/статистику и таблицу, используя новые TTL.
5. Клиенты при следующем poll увидят новый ETag и получат свежие данные (SWR отдаёт stale, если регенерация ещё в процессе).


## Бесплатные варианты pre-warm / обработка cache:update (Render Free)

На Free Render платные background workers отсутствуют, поэтому используем бесплатные пути:

1. **HTTP endpoint `/api/cache/prewarm`**  
   - Публичный cron (GitHub Actions, cron-job.org, UptimeRobot) может вызывать POST `/api/cache/prewarm` за 30–45 минут до старта матчей.  
   - Защита токеном `CACHE_PREWARM_TOKEN`, передаётся в заголовке `x-prewarm-token`.

2. **Внутренний вызов `maybePrewarmPublicLeagueCaches()`**  
   - Админские операции (финализация) могут запускать pre-warm в фоне.  
   - Хелпер определяет, какие сезоны затронуты, и прогревает таблицу/расписание/результаты/статистику с актуальными TTL.

3. **SWR + `SETNX` как страховка**  
   - Если pre-warm не успел, `defaultCache` отдаёт stale snapshot и синхронно блокирует тяжелую регенерацию одним воркером.

4. **Практические ограничения и правила**  
   - Pre-warm должен оставаться лёгким и идемпотентным.  
   - Не запускаем тяжёлые расчёты внутри HTTP-ответа — только через фон или cron.  
   - Логируем ситуации, когда прогрев не удался.

> Итог: **cron ➜ `/api/cache/prewarm` + встроенный SWR/SETNX** дают быстрый прогрев даже на бесплатном тарифе Render.

---

## SWR и защита от stampede (описательно)

* **Serve‑While‑Revalidate (SWR):** реализовано в `backend/src/cache/multilevelCache.ts`. При miss отдаём stale payload и триггерим асинхронную регенерацию. Это обеспечивает быстрый отклик и уменьшает нагрузку на БД.
* **SETNX / lock:** `defaultCache` пытается взять `SETNX`-lock (`__lock:key`) на время регенерации. Только первый воркер делает тяжёлую работу; остальные получают stale/202.
* **Fallback:** при отсутствии stale можно вернуть `202 Accepted` и короткий fallback, чтобы не блокировать пользователей.

---

## Redis: стартовая стратегия и апгрейд

* **Старт:** Free Redis (25MB) — хранить только ETag и агрегированные hot‑snapshots, сжимать payload.
* **Оптимизации:** агрегировать ключи (`public:matches:live`), хранить минимальные hot‑payloads (сжатые), большие JSON — в object storage + pointer в Redis.
* **Пул подключений:** использовать 6–8 постоянных подключений.
* **Нет Redis Pub/Sub:** инвалидация происходит через bump версии (`__v:key`) и матчевые TTL.
* **Триггеры апгрейда:** `evicted_keys > 0` OR `redis_hit_ratio < 85%` → апгрейд до Starter (256MB).

---

## Клиентская логика (рекомендации)

* **Adaptive polling:** активные пользователи (live page) — 3–5s; обычные — 10–30s; скрытые вкладки — pause/backoff (например, 60s).
* **Lazy loading (on-demand):** данные загружаются только для активной подвкладки/страницы. Например, при открытии вкладки "Лига" загружается только таблица (дефолтная подвкладка); календарь, результаты и статистика — по требованию при переключении подвкладок.
* **ETag usage:** всегда отправлять `If‑None‑Match` через `fetch({ cache: 'no-store', headers: { 'If-None-Match': etag } })`; при `304` — использовать локальный snapshot (localStorage/IndexedDB).
* **Local cache TTL:** клиент хранит snapshot и ETag; при `304` UI не обновляется.
* **Push (SSE/WS) только для админ‑панелей:** после получение patch клиент на админке инвалидает локальный TTL и обновляет store.
* **Fallback интерфейса:** при ошибках показывать stale snapshot с пометкой «обновление…».

---

## Batch / фоновые процессы

* Голосования: Redis list/stream → batch write в БД каждые **5–10s** → bump version → publish.
* Heavy агрегаты (leaderboards, season stats): пересчёт через воркеры после `match_finalized` или по CRON для pre‑warm перед матчами.

---

## Rate limiting

* Рекомендация: **15 req / 10 s** на IP для live‑эндпоинтов; при превышении — `429 Too Many Requests` + `Retry‑After`.
* Rate limiting защищает от злоупотреблений и стабилизирует Redis/DB.

---

## Мониторинг и триггеры апгрейда

Отслеживать:

* `redis_hit_ratio`, `evicted_keys`, `used_memory`, `connected_clients`
* `DB QPS`, `connection_waits`, `slow_queries`
* `p95/p99 latency`, `error_rate`, `http_reqs`

**Сигналы апгрейда:** `hit_ratio < 85%` OR `evicted_keys > 0` OR p95 > 1s under load → апгрейд Redis/Render/DB.

---
## Free deployment notes (кратко и практично)

- Всегда включай SWR + `SETNX` lock — это самый важный механизм защиты на Free.  
- Делай pre-warm лёгким (минимальные snapshot'ы).  
- Настрой GitHub Actions / cron-job.org / UptimeRobot для резервного вызова `/prewarm`.  
- Мониторь: redis_hit_ratio, evicted_keys, p95. Если `hit_ratio < 85%` → апгрейд Redis.  
- Для админских мгновенных уведомлений (панели капитана/судьи) можно держать WebSocket только в админ-панелях — это мало соединений и приемлемо.

---

## Короткий чек‑лист (порядок приоритетов)

1. Внедрить ETag fast‑path (Redis) и отдавать `304`.
2. Добавить time‑aware TTL + Match‑Window Helper и pre‑warm job (30m до матча).
3. Реализовать SWR + `SETNX` lock и публикацию `cache:update` при bump version.
4. Буферизация голосов → batch write каждые 5–10s. (пока голосование не реализовано в самом приложении)
5. Сжать payload / агрегировать ключи.
6. Настроить adaptive polling на клиенте.
7. Прогнать k6: realistic, worst‑case, prewarm on/off.
8. Мониторинг + алерты; апгрейд при `hit_ratio < 85%` или `evictions > 0`.

---

