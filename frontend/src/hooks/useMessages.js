import { useCallback, useReducer } from 'react';

let nextId = 1;

function reducer(state, action) {
  switch (action.type) {
    case 'ADD': return {
      messages: [action.msg, ...state.messages],
      history: [action.msg, ...state.history].slice(0, 50),
    };
    case 'REMOVE': return { ...state, messages: state.messages.filter(m => m.id !== action.id) };
    case 'CLEAR': return { ...state, messages: [] };
    default: return state;
  }
}

const ICONS = { success: '✅', error: '⚠️', warning: '⚠', info: 'ℹ️' };
const AUTO_DISMISS = { success: 5000, info: 4000, warning: 0, error: 0 };

export function useMessages() {
  const [state, dispatch] = useReducer(reducer, { messages: [], history: [] });

  const add = useCallback((type, message, { retry, timeout, hash } = {}) => {
    const id = nextId++;
    const msg = { id, type, message, retry, hash, timestamp: new Date(), icon: ICONS[type] };
    dispatch({ type: 'ADD', msg });
    const ms = timeout ?? AUTO_DISMISS[type];
    if (ms > 0) setTimeout(() => dispatch({ type: 'REMOVE', id }), ms);
    return id;
  }, []);

  const remove = useCallback((id) => dispatch({ type: 'REMOVE', id }), []);
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);

  return {
    messages: state.messages,
    history: state.history,
    success: (msg, opts) => add('success', msg, opts),
    error: (msg, opts) => add('error', msg, opts),
    warning: (msg, opts) => add('warning', msg, opts),
    info: (msg, opts) => add('info', msg, opts),
    remove,
    clear,
  };
}
