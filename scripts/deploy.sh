#!/usr/bin/env bash
set -euo pipefail

# Passport Deploy Script
# Usage: ./scripts/deploy.sh [production|staging]
# Requires: docker, docker-compose, SSH access to server

ENV=${1:-production}
SERVER=${DEPLOY_SERVER:-"passport.metis.gold"}
SSH_USER=${DEPLOY_SSH_USER:-"deploy"}
PROJECT_DIR=${DEPLOY_DIR:-"/home/deploy/passport"}

echo "🚀 Deploying Passport to $ENV ($SERVER)..."

# 1. Build the Docker image
echo "📦 Building Docker image..."
docker build -t passport:latest .

# 2. Save and compress
echo "💾 Saving image..."
docker save passport:latest | gzip > /tmp/passport-latest.tar.gz

# 3. Copy to server
echo "📤 Copying to $SERVER..."
scp /tmp/passport-latest.tar.gz "$SSH_USER@$SERVER:/tmp/"
scp docker-compose.yml "$SSH_USER@$SERVER:$PROJECT_DIR/"
scp Caddyfile "$SSH_USER@$SERVER:$PROJECT_DIR/"
scp .env.production "$SSH_USER@$SERVER:$PROJECT_DIR/"

# 4. Deploy on server
echo "🔄 Deploying on server..."
ssh "$SSH_USER@$SERVER" << 'EOF'
  set -euo pipefail
  cd /home/deploy/passport

  # Load the image
  gunzip -c /tmp/passport-latest.tar.gz | docker load

  # Run DB migrations
  docker-compose run --rm app npx prisma migrate deploy

  # Restart services
  docker-compose up -d --force-recreate app caddy

  # Cleanup
  rm -f /tmp/passport-latest.tar.gz
  docker image prune -f

  echo "✅ Deploy complete"
EOF

# 5. Cleanup local
rm -f /tmp/passport-latest.tar.gz

echo "✅ Passport deployed successfully to $ENV"