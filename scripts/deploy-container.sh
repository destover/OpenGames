#!/usr/bin/env bash
set -euo pipefail
test "$#" -eq 0
export PATH=/opt/opengames/runtime/node-v22.23.1-linux-x64/bin:/usr/sbin:/usr/bin:/sbin:/bin
repo=/opt/opengames/project
exec 9>/run/lock/opengames-deploy.lock
flock -n 9 || { echo 'Другая публикация ещё выполняется' >&2; exit 1; }
commit=$(runuser -u opengames-dev -- git -C "$repo" rev-parse HEAD)
short=${commit:0:12}
release="/opt/opengames/releases/$(date -u +%Y%m%dT%H%M%SZ)-$short"
previous=$(readlink -f /opt/opengames/current)
install -d -m 755 "$release"
runuser -u opengames-dev -- git -C "$repo" archive HEAD | tar xf - --no-same-owner -C "$release"
chown -R opengames-dev:opengames-dev "$release"
runuser -u opengames-dev -- bash -ec 'cd "$1"; npm ci --no-audit --no-fund; npm run typecheck; node --check web/app.js; node --check web/admin.js; npm prune --omit=dev --no-audit --no-fund' bash "$release"
rm -rf "$release/data" "$release/.env"
ln -s /opt/opengames/shared/data "$release/data"
ln -s /opt/opengames/shared/.env "$release/.env"
if [ -d /opt/opengames/shared/downloads ]; then
  rm -rf "$release/web/downloads"
  ln -s /opt/opengames/shared/downloads "$release/web/downloads"
fi
chown -R -P opengames:opengames "$release"
umask 077
restore() {
  code=$?
  trap - ERR
  ln -sfnT "$previous" /opt/opengames/current
  systemctl restart opengames
  exit "$code"
}
trap restore ERR
systemctl stop opengames
backup="/opt/opengames/before-deploy-$(date -u +%Y%m%dT%H%M%SZ).tgz"
tar czf "$backup" -C /opt/opengames/shared .env data
ln -sfnT "$release" /opt/opengames/current
systemctl start opengames
curl --silent --show-error --fail --retry 8 --retry-connrefused --retry-delay 1 --max-time 8 http://127.0.0.1:3000/api/health
trap - ERR
printf '\nPublished %s\n%s\n' "$commit" "$release"
