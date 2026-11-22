#!/usr/bin/env bash
set -euo pipefail

mkdir -p e2e_artifacts_emulator
APK_FILE="$(find e2e_apk -name '*.apk' | head -n 1)"
META_FILE="$(find e2e_apk -name 'apk_build_meta.json' | head -n 1)"
test -f "$APK_FILE"
test -f "$META_FILE"

adb install -r "$APK_FILE"
adb shell appops set com.riyuewuxing.touzizhuanjia REQUEST_INSTALL_PACKAGES allow

python3 e2e/mock_server.py \
  --host 0.0.0.0 \
  --port 8502 \
  --dist-dir "$PWD/dist" \
  --public-base-url "http://10.0.2.2:8502" \
  --apk-path "$APK_FILE" \
  --apk-meta-json "$META_FILE" \
  --require-auth \
  > e2e_artifacts_emulator/mock_server.log 2>&1 &
MOCK_PID=$!

cleanup() {
  adb logcat -d -t 5000 > e2e_artifacts_emulator/logcat.txt || true
  kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8502/api/health >/dev/null; then
    break
  fi
  sleep 0.5
done

if ! curl -sf http://127.0.0.1:8502/api/health >/dev/null; then
  echo "mock_server failed to start" >&2
  cat e2e_artifacts_emulator/mock_server.log >&2 || true
  exit 1
fi

adb shell am start -W -n com.riyuewuxing.touzizhuanjia/.MainActivity
node e2e/verify_emulator_apk.mjs \
  --base-url http://127.0.0.1:8502 \
  --out-dir e2e_artifacts_emulator \
  --apk-meta-json "$META_FILE"
