#!/usr/bin/env bash
# Wrapper for pw-loopback with idle auto-shutdown.
#
# Starts pw-loopback and monitors for active consumers (browser getUserMedia).
# When no consumer connects for IDLE_TIMEOUT seconds, the wrapper exits
# and the systemd service stops → mic icon goes off.
#
# Consumer detection: checks if any PipeWire links exist FROM the
# Huddle_Audio_Capture playback ports. Links are created when the
# browser's getUserMedia connects to the virtual source.

set -euo pipefail

IDLE_TIMEOUT=${HUDDLE_CAPTURE_IDLE_TIMEOUT:-30}
CHECK_INTERVAL=5
NODE_NAME="Huddle_Audio_Capture"
GRACE_PERIOD=60  # seconds before idle detection starts (user needs time to open visualizer)

pw-loopback \
  --capture-props='media.class=Stream/Input/Audio stream.capture.sink=true node.name=huddle_capture_in audio.position=[FL,FR]' \
  --playback-props="media.class=Audio/Source node.name=${NODE_NAME} node.description=\"Huddle Audio Capture\" audio.position=[FL,FR]" &
PW_PID=$!

cleanup() {
  kill "$PW_PID" 2>/dev/null || true
  wait "$PW_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "[huddle-capture] pw-loopback started (PID=$PW_PID), grace period ${GRACE_PERIOD}s"

# Grace period: don't check for idle right after start.
# User might need time to open the visualizer.
sleep "$GRACE_PERIOD"

idle_seconds=0

while kill -0 "$PW_PID" 2>/dev/null; do
  # Check if any PipeWire links exist FROM our playback ports
  if pw-link -ol 2>/dev/null | grep -q "${NODE_NAME}:playback"; then
    # Someone is consuming — reset idle counter
    if [ "$idle_seconds" -gt 0 ]; then
      echo "[huddle-capture] Consumer connected, resetting idle timer"
    fi
    idle_seconds=0
  else
    idle_seconds=$((idle_seconds + CHECK_INTERVAL))
    if [ "$idle_seconds" -ge "$IDLE_TIMEOUT" ]; then
      echo "[huddle-capture] No consumer for ${IDLE_TIMEOUT}s, shutting down"
      exit 0  # trap will kill pw-loopback
    fi
  fi
  sleep "$CHECK_INTERVAL"
done

echo "[huddle-capture] pw-loopback exited unexpectedly"
exit 1
