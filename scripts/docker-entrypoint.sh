#!/bin/sh
set -eu
umask 077

root=/opt/night-bot
data=$root/data
config=$data/config/config.json
fail() { printf '%s\n' "$1" >&2; exit 1; }

[ "$#" -le 1 ] || fail 'Usage: docker-entrypoint.sh [run|--check]'
case "${1:-run}" in
  run|--check) action=${1:-run} ;;
  *) fail 'Usage: docker-entrypoint.sh [run|--check]' ;;
esac

# 自检不向持久卷写入 Node/pnpm 编译缓存；正常运行保留原缓存配置。
if [ "$action" = --check ]; then
  export NODE_DISABLE_COMPILE_CACHE=1
fi

[ "$(id -u)" -ne 0 ] || fail NIGHT_DOCKER_NON_ROOT_REQUIRED
[ "$HOME" = "$data/secrets/dws-system" ] || fail NIGHT_DOCKER_HOME_INVALID
[ "$DWS_CONFIG_DIR" = "$HOME/config" ] || fail NIGHT_DOCKER_DWS_CONFIG_INVALID
[ "$DWS_KEYCHAIN_DIR" = "$HOME/keychain" ] || fail NIGHT_DOCKER_DWS_KEYCHAIN_INVALID
[ "$XDG_CACHE_HOME" = "$data/cache" ] || fail NIGHT_DOCKER_CACHE_INVALID
[ "$TMPDIR" = "$data/temp" ] && [ "$TMP" = "$data/temp" ] && [ "$TEMP" = "$data/temp" ] || fail NIGHT_DOCKER_TEMP_INVALID
mountpoint --quiet "$data" || fail NIGHT_DOCKER_DATA_VOLUME_REQUIRED
cd "$root"
node --input-type=module <<'JS'
import {lstat,realpath,access} from 'node:fs/promises'
import {constants} from 'node:fs'
const path='/opt/night-bot/data',info=await lstat(path)
if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==path||info.uid!==process.getuid())throw new Error('NIGHT_DOCKER_DATA_OWNER_UNSAFE')
await access(path,constants.R_OK|constants.W_OK|constants.X_OK)
const temp=`${path}/temp`,tempInfo=await lstat(temp)
if(!tempInfo.isDirectory()||tempInfo.isSymbolicLink()||await realpath(temp)!==temp||tempInfo.uid!==process.getuid()||(tempInfo.mode&0o7777)!==0o700)throw new Error('NIGHT_DOCKER_TEMP_UNSAFE')
await access(temp,constants.R_OK|constants.W_OK|constants.X_OK)
JS

[ ! -L "$config" ] || fail NIGHT_DOCKER_CONFIGURATION_ALIAS_UNSAFE
if [ -e "$config" ]; then
  [ -f "$config" ] || fail NIGHT_DOCKER_CONFIGURATION_INVALID
fi
# 仅容器边界读取环境参数；Host 授权始终来自显式保存的配置。
permission_mode=${NIGHT_BOT_PERMISSION_MODE:-}
if [ -z "$permission_mode" ]; then
  if [ -f "$config" ]; then
    permission_mode=$(node --input-type=module -e 'import {loadConfig} from "./src/config.js";console.log((await loadConfig(process.argv[1])).permissionMode??"full")' "$config")
  else
    permission_mode=full
  fi
fi
case "$permission_mode" in ask|auto|full) ;; *) fail NIGHT_BOT_PERMISSION_MODE_INVALID ;; esac
# full 是产品默认无隔离档；显式受限档探针失败绝不自动退 full。
if [ "$permission_mode" != full ]; then
  if ! bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true; then
    fail NIGHT_DOCKER_BWRAP_UNAVAILABLE
  fi
fi
if [ "$action" = --check ]; then
  node --version
  pnpm --version
  if [ "$permission_mode" != full ]; then bwrap --version; fi
  printf '%s\n' NIGHT_DOCKER_PREFLIGHT_OK
  exit 0
fi

node --input-type=module <<'JS'
import {prepareRuntimePaths,runtimePaths} from './src/runtime/paths.js'
import {privateDirectory} from './src/runtime/files.js'
await prepareRuntimePaths(runtimePaths({installRoot:'/opt/night-bot',dataDir:'data'}))
for(const path of [process.env.HOME,process.env.DWS_CONFIG_DIR,process.env.DWS_KEYCHAIN_DIR])await privateDirectory(path)
JS
[ ! -L "$config" ] || fail NIGHT_DOCKER_CONFIGURATION_ALIAS_UNSAFE
if [ -e "$config" ]; then
  [ -f "$config" ] || fail NIGHT_DOCKER_CONFIGURATION_INVALID
  set -- "$config" model
  configure=update
