import { useState, useCallback } from 'react';

/**
 * Hook to integrate with Stellar wallet extensions (Freighter, Albedo)
 * for transaction signing without exposing secret keys.
 */
export function useWalletSigner() {
  const [isConnected, setIsConnected] = useState(false);
  const [publicKey, setPublicKey] = useState(null);
  const [walletType, setWalletType] = useState(null);

  const connectFreighter = useCallback(async () => {
    if (!window.freighterApi) {
      throw new Error('Freighter wallet extension not installed');
    }

    try {
      const { publicKey: pk } = await window.freighterApi.getPublicKey();
      setPublicKey(pk);
      setWalletType('freighter');
      setIsConnected(true);
      return pk;
    } catch (error) {
      throw new Error('Failed to connect to Freighter: ' + error.message);
    }
  }, []);

  const connectAlbedo = useCallback(async () => {
    if (!window.albedo) {
      throw new Error('Albedo wallet not available');
    }

    try {
      const result = await window.albedo.publicKey({});
      setPublicKey(result.pubkey);
      setWalletType('albedo');
      setIsConnected(true);
      return result.pubkey;
    } catch (error) {
      throw new Error('Failed to connect to Albedo: ' + error.message);
    }
  }, []);

  const connectWallet = useCallback(async (preferredWallet = 'freighter') => {
    try {
      if (preferredWallet === 'freighter' && window.freighterApi) {
        return await connectFreighter();
      } else if (preferredWallet === 'albedo' && window.albedo) {
        return await connectAlbedo();
      } else if (window.freighterApi) {
        return await connectFreighter();
      } else if (window.albedo) {
        return await connectAlbedo();
      } else {
        throw new Error('No Stellar wallet extension found. Please install Freighter or Albedo.');
      }
    } catch (error) {
      setIsConnected(false);
      setPublicKey(null);
      setWalletType(null);
      throw error;
    }
  }, [connectFreighter, connectAlbedo]);

  const signTransaction = useCallback(async (xdr) => {
    if (!isConnected) {
      throw new Error('Wallet not connected');
    }

    try {
      if (walletType === 'freighter') {
        const { signedXDR } = await window.freighterApi.signTransaction(xdr, {
          networkPassphrase: window.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
        });
        return signedXDR;
      } else if (walletType === 'albedo') {
        const result = await window.albedo.tx({
          xdr,
          network: window.STELLAR_NETWORK || 'testnet',
        });
        return result.signed_envelope_xdr;
      }
    } catch (error) {
      throw new Error('Failed to sign transaction: ' + error.message);
    }
  }, [isConnected, walletType]);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setPublicKey(null);
    setWalletType(null);
  }, []);

  return {
    isConnected,
    publicKey,
    walletType,
    connectWallet,
    signTransaction,
    disconnect,
  };
}
