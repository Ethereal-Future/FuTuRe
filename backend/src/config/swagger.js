import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FuTuRe API Documentation',
      version: '1.0.0',
      description:
        'API documentation for the FuTuRe backend, providing Stellar network integration services.',
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server',
      },
    ],
    components: {
      schemas: {
        // ── Auth ──────────────────────────────────────────────────────────────
        RegisterRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: {
              type: 'string',
              minLength: 3,
              maxLength: 32,
              description: 'Unique username for the account.',
              example: 'alice',
            },
            password: {
              type: 'string',
              minLength: 8,
              description: 'Password (min 8 characters).',
              example: 'S3cur3P@ss!',
            },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', example: 'alice' },
            password: { type: 'string', example: 'S3cur3P@ss!' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            accessToken: {
              type: 'string',
              description: 'Short-lived JWT access token.',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
            refreshToken: {
              type: 'string',
              description: 'Long-lived JWT refresh token.',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
            recovered: {
              type: 'boolean',
              description: 'True if login used a recovered credential.',
              example: false,
            },
          },
        },
        RefreshRequest: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: {
              type: 'string',
              description: 'A valid refresh token previously issued by /api/auth/login.',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
          },
        },
        UserProfile: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'usr_01HX...' },
            username: { type: 'string', example: 'alice' },
            createdAt: { type: 'string', format: 'date-time', example: '2026-01-15T10:00:00.000Z' },
          },
        },
        // ── Stellar accounts ─────────────────────────────────────────────────
        Account: {
          type: 'object',
          properties: {
            publicKey: {
              type: 'string',
              description: 'The public key of the Stellar account.',
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
            secret: {
              type: 'string',
              description: 'The secret key of the Stellar account (only returned on creation).',
              example: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
            },
          },
        },
        FundAccountRequest: {
          type: 'object',
          required: ['publicKey'],
          properties: {
            publicKey: {
              type: 'string',
              description: 'Public key of the testnet account to fund via Friendbot.',
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
          },
        },
        ImportAccountRequest: {
          type: 'object',
          required: ['secretKey'],
          properties: {
            secretKey: {
              type: 'string',
              description: 'The secret key of the account to import.',
              example: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
            },
          },
        },
        Balance: {
          type: 'object',
          properties: {
            asset_type: { type: 'string', example: 'native' },
            balance: { type: 'string', example: '100.0000000' },
            asset_code: { type: 'string', example: 'USDC' },
            asset_issuer: {
              type: 'string',
              example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            },
          },
        },
        AccountLabel: {
          type: 'object',
          properties: {
            accountLabel: {
              type: 'string',
              nullable: true,
              maxLength: 50,
              description: 'Human-readable label for the account.',
              example: 'My savings wallet',
            },
          },
        },
        AccountSettings: {
          type: 'object',
          properties: {
            defaultAsset: { type: 'string', example: 'XLM' },
            notificationsOn: { type: 'boolean', example: true },
            kycStatus: { type: 'string', nullable: true, example: 'APPROVED' },
            kycSubmittedAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              example: '2026-03-01T12:00:00.000Z',
            },
          },
        },
        Trustline: {
          type: 'object',
          properties: {
            asset_code: { type: 'string', example: 'USDC' },
            asset_issuer: {
              type: 'string',
              example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            },
            balance: { type: 'string', example: '50.0000000' },
            limit: { type: 'string', example: '1000.0000000' },
            is_authorized: { type: 'boolean', example: true },
          },
        },
        TrustlineRequest: {
          type: 'object',
          required: ['sourceSecret', 'assetCode'],
          properties: {
            sourceSecret: {
              type: 'string',
              description: 'Secret key of the account creating the trustline.',
              example: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
            },
            assetCode: {
              type: 'string',
              description: 'Asset code to trust (e.g. USDC, BTC).',
              example: 'USDC',
            },
          },
        },
        // ── Payments ─────────────────────────────────────────────────────────
        PaymentRequest: {
          type: 'object',
          required: ['sourceSecret', 'destination', 'amount'],
          properties: {
            sourceSecret: {
              type: 'string',
              description: 'Secret key of the sending account.',
              example: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
            },
            destination: {
              type: 'string',
              description: 'Public key of the receiving account.',
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
            amount: {
              type: 'string',
              description: 'Amount to send (as a string to preserve precision).',
              example: '10.5000000',
            },
            assetCode: {
              type: 'string',
              description: 'Asset code to send. Defaults to XLM.',
              example: 'XLM',
            },
            memo: {
              type: 'string',
              description: 'Optional memo text attached to the transaction.',
              example: 'Invoice #42',
            },
            memoType: {
              type: 'string',
              enum: ['text', 'id', 'hash', 'return'],
              description: 'Memo type. Defaults to text.',
              example: 'text',
            },
          },
        },
        PaymentResult: {
          type: 'object',
          properties: {
            hash: {
              type: 'string',
              description: 'The transaction hash on the Stellar network.',
              example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
            },
            ledger: {
              type: 'integer',
              description: 'The ledger sequence number the transaction was included in.',
              example: 48392011,
            },
            successful: { type: 'boolean', example: true },
            fee_charged: { type: 'string', example: '100' },
          },
        },
        // ── Path payments ─────────────────────────────────────────────────────
        PathPaymentRequest: {
          type: 'object',
          required: ['sourceSecret', 'destination', 'sendAsset', 'sendAmount', 'destAsset'],
          properties: {
            sourceSecret: {
              type: 'string',
              example: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
            },
            destination: {
              type: 'string',
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
            sendAsset: {
              type: 'object',
              required: ['code'],
              properties: {
                code: { type: 'string', example: 'XLM' },
                issuer: { type: 'string', nullable: true, example: null },
              },
            },
            sendAmount: { type: 'string', example: '10.0000000' },
            destAsset: {
              type: 'object',
              required: ['code'],
              properties: {
                code: { type: 'string', example: 'USDC' },
                issuer: {
                  type: 'string',
                  example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
                },
              },
            },
            path: {
              type: 'array',
              items: { type: 'object' },
              description: 'Optional intermediate asset path.',
            },
            slippageBps: {
              type: 'integer',
              description: 'Allowed slippage in basis points (e.g. 50 = 0.5%).',
              example: 50,
            },
          },
        },
        // ── Transactions ─────────────────────────────────────────────────────
        Transaction: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'a1b2c3d4e5f6...' },
            hash: {
              type: 'string',
              example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
            },
            type: { type: 'string', example: 'payment' },
            direction: {
              type: 'string',
              enum: ['sent', 'received'],
              nullable: true,
              example: 'sent',
            },
            amount: { type: 'string', nullable: true, example: '10.5000000' },
            asset: { type: 'string', nullable: true, example: 'XLM' },
            counterparty: {
              type: 'string',
              nullable: true,
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
            date: { type: 'string', format: 'date-time', example: '2026-03-15T14:22:00Z' },
            fee: { type: 'string', example: '100' },
            successful: { type: 'boolean', example: true },
            memo: { type: 'string', nullable: true, example: 'Invoice #42' },
            cursor: { type: 'string', example: '48392011' },
            ledger: { type: 'integer', example: 48392011 },
            source_account: {
              type: 'string',
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
            operation_count: { type: 'integer', example: 1 },
          },
        },
        TransactionListResponse: {
          type: 'object',
          properties: {
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/Transaction' },
            },
            nextCursor: {
              type: 'string',
              nullable: true,
              description:
                'Pass as `cursor` on the next request to get the next page. Null when no more pages.',
              example: '48392011',
            },
            hasMore: {
              type: 'boolean',
              description: 'True if a subsequent page exists.',
              example: true,
            },
          },
        },
        TransactionAnalytics: {
          type: 'object',
          properties: {
            totalTransactions: { type: 'integer', example: 142 },
            successfulTransactions: { type: 'integer', example: 138 },
            failedTransactions: { type: 'integer', example: 4 },
            totalVolume: { type: 'number', example: 5420.75 },
            averageFee: { type: 'number', example: 0.00001 },
            operationTypes: {
              type: 'object',
              additionalProperties: { type: 'integer' },
              example: { payment: 120, create_account: 10, change_trust: 12 },
            },
            dailyVolume: {
              type: 'object',
              additionalProperties: { type: 'integer' },
              example: { '2026-03-01': 320, '2026-03-02': 410 },
            },
            assets: {
              type: 'array',
              items: { type: 'string' },
              example: ['XLM', 'USDC'],
            },
          },
        },
        // ── Exchange rates ────────────────────────────────────────────────────
        ExchangeRate: {
          type: 'object',
          properties: {
            from: { type: 'string', example: 'XLM' },
            to: { type: 'string', example: 'USDC' },
            rate: {
              type: 'string',
              description: 'Best ask price from the SDEX order book.',
              example: '0.1234567',
            },
          },
        },
        FeeStats: {
          type: 'object',
          properties: {
            feeStroops: { type: 'integer', description: 'Median fee in stroops.', example: 100 },
            feeXLM: { type: 'string', description: 'Fee in XLM.', example: '0.0000100' },
            feeUsd: {
              type: 'string',
              nullable: true,
              description: 'Fee in USD (null if price unavailable).',
              example: '0.000012',
            },
            xlmUsd: {
              type: 'string',
              nullable: true,
              description: 'Current XLM/USD price.',
              example: '0.1200',
            },
            traditionalFeeUsd: {
              type: 'number',
              description: 'Benchmark traditional wire fee in USD.',
              example: 25,
            },
          },
        },
        NetworkStatus: {
          type: 'object',
          properties: {
            network: { type: 'string', enum: ['testnet', 'mainnet'], example: 'testnet' },
            horizonUrl: { type: 'string', example: 'https://horizon-testnet.stellar.org' },
            online: { type: 'boolean', example: true },
            horizonVersion: { type: 'string', example: '2.28.0' },
            networkPassphrase: { type: 'string', example: 'Test SDF Network ; September 2015' },
            currentProtocolVersion: { type: 'integer', example: 20 },
          },
        },
        // ── Multi-sig ─────────────────────────────────────────────────────────
        MultiSigSigner: {
          type: 'object',
          required: ['publicKey', 'weight'],
          properties: {
            publicKey: {
              type: 'string',
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
            weight: { type: 'integer', minimum: 0, maximum: 255, example: 1 },
          },
        },
        MultiSigThresholds: {
          type: 'object',
          properties: {
            low: { type: 'integer', example: 1 },
            medium: { type: 'integer', example: 2 },
            high: { type: 'integer', example: 3 },
          },
        },
        CreateMultiSigRequest: {
          type: 'object',
          required: ['sourceSecret', 'signers', 'thresholds'],
          properties: {
            sourceSecret: {
              type: 'string',
              example: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
            },
            signers: {
              type: 'array',
              items: { $ref: '#/components/schemas/MultiSigSigner' },
              example: [
                { publicKey: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN', weight: 1 },
              ],
            },
            thresholds: { $ref: '#/components/schemas/MultiSigThresholds' },
            masterWeight: { type: 'integer', minimum: 0, maximum: 255, example: 1 },
          },
        },
        BuildMultiSigTxRequest: {
          type: 'object',
          required: ['sourcePublicKey', 'destination', 'amount'],
          properties: {
            sourcePublicKey: {
              type: 'string',
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
            destination: {
              type: 'string',
              example: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON',
            },
            amount: { type: 'string', example: '25.0000000' },
            assetCode: { type: 'string', example: 'XLM' },
          },
        },
        MultiSigTxResult: {
          type: 'object',
          properties: {
            txId: { type: 'string', example: 'tx_01HX...' },
            txXdr: {
              type: 'string',
              description: 'Base64-encoded unsigned transaction XDR.',
              example: 'AAAAAQ...',
            },
            signaturesRequired: { type: 'integer', example: 2 },
            signaturesCollected: { type: 'integer', example: 0 },
          },
        },
        // ── Streaming payments ────────────────────────────────────────────────
        CreateStreamRequest: {
          type: 'object',
          required: ['senderPublicKey', 'recipientPublicKey', 'rateAmount'],
          properties: {
            senderPublicKey: {
              type: 'string',
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
            recipientPublicKey: {
              type: 'string',
              example: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON',
            },
            assetCode: { type: 'string', default: 'XLM', example: 'XLM' },
            rateAmount: {
              type: 'number',
              description: 'Amount to stream per interval.',
              example: 1.5,
            },
            intervalSeconds: { type: 'integer', minimum: 10, default: 60, example: 60 },
            endTime: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              example: '2026-12-31T23:59:59.000Z',
            },
          },
        },
        StreamResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
            status: {
              type: 'string',
              enum: ['ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED'],
              example: 'ACTIVE',
            },
            senderPublicKey: {
              type: 'string',
              example: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            },
            recipientPublicKey: {
              type: 'string',
              example: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON',
            },
            assetCode: { type: 'string', example: 'XLM' },
            rateAmount: { type: 'number', example: 1.5 },
            intervalSeconds: { type: 'integer', example: 60 },
            totalStreamed: { type: 'number', example: 45.0 },
            startTime: { type: 'string', format: 'date-time', example: '2026-03-01T00:00:00.000Z' },
            endTime: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              example: '2026-12-31T23:59:59.000Z',
            },
            lastProcessedAt: {
              type: 'string',
              format: 'date-time',
              example: '2026-03-15T14:00:00.000Z',
            },
            nextPaymentAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              example: '2026-03-15T14:01:00.000Z',
            },
          },
        },
        UpdateStreamRequest: {
          type: 'object',
          properties: {
            rateAmount: { type: 'number', description: 'New amount per interval.', example: 2.0 },
            intervalSeconds: {
              type: 'integer',
              minimum: 10,
              description: 'New interval in seconds.',
              example: 120,
            },
            endTime: {
              type: 'string',
              format: 'date-time',
              description: 'New end time.',
              example: '2027-01-01T00:00:00.000Z',
            },
          },
        },
        // ── Shared ────────────────────────────────────────────────────────────
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Human-readable error message.',
              example: 'Invalid secret key or account not found on network',
            },
          },
        },
        ValidationError: {
          type: 'object',
          properties: {
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', example: 'amount' },
                  message: { type: 'string', example: 'amount must be a positive number' },
                },
              },
            },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Bad Request — missing or invalid parameters.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: 'Invalid or missing required parameter' },
            },
          },
        },
        Unauthorized: {
          description: 'Unauthorized — missing or invalid JWT.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: 'Authorization token missing or invalid' },
            },
          },
        },
        Forbidden: {
          description: 'Forbidden — insufficient permissions.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: 'You do not have permission to perform this action' },
            },
          },
        },
        NotFound: {
          description: 'Not Found — the requested resource does not exist.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: 'Resource not found' },
            },
          },
        },
        TooManyRequests: {
          description: 'Too Many Requests — rate limit exceeded.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Too many requests, please try again later.' },
                  statusCode: { type: 'integer', example: 429 },
                  retryAfter: { type: 'integer', example: 60 },
                },
              },
            },
          },
        },
        InternalServerError: {
          description: 'Internal Server Error.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: 'An unexpected error occurred' },
            },
          },
        },
        ValidationError: {
          description: 'Unprocessable Entity — validation failed.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ValidationError' },
              example: {
                errors: [{ field: 'amount', message: 'amount must be a positive number' }],
              },
            },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/server.js', './src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
