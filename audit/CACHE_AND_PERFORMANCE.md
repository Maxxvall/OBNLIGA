# Кеширование и производительность

**Дата обновления:** 1 ноября 2025 г.  
**Статус:** Актуальная реализация

## Обзор стратегии кеширования

Система кеширования OBNLIGA построена на принципах:
- **Многоуровневый кеш** (LRU + Redis)
- **ETag/SWR** для минимизации трафика
- **Adaptive TTL** на основе матчевого окна
- **HTTP Polling** вместо WebSocket для публичного клиента
- **SETNX lock** для защиты от cache stampede

---

## Архитектура кеширования

### Многоуровневый кеш (Multilevel Cache)

**Файл:** `backend/src/cache/multilevelCache.ts`

#### Слои
1. **LRU (quick-lru)** — in-memory кеш, 500 ключей
2. **Redis** — распределённый кеш с pub/sub

#### Структура ключа
```
категория:тип[:id][:version]
```

Примеры:
- `league:table` — турнирная таблица
- `md:123:live` — live-данные матча 123
- `etag:md:123` — версия матча
- `ads:all` — рекламные баннеры

#### Версионирование

Каждый ключ имеет версию (fingerprint), которая увеличивается при изменении данных:

```typescript
{
  value: T,
  version: number,
  expiresAt: number,     // TTL
  staleUntil: number     // SWR граница
}
```

**ETag формат:** `W/"{cacheKey}:{version}"`

Например: `W/"league:table:123:15"`

#### API

```typescript
// Получить с автоподгрузкой
const { value, version, hit } = await defaultCache.getWithMeta(
  'league:table',
  async () => { /* loader */ },
  { ttlSeconds: 300, staleWhileRevalidateSeconds: 60 }
)

// Записать
await defaultCache.set('league:table', data, { ttlSeconds: 300 })

// Инвалидировать
await defaultCache.invalidate('league:*')
```

#### Stale-While-Revalidate (SWR)

При промахе или устаревании:
1. Проверяем, есть ли данные в stale периоде
2. Если да — отдаём stale данные сразу
3. Асинхронно регенерируем новые данные
4. Только один процесс регенерирует (SETNX lock)

**Поток:**
```
Запрос → Кеш проверка → Hit? → Отдать
                      ↓ Miss
                  Stale есть? → Отдать + Фоновая регенерация
                      ↓ Нет
                  Lock проверка → Занят? → Ждать
                      ↓ Свободен
                  Захватить lock → Регенерировать → Записать → Отдать
```

---

## Match-Window Helper

**Файл:** `backend/src/cache/matchWindowHelper.ts`

### Назначение

Автоматически определяет "матчевое окно" — период повышенной активности, когда требуются короткие TTL.

### Параметры (ENV)

```bash
MATCH_WINDOW_LOOKAHEAD_DAYS=7        # Смотрим на 7 дней вперёд
MATCH_WINDOW_PREWARM_MINUTES=45      # Прогрев за 45 мин до матчей
MATCH_WINDOW_POST_GRACE_MINUTES=30   # Горячий период 30 мин после
```

### Расчёт окна

1. Читает ближайшие матчи из БД на `LOOKAHEAD_DAYS` дней
2. Вычисляет границы окна:
   - `prewarmStart` = первый матч минус `PREWARM_MINUTES`
   - `liveEnd` = последний матч плюс `POST_GRACE_MINUTES`
3. Кеширует результат на 30 секунд в Redis

### Adaptive TTL

**API:** `resolveCacheOptions(resource)`

Возвращает `{ ttlSeconds, staleWhileRevalidateSeconds, lockTimeoutSeconds }` в зависимости от:
- Тип ресурса (table, schedule, results, stats)
- Находимся ли в матчевом окне

**Таблица TTL:**

| Ресурс | В матч-окне | Вне окна |
|--------|-------------|----------|
| `leagueTable` | 30s | 7 дней |
| `leagueSchedule` | 20s | 7 дней |
| `leagueResults` | 15s | 15 минут |
| `leagueStats` | 45s | 1 час |

**Stale период** (SWR):
- В окне: 50-75% от TTL
- Вне окна: 50% от TTL

### Pre-warm (прогрев)

**Файл:** `backend/src/services/cachePrewarm.ts`

**Функция:** `maybePrewarmPublicLeagueCaches()`

Прогревает ключи за 45 минут до первых матчей:
- `league:table`
- `league:schedule`
- `league:results`
- `league:stats`

**Вызов:**
- Вручную: `POST /api/cache/prewarm` с токеном `x-prewarm-token`
- Автоматически: из cron/воркера (планируется)

---

## ETag и HTTP Polling

### Сервер (Backend)

**Плагин ETag:** `backend/src/plugins/etag.ts`

При ответе:
1. Проверяет `If-None-Match` из запроса
2. Сравнивает с текущей версией ключа
3. Если совпадает → `304 Not Modified` (без body)
4. Если не совпадает → `200 OK` с данными и ETag

