#!/bin/bash
set -euo pipefail

# Increase daily cap for initial deployment
docker exec passport_app_1 sh -c 'export AUTONOMOUS_POW_DIFFICULTY=4 MAX_AUTONOMOUS_PER_IP_DAILY=20 && node /tmp/deploy-agents.js 5' 2>&1
