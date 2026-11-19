# OpenGames с Windows через ChatGPT

Репозиторий — https://github.com/destover/OpenGames, рабочая ветка develop.
Рабочая копия — /opt/opengames/project в контейнере 230 opengames-donor на pve01.
Учётная запись SSH — opengames-dev, адрес контейнера — 192.168.1.138.
Windows должна иметь доступ к этой сети через локальную сеть или ваш VPN.

## 1. Настройка Windows

Установите актуальный клиент ChatGPT для Windows из Microsoft Store.

    winget install --id 9PLM9XGG6VKS -s msstore
    Test-NetConnection 192.168.1.138 -Port 22

Если OpenSSH Client отсутствует, установите его в «Параметры → Дополнительные компоненты».
Скачайте и выполните скрипт настройки подключения в PowerShell.

    Invoke-WebRequest https://raw.githubusercontent.com/destover/OpenGames/develop/scripts/setup-windows.ps1 -OutFile "$env:TEMP\OpenGames-Connect.ps1"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\OpenGames-Connect.ps1"

Скрипт создаст SSH-ключ Windows, добавит профиль opengames-230 и проверенный ключ сервера в known_hosts.
При создании ключа можно задать парольную фразу.
Скрипт выведет команду добавления публичного ключа. Выполните её в веб-интерфейсе Proxmox → pve01 → Shell.
Затем на Windows выполните:

    ssh opengames-230

Приватный ключ Windows хранится в %USERPROFILE%\.ssh\opengames_230_ed25519.

## 2. Авторизация на контейнере

GitHub CLI и Codex установлены на контейнере. Выполните с Windows:

    ssh -t opengames-230 "gh auth login --hostname github.com --git-protocol https --web"
    ssh -t opengames-230 "codex login --device-auth"

Завершите вход в браузере, используя показанные ссылки и коды. GitHub-аккаунт должен иметь право записи в destover/OpenGames.
Проверьте окружение:

    ssh opengames-230 "cd /opt/opengames/project && git status -sb && node --version && npm --version && codex --version"

## 3. Проект в ChatGPT

1. Откройте «Settings → Connections» в клиенте ChatGPT.
2. Добавьте SSH-host opengames-230 из SSH config.
3. Выберите удалённую папку /opt/opengames/project.
4. Назовите проект OpenGames и создайте в нём чат.
5. В первом сообщении укажите «Работаем в /opt/opengames/project, ветка develop. Прочитай AGENTS.md».

Быстрое открытие настроек подключения в PowerShell:

    Start-Process "codex://settings/connections/ssh/add?name=opengames-230"

Официальная инструкция — https://learn.chatgpt.com/docs/remote-connections#connect-to-an-ssh-host.
Установка Windows-клиента — https://learn.chatgpt.com/docs/windows/windows-app.

## 4. Работа и публикация

Терминал удалённого проекта уже работает в контейнере.

    cd /opt/opengames/project
    git pull --ff-only
    npm run typecheck
    npm run dev

Разработка использует порт 3001 и собственную папку data. Для браузерного просмотра откройте http://127.0.0.1:3001 на Windows при установленном SSH-соединении opengames-230.
Профиль SSH пробрасывает этот порт автоматически.
Для тестовой админки задайте OPENGAME_ADMIN_EMAIL в .env, зарегистрируйтесь с этим адресом и перезапустите сервер разработки.

Публикуется текущий коммит HEAD рабочей копии:

    git add <изменённые файлы>
    git commit -m "Описание изменения"
    git push origin develop
    sudo /usr/local/sbin/opengames-deploy

Команда публикации устанавливает зависимости, проверяет типы и синтаксис, сохраняет резервную копию данных, создаёт отдельный релиз и проверяет API после переключения.
Если приложение не запускается, команда возвращает предыдущий релиз.
После публикации проверьте https://opengames.duckdns.org/ и https://opengames.duckdns.org/api/health.

Публичный сайт использует /opt/opengames/current, данные — /opt/opengames/shared/data.
Учётные записи и ключи провайдеров разработки задаются в .env и интерфейсе экземпляра разработки.

## 5. Сохранённая работа с Mac

Рабочая копия develop основана на проверенной версии 0.0.48.
Исходники неопубликованной работы с Mac сохранены на контейнере в /opt/opengames/migration/mac-workspace.tar.gz.
Архив доступен пользователю opengames-dev для сверки с рабочей копией.
