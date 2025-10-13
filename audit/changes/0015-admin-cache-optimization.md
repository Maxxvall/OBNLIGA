# 0015 — Admin cache optimization

## Summary
- добавлен кеш для статистических эндпойнтов админки (`season:*`, `competition:*`, `league:*`, `club:*`) с TTL и сериализацией через `MultiLevelCache`
- расширена инвалидация при финализации матча (карьерная статистика, клубные ключи)
- реализован клиентский SWR на `adminStore` с TTL по вкладкам и параметрам (сезон/турнир)
- обновлена документация (`docs/cache.md`, `docs/state.md`) в соответствии с новой схемой кеширования

## Testing
- `npm run build` (backend)
- `npm run build` (admin)
