# Stellar Remittance Platform

A cross-border remittance application built on the Stellar blockchain, enabling fast and low-cost international money transfers.

## Features

- Create Stellar accounts
- Check account balances
- Send XLM payments
- Low transaction fees (~$0.00001)
- Fast settlement (3-5 seconds)

## Tech Stack

- Backend: Node.js + Express + Stellar SDK
- Frontend: React + Vite
- Blockchain: Stellar (Testnet)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure backend environment:
```bash
cd backend
cp .env.example .env
```

3. Start development servers:
```bash
npm run dev
```

Backend runs on http://localhost:3001
Frontend runs on http://localhost:3000

## Usage

1. Click "Create Account" to generate a new Stellar keypair
2. Account is automatically funded on testnet via Friendbot
3. Check balance to see your XLM
4. Send payments to other Stellar addresses

## Next Steps

- Add stablecoin support (USDC)
- Integrate fiat on/off ramps
- Add exchange rate conversion
- Implement KYC/AML compliance
- Add transaction history
- Mobile app development

## Resources

- [Stellar Documentation](https://developers.stellar.org)
- [Stellar SDK](https://github.com/stellar/js-stellar-sdk)
