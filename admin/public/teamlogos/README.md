Папка teamlogos: храните логотипы команд здесь.

Рекомендации по использованию:

- Разместите файлы в формате PNG/WebP/JPG, например: `spartak.png`, `zenit.webp`.
- Именование: используйте понятный slug (например, `team-slug` или `teamId`) без пробелов, только строчные буквы и дефисы.
- URL на фронтенде (Vite): `/teamlogos/<имя_файла>`, например `/teamlogos/spartak.png`.
- В продакшне абсолютный URL будет: `https://<ваш-домен>/teamlogos/spartak.png`.

Пример в React:

<img src={team.logoUrl || `/teamlogos/${team.slug}.png`} alt={team.name} />

Если хотите, могу также:

- Добавить placeholder-пустышку (placeholder.png).
- Пройтись по базе и сгенерировать имена файлов по slug/id и заполнить поле `logoUrl` в БД.
