#!/bin/bash
set -euo pipefail

cd /opt/passport

# Check if build is still running
if docker ps --format "{{.Names}}" | grep -q "buildx"; then
  echo "Build still running, waiting..."
  sleep 60
fi

# Check if image exists
if docker images | grep -q "passport_app"; then
  echo "Image exists. Starting app..."
  docker-compose up -d app
  sleep 15
  curl -s http://localhost:3000/api/health
else
  echo "No image found. Building..."
  docker-compose build app 2>&1 | tail -3
  docker-compose up -d app
  sleep 15
  curl -s http://localhost:3000/api/health
fi

echo ""
echo "=== FINAL STATUS ==="
docker ps --format "{{.Names}} {{.Status}}"