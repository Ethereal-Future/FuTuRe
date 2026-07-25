/**
 * Tests for #532 — lang attribute and locale-aware page title updates.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import { LanguageSelector } from '../src/components/LanguageSelector';

function renderWithI18n(ui) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('LanguageSelector — lang attribute', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  it('sets html[lang] to the selected language', async () => {
    renderWithI18n(<LanguageSelector />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'fr' } });
    await i18n.changeLanguage('fr');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('sets html[dir] to rtl when an RTL language is selected', async () => {
    renderWithI18n(<LanguageSelector />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'ar' } });
    await i18n.changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('sets html[dir] back to ltr when switching from RTL to LTR', async () => {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
    renderWithI18n(<LanguageSelector />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'en' } });
    await i18n.changeLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
