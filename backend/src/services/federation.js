import prisma from '../db/client.js';

const DEFAULT_FEDERATION_DOMAIN = 'futureremit.app';

export function getFederationDomain() {
  return process.env.STELLAR_FEDERATION_DOMAIN || DEFAULT_FEDERATION_DOMAIN;
}

export function normalizeFederationAddress(address) {
  return String(address || '').trim().toLowerCase();
}

export function isFederationAddress(address) {
  return /^[a-z0-9._-]+\*[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(address || '').trim());
}

export async function resolveFederationAddress(address) {
  const normalized = normalizeFederationAddress(address);
  if (!isFederationAddress(normalized)) {
    const error = new Error('Invalid federation address');
    error.status = 400;
    throw error;
  }

  const [, domain] = normalized.split('*');
  if (domain !== getFederationDomain().toLowerCase()) {
    const error = new Error('Federation domain is not served by this platform');
    error.status = 404;
    throw error;
  }

  const setting = await prisma.setting.findFirst({
    where: { federationAddress: normalized },
    include: { user: { select: { publicKey: true } } },
  });

  if (!setting?.user?.publicKey) {
    const error = new Error('Federation address not found');
    error.status = 404;
    throw error;
  }

  return {
    stellar_address: normalized,
    account_id: setting.user.publicKey,
    memo_type: 'none',
  };
}

export async function claimFederationAddress({ publicKey, localPart }) {
  const safeLocalPart = String(localPart || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(safeLocalPart)) {
    const error = new Error('Federation name must be 3-32 characters: letters, numbers, dot, underscore, or hyphen');
    error.status = 400;
    throw error;
  }

  const federationAddress = `${safeLocalPart}*${getFederationDomain().toLowerCase()}`;
  const user = await prisma.user.upsert({
    where: { publicKey },
    update: {},
    create: { publicKey },
  });

  const setting = await prisma.setting.upsert({
    where: { userId: user.id },
    update: { federationAddress },
    create: { userId: user.id, federationAddress },
  });

  return { federationAddress: setting.federationAddress };
}
