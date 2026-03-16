#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ADB_BIN="${ADB_BIN:-$ANDROID_SDK_ROOT/platform-tools/adb}"
EMULATOR_BIN="${EMULATOR_BIN:-$ANDROID_SDK_ROOT/emulator/emulator}"
GRADLE_BIN="${GRADLE_BIN:-gradle}"
AVD_NAME="${AVD_NAME:-LoveAlbum_API35}"
APP_ID="${APP_ID:-dev.sharepaste.android}"
MAIN_ACTIVITY="${MAIN_ACTIVITY:-dev.sharepaste.android.MainActivity}"
SERVER_HOST="${SERVER_HOST:-0.0.0.0}"
SERVER_PORT="${SERVER_PORT:-50052}"
EMULATOR_SERVER="${EMULATOR_SERVER:-10.0.2.2:$SERVER_PORT}"
BOOT_TIMEOUT_SECONDS="${BOOT_TIMEOUT_SECONDS:-180}"
SERVER_LOG="${SERVER_LOG:-/tmp/sharepaste-android-server.log}"
EMULATOR_LOG="${EMULATOR_LOG:-/tmp/sharepaste-android-emulator.log}"
TARGET_SERIAL=""
APK_PATH=""

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1 && [ ! -x "$bin" ]; then
    echo "Missing required binary: $bin" >&2
    exit 1
  fi
}

first_available_avd() {
  local avd_dir="${HOME}/.android/avd"
  if [ ! -d "$avd_dir" ]; then
    return 1
  fi

  local first_ini
  first_ini="$(find "$avd_dir" -maxdepth 1 -name '*.ini' | sort | head -n 1 || true)"
  if [ -z "$first_ini" ]; then
    return 1
  fi
  basename "$first_ini" .ini
}

ensure_avd_name() {
  local avd_dir="${HOME}/.android/avd"
  if [ -f "$avd_dir/${AVD_NAME}.ini" ]; then
    return 0
  fi

  local fallback
  fallback="$(first_available_avd || true)"
  if [ -z "$fallback" ]; then
    echo "No Android AVD found. Create one in Android Studio first." >&2
    exit 1
  fi
  AVD_NAME="$fallback"
}

ensure_server() {
  if lsof -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Server already listening on port $SERVER_PORT"
    return 0
  fi

  echo "Starting local SharePaste server on ${SERVER_HOST}:${SERVER_PORT}"
  SHAREPASTE_HOST="$SERVER_HOST" \
  SHAREPASTE_PORT="$SERVER_PORT" \
  SHAREPASTE_STORAGE_MODE="${SHAREPASTE_STORAGE_MODE:-memory}" \
  nohup bash scripts/start-server.sh >"$SERVER_LOG" 2>&1 &

  local waited=0
  until lsof -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge 30 ]; then
      echo "Server failed to start. Check $SERVER_LOG" >&2
      exit 1
    fi
  done
}

emulator_serial() {
  "$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" && $1 ~ /^emulator-/ { print $1; exit }'
}

ensure_emulator() {
  local serial
  serial="$(emulator_serial || true)"
  if [ -n "$serial" ]; then
    echo "Using running Android device: $serial"
    TARGET_SERIAL="$serial"
    return 0
  fi

  echo "Starting emulator AVD: $AVD_NAME"
  nohup "$EMULATOR_BIN" -avd "$AVD_NAME" >"$EMULATOR_LOG" 2>&1 &

  local waited=0
  until serial="$(emulator_serial || true)"; [ -n "$serial" ]; do
    sleep 2
    waited=$((waited + 2))
    if [ "$waited" -ge "$BOOT_TIMEOUT_SECONDS" ]; then
      echo "Timed out waiting for emulator to appear in adb. Check $EMULATOR_LOG" >&2
      exit 1
    fi
  done
  TARGET_SERIAL="$serial"

  echo "Waiting for Android boot completion"
  "$ADB_BIN" -s "$TARGET_SERIAL" wait-for-device >/dev/null
  waited=0
  until [ "$("$ADB_BIN" -s "$TARGET_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 2
    waited=$((waited + 2))
    if [ "$waited" -ge "$BOOT_TIMEOUT_SECONDS" ]; then
      echo "Timed out waiting for Android to finish booting. Check $EMULATOR_LOG" >&2
      exit 1
    fi
  done
}

build_apk() {
  echo "Building Android debug APK"
  "$GRADLE_BIN" -p apps/mobile-android :app:assembleDebug

  APK_PATH="$(find apps/mobile-android/app/build/outputs/apk/debug -name '*debug*.apk' | sort | head -n 1 || true)"
  if [ -z "$APK_PATH" ] || [ ! -f "$APK_PATH" ]; then
    echo "Debug APK not found after build." >&2
    exit 1
  fi
}

install_apk() {
  echo "Installing APK on $TARGET_SERIAL"
  "$ADB_BIN" -s "$TARGET_SERIAL" install -r "$APK_PATH" >/tmp/sharepaste-android-install.log

  if ! "$ADB_BIN" -s "$TARGET_SERIAL" shell pm path "$APP_ID" >/dev/null 2>&1; then
    echo "Package $APP_ID is not installed on $TARGET_SERIAL" >&2
    exit 1
  fi
}

connect_emulator_to_host() {
  echo "Configuring emulator networking"
  "$ADB_BIN" -s "$TARGET_SERIAL" reverse "tcp:${SERVER_PORT}" "tcp:${SERVER_PORT}" >/dev/null || true
}

unlock_and_prepare_home() {
  "$ADB_BIN" -s "$TARGET_SERIAL" shell input keyevent 82 >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$TARGET_SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$TARGET_SERIAL" shell input keyevent 3 >/dev/null 2>&1 || true
}

launch_app() {
  echo "Launching app preview"
  local output
  output="$("$ADB_BIN" -s "$TARGET_SERIAL" shell am start -W \
    -n "${APP_ID}/${MAIN_ACTIVITY}" \
    --es "${APP_ID}.launch" "preview" \
    --es "server" "$EMULATOR_SERVER" 2>&1)"

  if printf '%s' "$output" | rg -q 'Error|Exception|does not exist'; then
    echo "$output" >&2
    exit 1
  fi

  local resumed
  resumed="$("$ADB_BIN" -s "$TARGET_SERIAL" shell dumpsys activity activities 2>/dev/null | rg -m 1 'mResumedActivity|topResumedActivity' || true)"
  if ! printf '%s' "$resumed" | rg -q "$APP_ID"; then
    echo "App launch could not be verified. Current foreground activity: ${resumed:-unknown}" >&2
    echo "$output" >&2
    exit 1
  fi
}

print_summary() {
  echo
  echo "SharePaste Android preview is ready."
  echo "AVD: $AVD_NAME"
  echo "Device serial: $TARGET_SERIAL"
  echo "Server: $EMULATOR_SERVER"
  echo "APK: $APK_PATH"
  echo "Server log: $SERVER_LOG"
  echo "Emulator log: $EMULATOR_LOG"
}

require_bin "$GRADLE_BIN"
require_bin "$ADB_BIN"
require_bin "$EMULATOR_BIN"
ensure_avd_name
ensure_server
ensure_emulator
connect_emulator_to_host
build_apk
install_apk
unlock_and_prepare_home
launch_app
print_summary
