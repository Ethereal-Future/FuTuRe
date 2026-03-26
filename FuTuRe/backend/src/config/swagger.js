import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FuTuRe API Documentation',
      version: '1.0.0',
      description: 'API documentation for the FuTuRe backend, providing Stellar network integration services.',
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server',
      },
    ],
    components: {
      schemas: {
        Account: {
          type: 'object',
          properties: {
            publicKey: {
              type: 'string',
              description: 'The public key of the Stellar account.',
              example: 'GC5T...RT2K',
            },
            secret: {
              type: 'string',
              description: 'The secret key of the Stellar account (only returned on creation).',
              example: 'SC3A...4X7Y',
            },
          },
        },
        Balance: {
          type: 'object',
          properties: {
            asset_type: {
              type: 'string',
              example: 'native',
            },
            balance: {
              type: 'string',
              example: '100.0000000',
            },
            asset_code: {
              type: 'string',
              example: 'USDC',
            },
            asset_issuer: {
              type: 'string',
              example: 'G...I',
            },
          },
        },
        PaymentRequest: {
          type: 'object',
          required: ['sourceSecret', 'destination', 'amount', 'assetCode'],
          properties: {
            sourceSecret: {
              type: 'string',
              description: 'The secret key of the source account.',
            },
            destination: {
              type: 'string',
              description: 'The public key of the destination account.',
            },
            amount: {
              type: 'string',
              description: 'The amount of asset to send.',
            },
            assetCode: {
              type: 'string',
              description: 'The code of the asset (e.g., XLM, USDC).',
            },
          },
        },
        PaymentResult: {
          type: 'object',
          properties: {
            hash: {
              type: 'string',
              description: 'The transaction hash.',
            },
            ledger: {
              type: 'integer',
              description: 'The ledger number.',
            },
          },
        },
        ExchangeRate: {
          type: 'object',
          properties: {
            rate: {
              type: 'string',
              description: 'The exchange rate between the two assets.',
              example: '0.1234567',
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'The error message.',
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
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/server.js', './src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
