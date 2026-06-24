#!/usr/bin/env bash
set -euo pipefail

FRIENDBOT_URL="https://friendbot.stellar.org"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <STELLAR_PUBLIC_KEY>" >&2
  echo "Example: $0 GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN" >&2
  exit 1
fi

PUBLIC_KEY="$1"

# Basic format check: Stellar public keys start with G and are 56 chars
if [[ ! "$PUBLIC_KEY" =~ ^G[A-Z2-7]{55}$ ]]; then
  echo "Error: '$PUBLIC_KEY' does not look like a valid Stellar public key." >&2
  exit 1
fi

echo "Funding $PUBLIC_KEY via Friendbot..."

HTTP_STATUS=$(curl -s -o /tmp/friendbot_response.json -w "%{http_code}" \
  "${FRIENDBOT_URL}/?addr=${PUBLIC_KEY}")

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "Success: account funded with 10,000 test XLM."
else
  echo "Error: Friendbot returned HTTP $HTTP_STATUS." >&2
  cat /tmp/friendbot_response.json >&2
  exit 1
fi
