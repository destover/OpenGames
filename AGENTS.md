# OpenGames

Отвечай кратко по-русски, решай рабочие вопросы самостоятельно, следуй стилю проекта.
Код проекта находится в /opt/opengames/project, рабочая ветка develop, origin https://github.com/destover/OpenGames.git.
Среда — Node.js 22.23.1, TypeScript запускается через --experimental-strip-types.
Команды проверки — npm run typecheck, node --check web/app.js, node --check web/admin.js.
Локальный запуск — npm run dev. Порт разработки 3001, адрес 127.0.0.1. Данные разработки находятся в data/ этой рабочей копии.
Публичный сайт использует /opt/opengames/current. Общие данные и секреты сайта находятся в /opt/opengames/shared.
Исходники, инструкции и package-lock.json версионируются Git. .env, данные пользователей и ключи хранятся вне Git.
Публикация текущего коммита — sudo /usr/local/sbin/opengames-deploy. После публикации проверяй публичный сайт и /api/health.
