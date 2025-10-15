# Политика кэширования: Лига Обнинска (для роста до ~5 000 пользователей, старт на бесплатных Render сервисах)

## Цель
Надёжно обслуживать live-матчи и прогнозы при постепенном росте до ~5k пользователей, стартуя на бесплатных планах Render/Redis/БД.  
Применяются лучшие практики: versioned ETag fast-path, разделение static vs live, adaptive polling, буферизация голосов, защита от stampede и постепенный апгрейд инфраструктуры по метрикам.

---

## Общие правила

- **Versioned resources + ETag fast-path** — сначала O(1) проверка в Redis (ETag/version), только при miss строится payload.  
- **Split static ↔ live** — статичная часть: versioned + долгий TTL; live-часть (score, events): короткий TTL / push / adaptive polling.  
- **Event-driven invalidation** — bump версии при match_finalized, match_stats_update, vote_cast и т.д. TTL служит как запас.  
- **Buffer & batch** — массовые записи (голосования и т.п.) → Redis queue → batch write каждые 5–10 сек.  
- **Stampede protection** — SETNX/lock, SWR (serve stale while revalidate), отдавать stale или 202 вместо массовой регенерации.  
- **Compression & aggregation** — сжимать payload и агрегировать ключи (меньше ключей = меньше памяти).  
- **Error handling** — при ошибках Redis отдавать stale snapshot, не блокировать UI.
- **WebSocket только для админки:**  
    Используется только для администратора который зашел через логин и пароль в админ панель, так же и для других панелей, использующих авторизацию, это панель капитана, панель помощника, панель судьи.
    Клиенты (5000 пользователей) не используют WebSocket, только HTTP Polling + ETag.
---

## Схема кэш-ключей

Формат ключей:  
`категория:тип[:id][:version]`  
Ключи содержат версию или ETag (например, `etag:md:{match_id}`).

---

## Ресурсы и TTL (адаптировано под 5000 юзеров)

### 1. League (Лига) — versioned, TTL адаптивный
- `league:table` — versioned, TTL 30 с (сейчас совпадает с клиентским TTL); при активных матчах допускается снижение до 10–15 с на стороне бэкенда; инвалидация: match_finalized, match_results_update.  
- `league:schedule` — versioned, TTL 12 с (короткий поллинг для live‑расписания, пока нет фонового воркера); инвалидация: schedule_update.  
- `league:stats` — versioned, TTL 300 с; горячие live-поля кешируются отдельно (3–30 с); инвалидация: match_stats_update, match_finalized.  
- `league:results` — versioned, TTL 20 с (выравнено с клиентским TTL чтобы быстрее подтягивать обновления счёта); по мере стабилизации можно увеличивать до минут/часов; инвалидация: match_finalized.  
- `league:bracket` — versioned, TTL 1ч–24ч; инвалидация: bracket_update, match_finalized.

### 2. Match Details — split static / live
- `md:{match_id}:meta` — статичная часть (versioned, TTL 10 мин).  
- `md:{match_id}:live` — live-поля (score, cards, subs) TTL 3–5 с, автоудаление через 3 ч после окончания.  
- `etag:md:{match_id}` — текущая версия/ETag (atomic bump при изменениях).  
- **Push:** при событии публикуется patch; fallback — poll + ETag.

### 3. Predictions — быстрые инвалидации
- `predictions:list` — versioned, TTL 30–60 с, SWR 15–30 с.  
- `predictions:user:{user_id}` — TTL 15–60 с.  
- **Голосования:** Redis queue → batch write каждые 5–10 с → bump version → publish patch.

### 4. Leaderboards
- `lb:*` — versioned, TTL 3 600 с;

### 5. Achievements / Ads / Admin stats (пока не критично)
- Achievements — TTL 30 мин.  
- Ads — TTL 5–15 мин.  
- Admin stats — TTL 1–2 ч (event-driven инвалидация при финализации матчей).

### 6. Public aggregates / client store
- `public:matches:live` — TTL 3–5 с (SWR 10–15 с), приоритет push.  
- **Static assets** (JS, CSS, изображения) — long cache (1 год) + content hash в имени.

---

