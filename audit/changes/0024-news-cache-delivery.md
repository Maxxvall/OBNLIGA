# 0024-news-cache-delivery

Дата: 10 октября 2025 г.
Ответственный: GitHub Copilot

## Что было
- `/api/news` обслуживал кэшированный payload с TTL в 7 дней и HTTP `Cache-Control: max-age=86400`, из-за чего Render CDN и браузеры раздавали устаревшие данные даже после инвалидации ключа.
- Админ-панель и публичный storefront отправляли запросы без принудительной ре-валидации (`Cache-Control: max-age=86400`), поэтому пользователи видели «пропадающие» новости после ручного обновления ленты.
- Публикация новости с галочкой «Отправить в Telegram» зависела от очереди BullMQ. Без `REDIS_URL` задача не ставилась и уведомление не отправлялось.

## Что стало
### 1. Быстрая инвалидация и принудительная ре-валидация
- `backend/src/routes/newsRoutes.ts`
  - TTL кэша уменьшен до 30 сек, HTTP заголовок обновлён: `max-age=15`, `stale-while-revalidate=45`, `must-revalidate`.
- `admin/src/store/adminStore.ts`
  - Запрос `fetchNews` добавляет `cache: 'no-store'`, `Cache-Control: no-cache`, `Pragma: no-cache` для обхода промежуточных кэшей.
- `frontend/src/components/NewsSection.tsx`
  - Публичный клиент использует аналогичные директивы, чтобы мобильный WebApp и Telegram WebView моментально подтягивали свежие публикации.
- `docs/cache.md`
  - Зафиксирована политика: `public:news:list` — TTL 30 c, SWR 45 c, WS topic `home`.

### 2. Telegram-уведомления без Redis
- `backend/src/queue/newsWorker.ts`
  - Вынесена единая функция `performTelegramSend`, добавлен экспорт `deliverTelegramNewsNow` для прямой отправки.
- `backend/src/routes/adminRoutes.ts`
  - После попытки постановки в очередь выполняется fallback: при недоступной очереди сообщение уходит напрямую в Telegram, ошибки логируются с причиной.

## Тестирование
- Открыта админ-панель `https://obnliga.onrender.com` → опубликованы тестовые новости (с/без Telegram), проверена мгновенная синхронизация и кнопка «Обновить ленту».
- В публичном приложении `https://futbol-league-frontend.onrender.com` и Telegram WebView новости обновились без перезагрузки.
- Очередь отключена (нет `REDIS_URL`) → уведомление доставлено через direct fallback, логи подтверждают отправку.

## Замечания
- Тестовые записи «Тест публикация …» оставлены для валидации. После проверки удалить их вручную (через SQL или будущий CRUD).
- Для окончательной надёжности рекомендуется выставить `REDIS_URL` в Render Dashboard — тогда fallback будет работать как резерв.
