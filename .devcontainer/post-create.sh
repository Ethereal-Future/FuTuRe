#!/usr/bin/env bash
# .devcontainer/post-create.sh
# Runs once after the devcontainer is first created.
# Sets up dependencies and copies example env files so the project is
# immediately runnable after the container starts.

set -euo pipefail

echo "==> Installing root dependencies..."
npm install

echo "==> Installing backend dependencies..."
cd /workspace/backend && npm install && cd /workspace

echo "==> Installing frontend dependencies..."
cd /workspace/frontend && npm install && cd /workspace

echo "==> Copying .env.example files if .env does not yet exist..."
if [ ! -f /workspace/backend/.env ]; then
  cp /workspace/backend/.env.example /workspace/backend/.env
  echo "    Created backend/.env from .env.example"
fi

if [ ! -f /workspace/frontend/.env ]; then
  cp /workspace/frontend/.env.example /workspace/frontend/.env
  echo "    Created frontend/.env from .env.example"
fi

echo "==> Dev container setup complete."
echo "    Start the dev servers with: npm run dev"
echo "    Start Storybook with:       cd frontend && npm run storybook"