## Redis / память / стратегия на старте (бесплатный Render)

**Базовый план:** Free Redis (25MB, 50 connections) с жёсткой оптимизацией:  
- агрегировать ключи,  
- сжимать payload (gzip/msgpack),  
- хранить только ETag и минимальные hot payloadы.  

**Ограничения:**  
- быстрое заполнение памяти → использовать агрегированные ключи (`public:matches:live` вместо множества мелких).  
- хранить только snapshot или укороченный payload для live.  

**Пул соединений:** 6–8 подключений, не открывать коннект на каждый запрос.  

**Когда апгрейдить Redis:**  
- `evicted_keys > 0`,  
- `hit_ratio < 85%`,  
- требуется дольше хранить payload → переход на Starter (256MB).

---

## Поведение клиента (рекомендации)

- **Adaptive polling:** активные пользователи (live-страницы) — 3–5 с; остальные — 8–15 с.  
- **Клиентские интервалы (публичное приложение):** вкладка «Лига» — 10 с с паузой при скрытом документе, карточка клуба в Team View — 20 с; профиль пользователя — 90 с.  
- **ETag usage:** всегда отправлять `If-None-Match`; при `304` — продление TTL/SWR.  
- **WS/SSE (только админские панели):** получать patch → сбрасывать локальный TTL и обновлять store.  
- **Fallback:** при ошибках отдавать stale snapshot с пометкой «обновление…».

---

## Batch / фоновые процессы

- Голосования — Redis queue → batch write каждые 5–10 с.  
- Аггрегации (leaderboards, season stats) — фоновые воркеры или события `match_finalized`.

---

## Stampede protection и SWR

- При miss: `SETNX lock:res:{key}` — первый воркер генерирует cache, остальные получают stale или 202.  
- SWR (Serve While Revalidate): отдавать старый payload, пока идёт обновление.  
- При перегрузке: отдавать 202 или stale, чтобы не вызвать лавину запросов.

---

## Простая защита от частых запросов (rate limiting)

- **Ограничение:** 10 запросов / 10 секунд на IP для live-данных.  
- **При превышении:** отдавать `429 Too Many Requests` с заголовком `Retry-After`.  
- **Цель:** предотвратить злоупотребления и перегрузку Redis/БД без использования CAPTCHA.  
- **Применение:** к эндпоинтам live-матчей, прогнозов и статистики.

---

## Мониторинг и триггеры апгрейда

Отслеживать:
- `redis_hit_ratio`,  
- `evicted_keys`,  
- `used_memory`,  
- `connected_clients`,  
- `DB QPS`,  
- `p95 latency`,  
- `error rate`.  

**Апгрейд Redis → Starter (256MB):**  
при `hit_ratio < 85%` или `evicted_keys > 0`.  

**Апгрейд БД → PostgreSQL + pool:**  
при росте QPS или конкурентных записях (SQLite ограничен по concurrency).

---

## Использование бесплатного Render и дорожная карта апгрейда

- **Старт (free):** Free Render + Free Redis (25MB) + Free DB.  
  Аггрегировать ключи, сжимать payload, хранить в Redis только ETag и минимальные hot-поля.  
- **Тестирование:** k6 realistic / worst-case, смотреть Redis hit/miss и DB QPS.  
- **Переход:** сначала апгрейд Redis (256MB), затем DB и Render instance.  
- **Цель на 5k:** Redis 256–512MB, PostgreSQL с pool, Render Standard (RAM/CPU) или горизонтальное масштабирование.

---

## Короткий чек-лист для внедрения

- Разделить payload: static (versioned) / live (short TTL).  
- Реализовать ETag fast-path (Redis) и отдавать `304` при совпадении.  
- Буферизовать голосования в Redis queue → batch write каждые 5–10 с.  
- Настроить adaptive polling на клиенте (3–5 с для активных пользователей).  
- Сжать большие payload (gzip/msgpack) и агрегировать ключи.  
- Запустить нагрузочные тесты (k6) и мониторить hit_ratio/evictions/DB QPS.  
- При `hit_ratio < 85%` или `evictions > 0` → апгрейд Redis на Starter (256MB).
