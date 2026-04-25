#!/usr/bin/env bash
# Setup persistent PipeWire loopback for Huddle Audio Capture.
#
# Creates a systemd user service that runs pw-loopback to tap the
# default audio output's monitor and expose it as an input source
# named "Huddle Audio Capture". This is the workaround for Chromium
# not exposing PipeWire monitor sources in enumerateDevices().
#
# The visualizer's Strategy 0 auto-detects this source by name.
#
# Usage: ./scripts/setup-audio-capture.sh [install|uninstall|status]

set -euo pipefail

SERVICE_NAME="huddle-audio-capture"
SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"

cmd_install() {
  # Check dependencies
  if ! command -v pw-loopback &>/dev/null; then
    echo "Error: pw-loopback not found."
    echo "Install: sudo apt install pipewire-utils  (or equivalent)"
    exit 1
  fi

  if ! systemctl --user is-active pipewire.service &>/dev/null; then
    echo "Error: PipeWire is not running."
    exit 1
  fi

  mkdir -p "$(dirname "$SERVICE_FILE")"

  # Find the wrapper script (same directory as this setup script)
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  WRAPPER="$SCRIPT_DIR/huddle-audio-capture-wrapper.sh"

  if [ ! -x "$WRAPPER" ]; then
    echo "Error: Wrapper script not found or not executable: $WRAPPER"
    echo "Run: chmod +x $WRAPPER"
    exit 1
  fi

  cat > "$SERVICE_FILE" << UNIT
[Unit]
Description=Huddle Audio Capture (PipeWire loopback with idle auto-shutdown)
Documentation=Strategy 0 in audio-capture.ts — Chromium monitor source workaround
After=pipewire.service
BindsTo=pipewire.service

[Service]
Type=simple
# Wrapper starts pw-loopback and monitors for active consumers.
# When no browser is connected for 30s, the wrapper exits → service stops → mic icon off.
ExecStart=${WRAPPER}
# Do NOT restart after idle shutdown — that's intentional.
# Only restart on actual failure (non-zero exit that isn't idle shutdown).
Restart=on-failure
RestartSec=3
# Idle timeout in seconds (default 30). Override via systemd override if needed.
Environment=HUDDLE_CAPTURE_IDLE_TIMEOUT=30
UNIT

  systemctl --user daemon-reload

  echo ""
  echo "Installed: $SERVICE_NAME"
  echo ""
  echo "The service is NOT auto-started on login. Start it when you need it:"
  echo "  systemctl --user start $SERVICE_NAME"
  echo ""
  echo "It will auto-stop after 30s of no consumers (idle watchdog)."
  echo "To enable auto-start on login (always running):"
  echo "  systemctl --user enable $SERVICE_NAME"
  echo ""

  echo "To test now:"
  echo "  systemctl --user start $SERVICE_NAME"
  echo "  systemctl --user status $SERVICE_NAME"
  echo ""
  echo "Then open the Huddle visualizer in Chromium. Strategy 0 auto-detects"
  echo "'Huddle Audio Capture'. After closing the visualizer, the service"
  echo "will stop itself within 30s."
}

cmd_uninstall() {
  if [ -f "$SERVICE_FILE" ]; then
    systemctl --user disable --now "$SERVICE_NAME.service" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl --user daemon-reload
    echo "Uninstalled: $SERVICE_NAME"
  else
    echo "Not installed."
  fi
}

cmd_status() {
  if [ -f "$SERVICE_FILE" ]; then
    systemctl --user status "$SERVICE_NAME.service" --no-pager || true
    echo ""
    echo "PipeWire nodes:"
    pw-cli list-objects 2>/dev/null | grep -i "huddle" || echo "  (none found)"
  else
    echo "Not installed. Run: $0 install"
  fi
}

case "${1:-install}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  status)    cmd_status ;;
  *)
    echo "Usage: $0 [install|uninstall|status]"
    exit 1
    ;;
esac
