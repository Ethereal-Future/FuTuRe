import { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import { appReducer } from './reducer.js';
import { loadState, saveState } from './persistence.js';
import { createTabSync } from './tabSync.js';
import { A } from './reducer.js';
import { clearAllCachedBalances } from '../cache/balanceCache.js';

const AppStateContext = createContext(null);
const AppDispatchContext = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, undefined, loadState);
  const syncRef = useRef(null);
  const isSyncingRef = useRef(false);
  const accountRef = useRef(state.account);
  accountRef.current = state.account;

  // Persist on every state change
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Cross-tab sync: broadcast account/balance changes
  useEffect(() => {
    syncRef.current = createTabSync((msg) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      if (msg.type === A.SET_ACCOUNT) {
        // Synced payloads carry only public identifiers. If this tab already
        // holds the same account locally, keep its own secretKey.
        const current = accountRef.current;
        const payload = current?.secretKey && current.publicKey === msg.payload?.publicKey
          ? { ...msg.payload, secretKey: current.secretKey }
          : msg.payload;
        dispatch({ type: A.SET_ACCOUNT, payload });
      }
      if (msg.type === A.CLEAR_ACCOUNT) {
        dispatch({ type: A.CLEAR_ACCOUNT });
        clearAllCachedBalances().catch(() => {});
      }
      if (msg.type === A.SET_BALANCE) dispatch({ type: A.SET_BALANCE, payload: msg.payload });
      isSyncingRef.current = false;
    });
    return () => syncRef.current?.destroy();
  }, []);

  // Wrap dispatch to also broadcast syncable actions
  const syncedDispatch = useCallback((action) => {
    dispatch(action);
    if (action.type === A.CLEAR_ACCOUNT) clearAllCachedBalances().catch(() => {});
    if ([A.SET_ACCOUNT, A.CLEAR_ACCOUNT, A.SET_BALANCE].includes(action.type)) {
      // createTabSync strips secretKey and other private fields before posting.
      syncRef.current?.broadcast(action);
    }
  }, []);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={syncedDispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error('useAppDispatch must be used within AppStateProvider');
  return ctx;
}
