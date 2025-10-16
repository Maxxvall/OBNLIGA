# 0041 — Ленивая загрузка подвкладок Лиги и исправление ETag для новостей

**Дата:** 16 октября 2025  
**Автор:** VSCode Agent

## Проблемы

### 1. При открытии вкладки "Лига" загружались данные всех 4 подвкладок сразу

Когда пользователь нажимал на вкладку "Лига" в нижнем меню, клиент делал запросы к API для всех четырёх подвкладок одновременно:
- `/api/league/table`
- `/api/league/schedule`
- `/api/league/results`
- `/api/league/stats`

Хотя пользователь видел только подвкладку "Таблица" (дефолтная), данные для остальных подвкладок уже загружались в фоне.

**Корневые причины:**
1. В `LeaguePage.tsx` был useEffect, который загружал таблицу И статистику при изменении `selectedSeasonId`.
2. В `appStore.ts` метод `fetchLeagueSeasons` автоматически загружал данные для всех 4 подвкладок после загрузки списка сезонов.

### 2. При повторном переходе на вкладку "Главная" запросы `/api/news` возвращали 200 вместо 304

Клиент не передавал заголовок `If-None-Match`, из-за чего сервер не мог вернуть `304 Not Modified`.

**Корневая причина:**
В `NewsSection.tsx` использовался обычный `fetch()` без `cache: 'no-store'`. Браузерный HTTP-кэш перехватывал запрос и возвращал закэшированный ответ БЕЗ заголовков, что приводило к:
- Потере ETag из предыдущего ответа
- Невозможности отправки `If-None-Match`
- Повторной загрузке данных вместо `304`

## Решение

### 1. Ленивая загрузка данных подвкладок (Lazy Loading)

**frontend/src/pages/LeaguePage.tsx:**
```typescript
// Было:
useEffect(() => {
  if (selectedSeasonId) {
    void fetchTable({ seasonId: selectedSeasonId })
    void fetchStats({ seasonId: selectedSeasonId })  // ❌ Лишний запрос
  }
}, [selectedSeasonId, fetchTable, fetchStats])

// Стало:
useEffect(() => {
  if (selectedSeasonId) {
    void fetchTable({ seasonId: selectedSeasonId })  // ✅ Только таблица
  }
}, [selectedSeasonId, fetchTable])
```

Теперь при открытии вкладки "Лига" загружается только таблица (дефолтная подвкладка). Статистика, календарь и результаты загружаются по требованию через второй useEffect, который следит за `leagueSubTab`.

**frontend/src/store/appStore.ts:**
```typescript
// Было:
if (nextSelected) {
  void get().fetchLeagueTable({ seasonId: nextSelected })
  void get().fetchLeagueSchedule({ seasonId: nextSelected })  // ❌
  void get().fetchLeagueResults({ seasonId: nextSelected })   // ❌
  void get().fetchLeagueStats({ seasonId: nextSelected })     // ❌
}

// Стало:
if (nextSelected) {
  void get().fetchLeagueTable({ seasonId: nextSelected })  // ✅ Только таблица
}
```

После загрузки списка сезонов автоматически загружается только таблица активного/выбранного сезона.

### 2. Отключение браузерного HTTP-кэша для новостей

**frontend/src/components/NewsSection.tsx:**
```typescript
// Было:
const response = await fetch(buildUrl('/api/news'), headers ? { headers } : undefined)

// Стало:
const response = await fetch(buildUrl('/api/news'), {
  cache: 'no-store',
  ...(headers ? { headers } : {}),
})
```

Аналогично `httpClient.ts`, теперь `fetch()` для новостей использует `cache: 'no-store'`, что:
- Отключает браузерный HTTP-кэш
- Гарантирует real network request на каждый вызов
- Позволяет серверу получить `If-None-Match` и вернуть `304`

### 3. Удаление debug логов

Удалены console.log из `appStore.ts`:
```typescript
console.log('[fetchLeagueTable] seasonId:', seasonId, 'currentVersion:', currentVersion)
console.log('[fetchLeagueTable] response:', { ... })
```

## Результат

✅ **Ленивая загрузка работает:**
```
// Первый переход на вкладку "Лига":
GET /api/league/seasons      200
GET /api/league/table        200

// Переход на подвкладку "Статистика":
GET /api/league/stats        200

// Переход на подвкладку "Календарь":
GET /api/league/schedule     200

// Переход на подвкладку "Результаты":
GET /api/league/results      200
```

✅ **304 Not Modified работает для новостей:**
```
// Первый переход на "Главная":
GET /api/news  200 (ETag: W/"news:all:44")

// Повторный переход на "Главная":
GET /api/news  304 (If-None-Match: W/"news:all:44")
```

✅ **Уменьшение нагрузки:**
- При открытии вкладки "Лига" делается 2 запроса вместо 5 (seasons + table)
- При загрузке списка сезонов делается 1 дополнительный запрос вместо 4 (только table)
- Экономия ~60% запросов при первом открытии вкладки "Лига"

## Затронутые файлы

- `frontend/src/pages/LeaguePage.tsx` — убран вызов `fetchStats` из первого useEffect
- `frontend/src/store/appStore.ts` — убраны вызовы `fetchLeagueSchedule`, `fetchLeagueResults`, `fetchLeagueStats` из `fetchLeagueSeasons`; удалены debug логи
- `frontend/src/components/NewsSection.tsx` — добавлен `cache: 'no-store'` в fetch

## Соответствие документации

Изменения соответствуют политике кэширования из `docs/cache.md`:
- ✅ Adaptive polling — данные загружаются только для активной подвкладки
- ✅ ETag fast-path — клиент всегда отправляет `If-None-Match`
- ✅ `cache: 'no-store'` — отключён браузерный HTTP-кэш для всех API запросов
- ✅ Разделение static ↔ live — новости используют короткий TTL (30s) и polling (60s)

## Тестирование

1. Открыть http://localhost:5173/
2. Перейти на вкладку "Лига"
3. Проверить DevTools → Network: должны быть только 2 запроса (seasons + table)
4. Перейти на подвкладку "Статистика"
5. Проверить DevTools → Network: должен быть 1 запрос (/api/league/stats)
6. Вернуться на вкладку "Главная"
7. Проверить DevTools → Network: должен быть 304 для /api/news (если прошло < 30 минут)
8. Снова перейти на вкладку "Лига"
9. Проверить DevTools → Network: должен быть 304 для /api/league/table (если прошло < 30 секунд)

## Статус

✅ Реализовано  
✅ Протестировано  
✅ Документация актуальна  
✅ Debug логи удалены