**Заголовки:**
- `ETag: W/"{cacheKey}:{version}"`
- `X-Resource-Version: {version}` (альтернатива)
- `Cache-Control: private, must-revalidate`

**CORS:** exposedHeaders включает `ETag`, `X-Resource-Version`

### Клиент (Frontend)

**HTTP клиент:** `frontend/src/api/httpClient.ts`

При запросе:
1. Проверяет наличие сохранённой версии
2. Добавляет `If-None-Match: {etag}` в заголовки
3. Обрабатывает ответ:
   - `304` → продлевает TTL, возвращает `{ ok: true, notModified: true }`
   - `200` → обновляет данные и версию, возвращает `{ ok: true, data, version }`
   - `4xx/5xx` → возвращает `{ ok: false, error, status }`

### HTTP Polling (публичный фронт)

**Вместо WebSocket** публичный клиент использует интервальные запросы с ETag.

**Интервалы:**

| Экран | Интервал | Приостановка |
|-------|----------|--------------|
| Новости (`NewsSection`) | 60s | При `document.hidden` |
| Лига (`LeaguePage`) | 10s | При смене вкладки или `hidden` |
| Карточка клуба (`TeamView`) | 20s | При закрытии карточки |
| Профиль (`Profile`) | 90s | При `hidden` |

**Адаптивность:**
- При `document.hidden === true` — тики прерываются
- При возврате — немедленный запрос с `force: true`
- Lazy loading — запросы только для активной подвкладки

**Почему не WebSocket?**
1. Проще горизонтальное масштабирование
2. Меньше нагрузка на сервер (нет постоянных соединений)
3. ETag минимизирует трафик (304 без body)
4. Telegram WebApp может убивать соединения в фоне

---

## TTL конфигурация

### Backend (adaptive)

Управляется через `matchWindowHelper.resolveCacheOptions()`:

**League ресурсы:**
```typescript
// В матч-окне
leagueTable: { ttl: 30s, swr: 15s }
leagueSchedule: { ttl: 20s, swr: 10s }
leagueResults: { ttl: 15s, swr: 8s }
leagueStats: { ttl: 45s, swr: 30s }

// Вне окна
leagueTable: { ttl: 7d, swr: 3.5d }
leagueSchedule: { ttl: 7d, swr: 3.5d }
leagueResults: { ttl: 15min, swr: 7.5min }
leagueStats: { ttl: 1h, swr: 30min }
```

**Другие ресурсы:**
```typescript
news: { ttl: 60s, swr: 30s }
ads: { ttl: 600s, swr: 300s }
clubSummary: { ttl: 45s, swr: 22s }
clubMatches: { ttl: 90s, swr: 45s }
profile: { ttl: 90s, swr: 45s }
```

### Frontend (in-memory TTL)

**appStore timestamps:**
```typescript
seasonsFetchedAt: 55_000ms
tableFetchedAt: 30_000ms (per season)
scheduleFetchedAt: 12_000ms
resultsFetchedAt: 20_000ms
statsFetchedAt: 300_000ms
teamSummaryFetchedAt: 45_000ms
teamMatchesFetchedAt: 90_000ms
```

**localStorage TTL:**
```typescript
news: 30 минут
profile: 5 минут
```

---

## Оптимизации производительности

### 1. Merge helpers (минимизация перерисовок)

**Файл:** `frontend/src/store/appStore.ts`

При получении данных с сервера:
- Сравниваем новые данные с предыдущими
- Переиспользуем ссылки на неизменившиеся объекты
- React `memo` не триггерит перерисовку, если ссылки идентичны

**Примеры:**
```typescript
mergeLeagueTable(prev, incoming) {
  // Сравниваем каждый клуб
  incoming.clubs.forEach(newClub => {
    const oldClub = prev.clubs.find(c => c.id === newClub.id)
    if (oldClub && isEqual(oldClub, newClub)) {
      // Переиспользуем старую ссылку
      clubs.push(oldClub)
    } else {
      clubs.push(newClub)
    }
  })
}
```

### 2. SETNX lock (cache stampede protection)

При промахе кеша множество запросов может одновременно попытаться регенерировать данные.

**Защита:**
1. Локальный lock в памяти (Map)
2. Redis SETNX для распределённой защиты
3. Timeout lock (30s по умолчанию)
4. Ожидание освобождения с retry

**Код:**
```typescript
const lockKey = `lock:${cacheKey}`
const acquired = await redis.set(lockKey, '1', 'EX', 30, 'NX')
if (!acquired) {
  // Кто-то уже регенерирует, ждём
  await sleep(100)
  return getWithMeta(key, loader, opts) // Retry
}
try {
  const data = await loader()
  await set(key, data, opts)
  return { value: data, version, hit: false }
} finally {
  await redis.del(lockKey)
}
```

