function signerValueBuffer(value, fieldName) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${fieldName} must be a 32-byte hexadecimal hash`);
  }
  return Buffer.from(value, 'hex');
}

export function normalizeSigner(signer) {
  const type = signer.type ?? signer.signerType ?? 'ed25519PublicKey';
  if (type === 'ed25519PublicKey') {
    return {
      signer: { ed25519PublicKey: signer.publicKey, weight: signer.weight },
      publicKey: signer.publicKey,
    };
  }
  if (type === 'preAuthTx') {
    return {
      signer: {
        preAuthTx: signerValueBuffer(
          signer.preAuthTx ?? signer.preAuthTxHash ?? signer.hash,
          'preAuthTx',
        ),
        weight: signer.weight,
      },
    };
  }
  if (type === 'sha256Hash' || type === 'hash') {
    return {
      signer: {
        sha256Hash: signerValueBuffer(
          signer.sha256Hash ?? signer.hashX ?? signer.hash,
          'sha256Hash',
        ),
        weight: signer.weight,
      },
    };
  }
  throw new Error(`Unsupported signer type: ${type}`);
}

export function validateThresholds(thresholds, availableWeight) {
  if (!thresholds || !Number.isInteger(availableWeight) || availableWeight < 0) {
    throw new Error('Invalid multi-sig threshold configuration');
  }
  const values = [thresholds.low, thresholds.medium, thresholds.high];
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('Thresholds must be integers between 0 and 255');
  }
  if (thresholds.low > thresholds.medium || thresholds.medium > thresholds.high) {
    throw new Error('Thresholds must be ordered low <= medium <= high');
  }
  if (values.some((value) => value > availableWeight)) {
    throw new Error(`Thresholds cannot exceed the total signer weight (${availableWeight})`);
  }
}
