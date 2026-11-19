/**
 * useAccountLabel — manages account nickname editing state and persistence.
 *
 * Fixes #1418: isolates label-editing state (editingLabel, labelDraft) so
 * that label input changes only re-render the label editor, not the full App.
 *
 * @param {string|null} publicKey  The active account's public key.
 * @param {string} currentLabel    Current persisted label from the store.
 * @param {Function} onSave        Called with (publicKey, newLabel) when the
 *                                 user saves; should update the store.
 * @param {Function} onError       Called with an error message string.
 */
import { useState, useCallback } from 'react';
import { updateAccountLabel } from '../api/stellar.js';
import { logError } from '../utils/errorLogger.js';

/**
 * @param {{
 *   publicKey: string|null,
 *   currentLabel: string,
 *   onSave: (label: string) => void,
 *   onError: (msg: string) => void,
 * }} opts
 */
export function useAccountLabel({ publicKey, currentLabel, onSave, onError }) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');

  const startEditing = useCallback(() => {
    setLabelDraft(currentLabel ?? '');
    setEditingLabel(true);
  }, [currentLabel]);

  const cancelEditing = useCallback(() => {
    setEditingLabel(false);
  }, []);

  const saveLabel = useCallback(async () => {
    if (!publicKey) return;
    try {
      await updateAccountLabel(publicKey, labelDraft);
      onSave(labelDraft);
      setEditingLabel(false);
    } catch (error) {
      logError(error, { context: 'saveLabel' });
      onError('Failed to save label');
    }
  }, [publicKey, labelDraft, onSave, onError]);

  return {
    editingLabel,
    labelDraft,
    setLabelDraft,
    startEditing,
    cancelEditing,
    saveLabel,
  };
}
