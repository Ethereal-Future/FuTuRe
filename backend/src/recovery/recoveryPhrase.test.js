// @vitest-environment node
/**
 * BIP-39 seed generation and SLIP-0010 / SEP-0005 Stellar key derivation (#1390).
 *
 * Vectors:
 *  - BIP-39: trezor/python-mnemonic vectors.json (passphrase "TREZOR")
 *  - SLIP-0010: ed25519 test vector 1
 *  - SEP-0005: Stellar key derivation test 1
 */
import { describe, it, expect } from 'vitest';
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  validateMnemonic,
  generateRecoveryPhrase,
  slip10MasterKey,
  derivePath,
  deriveStellarKeypair,
  hashPhrase,
} from './recoveryPhrase.js';
import { BIP39_ENGLISH } from './bip39Wordlist.js';

const TREZOR_VECTORS = [
  {
    entropy: '00000000000000000000000000000000',
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    seed: 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
  },
  {
    entropy: '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
    seed: '2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607',
  },
  {
    entropy: '80808080808080808080808080808080',
    mnemonic: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    seed: 'd71de856f81a8acc65e6fc851a38d4d7ec216fd0796d0a6827a3ad6ed5511a30fa280f12eb2e47ed2ac03b5c462a0358d18d69fe4f985ec81778c1b370b652a8',
  },
  {
    entropy: 'ffffffffffffffffffffffffffffffff',
    mnemonic: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    seed: 'ac27495480225222079d7be181583751e86f571027b0497b5b5d11218e0a8a13332572917f0f8e5a589620c6f15b11c61dee327651a14c34e18231052e48c069',
  },
  {
    entropy: '0000000000000000000000000000000000000000000000000000000000000000',
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
    seed: 'bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8',
  },
];

const SEP5_MNEMONIC = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';

describe('BIP-39 wordlist', () => {
  it('is the full, sorted, 2048-word English list', () => {
    expect(BIP39_ENGLISH).toHaveLength(2048);
    expect(new Set(BIP39_ENGLISH).size).toBe(2048);
    expect([...BIP39_ENGLISH].sort()).toEqual([...BIP39_ENGLISH]);
    expect(BIP39_ENGLISH[0]).toBe('abandon');
    expect(BIP39_ENGLISH[2047]).toBe('zoo');
  });
});

describe('BIP-39 mnemonic encoding', () => {
  it.each(TREZOR_VECTORS)('encodes and decodes entropy $entropy', ({ entropy, mnemonic }) => {
    expect(entropyToMnemonic(Buffer.from(entropy, 'hex'))).toBe(mnemonic);
    expect(mnemonicToEntropy(mnemonic).toString('hex')).toBe(entropy);
    expect(validateMnemonic(mnemonic)).toBe(true);
  });

  it('rejects a bad checksum, unknown words and invalid lengths', () => {
    expect(validateMnemonic(Array(12).fill('abandon').join(' '))).toBe(false);
    expect(validateMnemonic(TREZOR_VECTORS[0].mnemonic.replace('about', 'aboot'))).toBe(false);
    expect(validateMnemonic('abandon abandon abandon')).toBe(false);
  });

  it('generates checksum-valid mnemonics of every standard length', () => {
    for (const n of [12, 15, 18, 21, 24]) {
      const phrase = generateRecoveryPhrase(n);
      expect(phrase.split(' ')).toHaveLength(n);
      expect(validateMnemonic(phrase)).toBe(true);
    }
    expect(generateRecoveryPhrase()).not.toBe(generateRecoveryPhrase());
    expect(() => generateRecoveryPhrase(13)).toThrow();
  });
});

describe('BIP-39 seed (PBKDF2-HMAC-SHA512, 2048 rounds)', () => {
  it.each(TREZOR_VECTORS)('matches the official seed for "$mnemonic"', ({ mnemonic, seed }) => {
    const out = mnemonicToSeed(mnemonic, 'TREZOR');
    expect(out).toHaveLength(64);
    expect(out.toString('hex')).toBe(seed);
  });

  it('uses an empty passphrase by default', () => {
    expect(mnemonicToSeed(TREZOR_VECTORS[0].mnemonic).toString('hex')).toBe(
      '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
    );
  });

  it('NFKD-normalizes the passphrase so composed and decomposed forms agree', () => {
    const composed = mnemonicToSeed(TREZOR_VECTORS[0].mnemonic, 'café');
    const decomposed = mnemonicToSeed(TREZOR_VECTORS[0].mnemonic, 'café');
    expect(composed.equals(decomposed)).toBe(true);
    expect(composed.equals(mnemonicToSeed(TREZOR_VECTORS[0].mnemonic, 'cafe'))).toBe(false);
  });
});

describe('SLIP-0010 ed25519 derivation', () => {
  const seed = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

  it('derives the master node (test vector 1, m)', () => {
    const { key, chainCode } = slip10MasterKey(seed);
    expect(chainCode.toString('hex')).toBe('90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb');
    expect(key.toString('hex')).toBe('2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7');
  });

  it("derives a hardened child (test vector 1, m/0')", () => {
    const { key, chainCode } = derivePath(seed, "m/0'");
    expect(chainCode.toString('hex')).toBe('8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69');
    expect(key.toString('hex')).toBe('68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3');
  });

  it('rejects non-hardened segments, which ed25519 cannot derive', () => {
    expect(() => derivePath(seed, 'm/44/148/0')).toThrow(/hardened/);
  });
});

describe("SEP-0005 Stellar keypairs (m/44'/148'/x')", () => {
  it('derives the seed from SEP-0005 test 1', () => {
    expect(mnemonicToSeed(SEP5_MNEMONIC).toString('hex')).toBe(
      'e4a5a632e70943ae7f07659df1332160937fad82587216a4c64315a0fb39497ee4a01f76ddab4cba68147977f3a147b6ad584c41808e8238a07f6cc4b582f186',
    );
  });

  it('derives the same keypairs as ecosystem wallets for accounts 0 and 1', () => {
    const k0 = deriveStellarKeypair(SEP5_MNEMONIC);
    expect(k0.publicKey()).toBe('GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6');
    expect(k0.secret()).toBe('SBGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O34RMTB343OYPXU5DJDVMN');

    const k1 = deriveStellarKeypair(SEP5_MNEMONIC, { account: 1 });
    expect(k1.publicKey()).toBe('GBAW5XGWORWVFE2XTJYDTLDHXTY2Q2MO73HYCGB3XMFMQ562Q2W2GJQX');
    expect(k1.secret()).toBe('SCEPFFWGAG5P2VX5DHIYK3XEMZYLTYWIPWYEKXFHSK25RVMIUNJ7CTIS');
  });

  it('binds the passphrase into the derived key', () => {
    expect(deriveStellarKeypair(SEP5_MNEMONIC, { passphrase: 'p' }).publicKey()).not.toBe(
      deriveStellarKeypair(SEP5_MNEMONIC).publicKey(),
    );
  });
});

describe('hashPhrase', () => {
  it('is stable for existing ASCII phrases', () => {
    expect(hashPhrase('  Abandon About ')).toBe(hashPhrase('abandon about'));
  });
});