else
  [ -n "${NIGHT_BOT_ACTOR_ID:-}" ] || fail NIGHT_DOCKER_ACTOR_REQUIRED
  set -- --actor "$NIGHT_BOT_ACTOR_ID" --root "$root" --permission-mode "$permission_mode"
  configure=initialize
fi
# 环境导入只发生在容器边界，现有 CLI 只接收显式 argv。
[ -z "${NIGHT_BOT_MODEL_PROVIDER:-}" ] || set -- "$@" --provider "$NIGHT_BOT_MODEL_PROVIDER"
[ -z "${NIGHT_BOT_MODEL:-}" ] || set -- "$@" --model "$NIGHT_BOT_MODEL"
[ -z "${NIGHT_BOT_MODEL_BASE_URL:-}" ] || set -- "$@" --base-url "$NIGHT_BOT_MODEL_BASE_URL"
[ -z "${NIGHT_BOT_MODEL_API:-}" ] || set -- "$@" --api "$NIGHT_BOT_MODEL_API"
[ -z "${NIGHT_BOT_MODEL_KEY_ENV:-}" ] || set -- "$@" --key-env "$NIGHT_BOT_MODEL_KEY_ENV"
if [ "$configure" = initialize ]; then
  node "$root/bin/night-bot-init.js" "$@"
elif [ "$#" -gt 2 ]; then
  node "$root/bin/night-bot-config.js" "$@" --check
  node "$root/bin/night-bot-config.js" "$@"
fi
if [ "$configure" = update ] && [ -n "${NIGHT_BOT_PERMISSION_MODE:-}" ]; then
  node "$root/bin/night-bot-config.js" "$config" permissions --permission-mode "$permission_mode" --check
  node "$root/bin/night-bot-config.js" "$config" permissions --permission-mode "$permission_mode"
fi
# Web 的容器发布仍使用通用 CLI，认证和同源检查归插件。
if node --input-type=module -e 'process.exit(Object.entries(process.env).some(([key,value])=>key.startsWith("NIGHT_BOT_WEB_")&&value)?0:1)'; then
  [ -n "${NIGHT_BOT_WEB_ENABLED:-}" ] || fail NIGHT_DOCKER_WEB_ENABLED_REQUIRED
  set -- "$config" web --enabled "$NIGHT_BOT_WEB_ENABLED"
  [ -z "${NIGHT_BOT_WEB_HOST:-}" ] || set -- "$@" --host "$NIGHT_BOT_WEB_HOST"
  [ -z "${NIGHT_BOT_WEB_PORT:-}" ] || set -- "$@" --port "$NIGHT_BOT_WEB_PORT"
  [ -z "${NIGHT_BOT_WEB_PUBLIC_ORIGIN:-}" ] || set -- "$@" --public-origin "$NIGHT_BOT_WEB_PUBLIC_ORIGIN"
  [ -z "${NIGHT_BOT_WEB_CHANNEL_ID:-}" ] || set -- "$@" --channel-id "$NIGHT_BOT_WEB_CHANNEL_ID"
  [ -z "${NIGHT_BOT_WEB_SENDER_ID:-}" ] || set -- "$@" --sender-id "$NIGHT_BOT_WEB_SENDER_ID"
  [ -z "${NIGHT_BOT_WEB_OPERATOR_NAME:-}" ] || set -- "$@" --operator-name "$NIGHT_BOT_WEB_OPERATOR_NAME"
  node "$root/bin/night-bot-config.js" "$@" --check
  node "$root/bin/night-bot-config.js" "$@"
fi
# 只有显式的供应商环境导入才加载可选插件 CLI；不在核心解释 DINGTALK_*。
if node --input-type=module -e 'process.exit(Object.entries(process.env).some(([key,value])=>key.startsWith("DINGTALK_")&&value)?0:1)'; then
  node "$root/bin/night-bot-dingtalk.js" "$config" env --check
  node "$root/bin/night-bot-dingtalk.js" "$config" env
fi
[ -f "$config" ] || fail NIGHT_DOCKER_CONFIGURATION_REQUIRED
exec node "$root/bin/night-bot-run.js" "$config"
