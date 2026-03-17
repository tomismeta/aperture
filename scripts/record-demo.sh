#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAPE_ARG="${1:-demo/aperture-demo.tape}"
TAPE_PATH="${ROOT_DIR}/${TAPE_ARG}"
OUTPUT_GIF="${ROOT_DIR}/docs/assets/demo.gif"
OUTPUT_MP4="${ROOT_DIR}/docs/assets/demo.mp4"

if ! command -v vhs >/dev/null 2>&1; then
  echo "vhs is required to record the TUI demo." >&2
  echo "Install it from https://github.com/charmbracelet/vhs and rerun pnpm demo:record." >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_GIF}")"
cd "${ROOT_DIR}"

rm -f "${OUTPUT_GIF}" "${OUTPUT_MP4}"
echo "Recording Aperture TUI demo to ${OUTPUT_GIF} and ${OUTPUT_MP4}"
vhs "${TAPE_PATH}"
