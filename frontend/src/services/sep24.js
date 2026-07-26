import axios from 'axios';

const HORIZON_URL = 'https://horizon.stellar.org';

export async function discoverAnchor(domain) {
  try {
    const response = await axios.get(`https://${domain}/.well-known/stellar.toml`);
    const toml = response.data;

    const lines = toml.split('\n');
    const config = {};

    for (const line of lines) {
      if (line.startsWith('[') || line.startsWith('#') || !line.trim()) continue;

      const [key, value] = line.split('=').map((s) => s.trim());
      if (key && value) {
        config[key] = value.replace(/"/g, '');
      }
    }

    return {
      name: config.ANCHOR_NAME || domain,
      domain,
      sep24Enabled: !!config.TRANSFER_SERVER_SEP0024,
      transferServer: config.TRANSFER_SERVER_SEP0024 || config.TRANSFER_SERVER,
      signingKey: config.SIGNING_KEY,
    };
  } catch (error) {
    throw new Error(`Failed to discover anchor at ${domain}: ${error.message}`);
  }
}

export async function getAnchorInfo(transferServer) {
  try {
    const response = await axios.get(`${transferServer}/info`);
    return response.data;
  } catch (error) {
    throw new Error(`Failed to get anchor info: ${error.message}`);
  }
}

export async function authenticateWithSEP10(transferServer, publicKey, secretKey) {
  try {
    // Step 1: Get challenge transaction from auth server
    const challengeResponse = await axios.get(`${transferServer.replace('/transfer', '/auth')}/challenge`, {
      params: { account: publicKey },
    });

    const challengeXdr = challengeResponse.data.transaction;

    // Step 2: Sign the challenge (in production, this would be done client-side)
    // For now, we'll return a placeholder that needs to be signed
    return {
      challengeXdr,
      publicKey,
    };
  } catch (error) {
    throw new Error(`SEP-10 authentication failed: ${error.message}`);
  }
}

export async function initiateDeposit(transferServer, token, assetCode) {
  try {
    const response = await axios.post(
      `${transferServer}/transactions/deposit/interactive`,
      {
        asset_code: assetCode,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return {
      id: response.data.id,
      url: response.data.url,
      type: 'deposit',
    };
  } catch (error) {
    throw new Error(`Failed to initiate deposit: ${error.message}`);
  }
}

export async function initiateWithdrawal(transferServer, token, assetCode) {
  try {
    const response = await axios.post(
      `${transferServer}/transactions/withdraw/interactive`,
      {
        asset_code: assetCode,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return {
      id: response.data.id,
      url: response.data.url,
      type: 'withdrawal',
    };
  } catch (error) {
    throw new Error(`Failed to initiate withdrawal: ${error.message}`);
  }
}

export async function getTransactionStatus(transferServer, token, transactionId) {
  try {
    const response = await axios.get(`${transferServer}/transaction`, {
      params: { id: transactionId },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(`Failed to get transaction status: ${error.message}`);
  }
}

export async function pollTransactionStatus(transferServer, token, transactionId, maxAttempts = 60) {
  let attempts = 0;
  const pollInterval = 2000;

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      attempts++;

      try {
        const status = await getTransactionStatus(transferServer, token, transactionId);

        if (
          status.transaction.status === 'completed' ||
          status.transaction.status === 'error' ||
          status.transaction.status === 'refunded'
        ) {
          clearInterval(interval);
          resolve(status.transaction);
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          reject(new Error('Transaction polling timeout'));
        }
      } catch (error) {
        clearInterval(interval);
        reject(error);
      }
    }, pollInterval);
  });
}

export function isTerminalState(status) {
  return ['completed', 'error', 'refunded'].includes(status);
}
