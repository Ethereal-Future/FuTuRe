/**
 * #1147 — ThresholdSettings.jsx configures Stellar account signing thresholds
 * (setOptions low/med/high). A mistake here can lock a user out of their own
 * account, so these tests pin down that:
 *   - the low/medium/high inputs map 1:1 onto the submitted payload fields,
 *   - a high threshold exceeding the signers' combined weight is blocked
 *     client-side (the lockout safeguard) and never reaches the API,
 *   - med > high is rejected, and the confirm() gate is respected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { ThresholdSettings } from './ThresholdSettings.jsx';

vi.mock('../api/client.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import apiClient from '../api/client.js';

const PK = 'G'.repeat(56);

function mockAccount({ signers = [{ key: PK, weight: 1 }, { key: 'GB', weight: 2 }] } = {}) {
  apiClient.get.mockResolvedValue({
    data: {
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
      signers,
    },
  });
}

async function renderInEditMode(props = {}) {
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <ThresholdSettings publicKey={PK} {...props} />
    </I18nextProvider>,
  );
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(`/api/stellar/account/${PK}`));
  const editBtn = await waitFor(() => {
    const btn = utils.container.querySelector('button');
    expect(btn).not.toBeNull();
    return btn;
  });
  fireEvent.click(editBtn);
  await waitFor(() => expect(utils.container.querySelector('#high-threshold')).not.toBeNull());
  return utils;
}

function setThresholds(container, { low, med, high }) {
  fireEvent.change(container.querySelector('#low-threshold'), { target: { value: String(low) } });
  fireEvent.change(container.querySelector('#med-threshold'), { target: { value: String(med) } });
  fireEvent.change(container.querySelector('#high-threshold'), { target: { value: String(high) } });
}

function clickSave(container) {
  const buttons = container.querySelectorAll('button');
  // Edit mode renders [save, cancel] as the final two buttons.
  fireEvent.click(buttons[buttons.length - 2]);
}

describe('ThresholdSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('secretKey', 'S'.repeat(56));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('maps low/med/high inputs onto the set-thresholds payload', async () => {
    mockAccount();
    apiClient.post.mockResolvedValue({ data: {} });
    const onUpdate = vi.fn();
    const { container } = await renderInEditMode({ onUpdate });

    setThresholds(container, { low: 1, med: 2, high: 3 });
    clickSave(container);

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith(`/api/stellar/account/${PK}/set-thresholds`, {
      sourceSecret: 'S'.repeat(56),
      lowThreshold: 1,
      medThreshold: 2,
      highThreshold: 3,
    });
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });

  it('blocks a high threshold above the combined signer weight (lockout safeguard)', async () => {
    mockAccount(); // combined weight = 3
    const { container } = await renderInEditMode();

    setThresholds(container, { low: 1, med: 2, high: 4 });
    clickSave(container);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('rejects a medium threshold greater than the high threshold', async () => {
    mockAccount();
    const { container } = await renderInEditMode();

    setThresholds(container, { low: 1, med: 3, high: 2 });
    clickSave(container);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('rejects thresholds outside the 0-255 range', async () => {
    mockAccount({ signers: [{ key: PK, weight: 255 }] });
    const { container } = await renderInEditMode();

    setThresholds(container, { low: -1, med: 2, high: 3 });
    clickSave(container);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('does not submit when the user declines the confirmation', async () => {
    mockAccount();
    window.confirm.mockReturnValue(false);
    const { container } = await renderInEditMode();

    setThresholds(container, { low: 1, med: 2, high: 3 });
    clickSave(container);

    expect(window.confirm).toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('surfaces an API error instead of swallowing it', async () => {
    mockAccount();
    apiClient.post.mockRejectedValue({ response: { data: { error: 'tx_bad_auth' } } });
    const { container } = await renderInEditMode();

    setThresholds(container, { low: 1, med: 2, high: 3 });
    clickSave(container);

    expect(await screen.findByText('tx_bad_auth')).toBeInTheDocument();
  });
});
