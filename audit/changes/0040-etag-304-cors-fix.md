# 0040 — Исправление 304 Not Modified через CORS и fetch options

**Дата:** 16 октября 2025  
**Автор:** VSCode Agent

## Проблема

ETag-based кэширование не работало — клиент всегда получал 200 вместо 304, несмотря на правильную реализацию на бэкенде.

### Диагностика

1. **Бэкенд отдавал заголовки** (`ETag`, `X-Resource-Version`, `Cache-Control`) — проверено через curl/Invoke-WebRequest.
2. **Клиент не видел заголовки** — `response.headers.get('etag')` возвращал `null`.
3. **Браузерный HTTP-кэш** перехватывал запросы и возвращал закэшированный 200 с пустыми заголовками.

### Корневые причины

**1. CORS не экспонировал кастомные заголовки**  
По умолчанию браузер **блокирует** доступ к заголовкам, не указанным в `Access-Control-Expose-Headers`. Бэкенд отправлял `ETag` и `X-Resource-Version`, но CORS middleware не экспонировал их для JavaScript.

**2. Браузерный HTTP-кэш (default fetch behavior)**  
`fetch()` по умолчанию использует `cache: 'default'`, что позволяет браузеру кэшировать ответы и возвращать их без real network request. При этом браузер зачищает заголовки и подставляет 200 вместо 304.

**3. Redis не работал локально**  
Локальный Redis не был запущен, но это не критично — кэш работал на QuickLRU (in-memory), и версии корректно bumped через `multiLevelCache`.

## Решение

### 1. Добавить `exposedHeaders` в CORS (backend/src/server.ts)

```typescript
server.register(cors, {
  origin: true,
  credentials: true,
  exposedHeaders: ['ETag', 'X-Resource-Version', 'Cache-Control'],
})
```

**Эффект:** теперь `response.headers.get('etag')` возвращает значение.

### 2. Отключить браузерный HTTP-кэш через `fetch({ cache: 'no-store' })` (frontend/src/api/httpClient.ts)

```typescript
const response = await fetch(url, {
  ...rest,
  cache: 'no-store',
  headers: requestHeaders,
})
```

**Эффект:** браузер не кэширует ответы и всегда делает real network request, позволяя серверу вернуть 304.

### 3. Исправить ETag plugin (backend/src/plugins/etag.ts)

Плагин теперь:
- Не перезаписывает ETag, установленный маршрутом.
- Проверяет `If-None-Match` и возвращает 304, если совпадает.
- Fallback: генерирует weak ETag на основе sha1 body, если маршрут не установил свой.

### 4. Добавить `Cache-Control: no-cache` в league endpoints (backend/src/routes/leagueRoutes.ts)

```typescript
reply.header('Cache-Control', 'no-cache')
```

**Эффект:** сервер сигнализирует браузеру, что кэш нужно revalidate, но это дополнительно — основной fix через `exposedHeaders` и `fetch({ cache: 'no-store' })`.

## Результат

✅ **Клиент видит заголовки:**  
```javascript
{
  etag: "W/\"public:league:table:4:18\"",
  xResourceVersion: "18",
  cacheControl: "no-cache"
}
```

✅ **304 Not Modified работает:**  
```javascript
// Первый запрос
[httpRequest] http://localhost:3000/api/league/table?seasonId=4 status: 200
currentVersion: undefined
version: W/"public:league:table:4:18"

// Повторный запрос (через 35 секунд)
[httpRequest] http://localhost:3000/api/league/table?seasonId=4 status: 304
currentVersion: W/"public:league:table:4:18"
response: { ok: true, notModified: true }
```

✅ **Клиент передаёт `If-None-Match`:**  
Версия сохраняется в Zustand store (`tableVersions[seasonId]`) и отправляется через `httpRequest({ version })`.

✅ **Redis работает** (проверено через `docker exec -it my-redis redis-cli PING`), версии инкрементируются корректно.

## Затронутые файлы

- `backend/src/server.ts` — добавлен `exposedHeaders` в CORS
- `backend/src/routes/leagueRoutes.ts` — добавлен `Cache-Control: no-cache`
- `backend/src/plugins/etag.ts` — исправлена логика перезаписи ETag
- `frontend/src/api/httpClient.ts` — добавлен `cache: 'no-store'`
- `frontend/src/store/appStore.ts` — убраны debug логи

## Тестирование

1. Открыть http://localhost:5173/
2. Перейти на вкладку "Лига"
3. Ждать 35 секунд (TABLE_TTL_MS)
4. Перейти на "Главная", затем обратно на "Лига"
5. Проверить DevTools → Network: должны быть 304 для `/api/league/table`, `/api/league/seasons`, etc.

## Статус

✅ Реализовано  
✅ Протестировано через Chrome DevTools (MCP)  
✅ Redis работает локально  
✅ 304 Not Modified функционирует корректно
