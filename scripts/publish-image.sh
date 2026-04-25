#!/bin/bash
# Publish Huddle Docker image to GitHub Container Registry
# Usage: ./scripts/publish-image.sh [tag]
# Example: ./scripts/publish-image.sh v1.1
#
# Prerequisites:
#   echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin

set -euo pipefail

REPO="ghcr.io/nasheqify/huddle"
TAG="${1:-latest}"

echo "Building ${REPO}:${TAG}..."
docker build -t "${REPO}:${TAG}" -t "${REPO}:latest" .

echo "Pushing ${REPO}:${TAG}..."
docker push "${REPO}:${TAG}"
docker push "${REPO}:latest"

echo "Done. Published:"
echo "  ${REPO}:${TAG}"
echo "  ${REPO}:latest"
