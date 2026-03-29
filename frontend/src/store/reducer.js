// ── Action types ─────────────────────────────────────────────────────────────
export const A = {
  // Account
  SET_ACCOUNT: 'SET_ACCOUNT',
  CLEAR_ACCOUNT: 'CLEAR_ACCOUNT',
  // Balance
  SET_BALANCE: 'SET_BALANCE',
  SET_BALANCE_OPTIMISTIC: 'SET_BALANCE_OPTIMISTIC',
  REVERT_BALANCE: 'REVERT_BALANCE',
  // UI
  SET_LOADING: 'SET_LOADING',
  SET_RECIPIENT: 'SET_RECIPIENT',
  SET_AMOUNT: 'SET_AMOUNT',
  RESET_FORM: 'RESET_FORM',
  SET_SHOW_QR: 'SET_SHOW_QR',
  SET_SHOW_IMPORT: 'SET_SHOW_IMPORT',
  SET_SHOW_SHORTCUTS: 'SET_SHOW_SHORTCUTS',
};

// ── Initial state ─────────────────────────────────────────────────────────────
export const STATE_VERSION = 1;

export const initialState = {
  _version: STATE_VERSION,
  account: null,       // { publicKey, secretKey }
  balance: null,       // { balances: [{ asset, balance }] }
  _prevBalance: null,  // for optimistic revert
  loading: '',         // 'create' | 'balance' | 'send' | 'import' | ''
  recipient: '',
  amount: '',
  showQR: false,
  showImportForm: false,
  showShortcuts: false,
};

// ── Reducer ───────────────────────────────────────────────────────────────────
export function appReducer(state, action) {
  switch (action.type) {
    case A.SET_ACCOUNT:
      return { ...state, account: action.payload };
    case A.CLEAR_ACCOUNT:
      return { ...state, account: null, balance: null };
    case A.SET_BALANCE:
      return { ...state, balance: action.payload, _prevBalance: null };
    case A.SET_BALANCE_OPTIMISTIC:
      return { ...state, _prevBalance: state.balance, balance: action.payload };
    case A.REVERT_BALANCE:
      return { ...state, balance: state._prevBalance, _prevBalance: null };
    case A.SET_LOADING:
      return { ...state, loading: action.payload };
    case A.SET_RECIPIENT:
      return { ...state, recipient: action.payload };
    case A.SET_AMOUNT:
      return { ...state, amount: action.payload };
    case A.RESET_FORM:
      return { ...state, recipient: '', amount: '' };
    case A.SET_SHOW_QR:
      return { ...state, showQR: action.payload };
    case A.SET_SHOW_IMPORT:
      return { ...state, showImportForm: action.payload };
    case A.SET_SHOW_SHORTCUTS:
      return { ...state, showShortcuts: action.payload };
    default:
      return state;
  }
}