### 3. Lazy loading

**Принцип:** загружаем данные только когда нужно.

**Реализация:**
- Вкладка "Лига" → запрашивает только активную подвкладку
- Карточка клуба → данные загружаются при открытии
- Polling стартует/останавливается динамически

**Эффект:**
- Меньше трафика
- Меньше нагрузка на сервер
- Быстрее первичная загрузка

### 4. Compression

**Backend:** `@fastify/compress`
- gzip, brotli для всех ответов
- Автоматически для payload > 1KB

**Эффект:** снижение размера ответов на 60-80%

### 5. Batch operations (планируется)

Голосования и мелкие обновления → Redis queue → batch write в БД каждые 5-10s.

---

## Инвалидация кеша

### Триггеры

**Backend events:**
- `match_finalized` → инвалидация `league:*`, `md:{id}:*`
- `match_results_update` → инвалидация `league:results`, `season:{id}:*`
- `news_created` → инвалидация `news:all`
- `ad_updated` → инвалидация `ads:all`
- `lineup_submitted` → broadcast `match:{id}:lineup`

### Механизм

1. При изменении данных в БД
2. Увеличиваем версию ключа в Redis
3. Публикуем событие в Redis pub/sub (для WebSocket)
4. Инвалидируем связанные ключи через паттерн

**Код:**
```typescript
await defaultCache.invalidate('league:*')
await defaultCache.invalidate(`season:${seasonId}:*`)
```

### WebSocket broadcast (админка)

**Топики:**
- `match:{id}:stats` — обновление статистики матча
- `match:{id}:events` — новые события
- `season:{id}:table` — обновление таблицы
- `home` — новости и баннеры

**Клиент (admin):**
```typescript
ws.subscribe('match:123:stats')
ws.on('message', (msg) => {
  if (msg.type === 'full') {
    store.updateMatchStats(msg.payload)
  }
})
```

---

## Мониторинг производительности

### Текущие метрики

**Backend:**
- Fastify logger: время ответа, статус коды
- Cache hit/miss логируется в `defaultCache.getWithMeta`

**Frontend:**
- `console.log` для cache misses
- Performance API для TTL tracking

### Планируемые метрики (Phase 9)

**Backend:**
- Prometheus: cache hit rate, response time, queue size
- Sentry: errors, performance traces

**Frontend:**
- Sentry: errors, web vitals (LCP, FID, CLS)
- Custom metrics: polling intervals, cache efficiency

---

## Best Practices

### 1. Всегда используй ETag
```typescript
const headers = version ? { 'If-None-Match': version } : {}
const response = await fetch(url, { headers })
if (response.status === 304) {
  // Данные не изменились, продли TTL
  updateFetchedAt(resource, Date.now())
}
```

### 2. Adaptive TTL для live-данных
```typescript
const opts = matchWindowHelper.resolveCacheOptions('leagueTable')
const { value, version } = await defaultCache.getWithMeta(
  'league:table',
  loader,
  opts
)
```

### 3. Merge вместо replace
```typescript
// ❌ Плохо
setState({ clubs: incoming.clubs })

// ✅ Хорошо
setState({ clubs: mergeLeagueTable(state.clubs, incoming.clubs) })
```

### 4. Lazy polling
```typescript
// Стартуем только когда вкладка активна
if (currentTab === 'league') {
  ensureLeaguePolling()
} else {
  stopLeaguePolling()
}
```

### 5. Graceful degradation
```typescript
// При ошибке показываем старые данные
if (!response.ok) {
  console.error('Fetch failed, using cached data')
  return { ok: false, error: 'network_error' }
}
```

---

## Ограничения и компромиссы

### Текущие ограничения

1. **Redis Single-Instance**
   - Нет репликации на бесплатном плане Render
   - Риск потери кеша при рестарте Redis
   - Mitigation: LRU слой + graceful degradation

2. **LRU размер 500 ключей**
   - Может быть мало при росте
   - Mitigation: приоритезация hot keys

3. **HTTP Polling нагрузка**
   - При 1000 одновременных пользователей ~ 100 RPS
   - Mitigation: ETag возвращает 304 без body, adaptive TTL

4. **Отсутствие CDN**
   - Static assets на Render без CDN
   - Mitigation: compression, cache headers

### Компромиссы

**WebSocket vs HTTP Polling:**
- Выбрали Polling для публичного клиента
- ✅ Проще масштабировать
- ✅ Меньше нагрузка на сервер
- ❌ Задержка до 10s для live-обновлений
- Решение: для критичных сценариев (судейская панель) используем WebSocket

**Длинные TTL vs Актуальность:**
- Вне матч-окна TTL = 7 дней
- ✅ Минимальная нагрузка
- ❌ Изменения видны не сразу
- Решение: инвалидация при изменениях + версионирование

---

Документ обновляется при изменении стратегии кеширования или метрик производительности.
