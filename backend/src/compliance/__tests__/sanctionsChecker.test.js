import { describe, it, expect } from 'vitest';
import {
  normalizeAndTokenizeName,
  doubleMetaphoneKeys,
  damerauLevenshtein,
  jaroWinkler,
  nameSimilarity,
  scoreMatchConfidence,
  matchesSanctionsList,
} from '../sanctionsChecker.js';

const SDN_LIST = [
  { name: 'Mohammad Al-Assad', aliases: ['Muhamad Al Assad', 'Mohammed al-Assad'] },
  { name: 'Vladimir Putin', aliases: ['Putin, Vladimir'] },
  { name: 'Kim Jong Un', aliases: ['Kim Jong-un'] },
  { name: 'Osama bin Laden', aliases: ['Usama bin Ladin'] },
  { name: 'Bashar al-Assad', aliases: ['Bashar Hafez al-Assad'] },
  { name: 'Ali Khamenei', aliases: ['Ayatollah Ali Khamenei'] },
  { name: 'Qasem Soleimani', aliases: ['Qassem Soleimani'] },
  { name: 'Hassan Nasrallah', aliases: ['Hasan Nasrallah'] },
  { name: 'Ibrahim al-Qadri', aliases: ['Ibraheem Al Qadri'] },
  { name: 'Nikolai Ivanov', aliases: ['Nikolay Ivanov'] },
];

describe('normalizeAndTokenizeName', () => {
  it('removes honorifics and lowercases', () => {
    expect(normalizeAndTokenizeName('Mr. Vladimir Putin')).toEqual(['putin', 'vladimir']);
  });

  it('strips punctuation and sorts tokens alphabetically', () => {
    expect(normalizeAndTokenizeName('Al-Assad, Mohammad')).toEqual(['al', 'assad', 'mohammad']);
  });

  it('handles empty and non-string input', () => {
    expect(normalizeAndTokenizeName('')).toEqual([]);
    expect(normalizeAndTokenizeName(null)).toEqual([]);
  });
});

describe('doubleMetaphoneKeys', () => {
  it('produces primary and secondary phonetic keys', () => {
    const keys = doubleMetaphoneKeys('Mohammad');
    expect(keys.primary).toBeTruthy();
    expect(keys).toHaveProperty('secondary');
  });

  it('matches sound-alike transliterations', () => {
    expect(doubleMetaphoneKeys('Mohammad').primary).toBe(doubleMetaphoneKeys('Muhamad').primary);
  });
});

describe('damerauLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('putin', 'putin')).toBe(0);
  });

  it('counts adjacent transpositions as a single edit', () => {
    expect(damerauLevenshtein('putin', 'putni')).toBe(1);
  });
});

describe('jaroWinkler', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('putin', 'putin')).toBe(1);
  });

  it('scores similar names highly', () => {
    expect(jaroWinkler('mohammad', 'muhamad')).toBeGreaterThan(0.8);
  });
});

describe('nameSimilarity', () => {
  it('detects inverted first/last names', () => {
    expect(nameSimilarity('Vladimir Putin', 'Putin, Vladimir')).toBeGreaterThanOrEqual(0.85);
  });

  it('detects hyphen/space variations', () => {
    expect(nameSimilarity('Al-Assad', 'Al Assad')).toBeGreaterThanOrEqual(0.85);
  });

  it('detects single vowel changes', () => {
    expect(nameSimilarity('Mohammad', 'Mohammed')).toBeGreaterThanOrEqual(0.85);
  });
});

describe('scoreMatchConfidence', () => {
  it('returns High for near-identical names', () => {
    expect(scoreMatchConfidence(0.97)).toBe('High');
  });

  it('returns Medium for threshold-level matches', () => {
    expect(scoreMatchConfidence(0.86)).toBe('Medium');
  });

  it('returns Low for weak matches', () => {
    expect(scoreMatchConfidence(0.5)).toBe('Low');
  });
});

describe('matchesSanctionsList', () => {
  const transliteratedVariants = [
    'Mohammed Al Assad',
    'Muhamad Al-Assad',
    'Putin, Vladimir',
    'Kim Jong-un',
    'Usama bin Ladin',
    'Bashar Hafez al-Assad',
    'Ayatollah Ali Khamenei',
    'Qassem Soleimani',
    'Hasan Nasrallah',
    'Ibraheem Al Qadri',
    'Nikolay Ivanov',
    'Mr. Vladimir Putin',
    'Mohammad Al-Assad',
    'Kim Jong Un',
    'Osama bin Laden',
    'Ali Khamenei',
    'Qasem Soleimani',
    'Hassan Nasrallah',
    'Ibrahim al-Qadri',
    'Nikolai Ivanov',
  ];

  it('detects all 20 known transliterated OFAC entity variants', () => {
    for (const variant of transliteratedVariants) {
      const result = matchesSanctionsList(variant, SDN_LIST);
      expect(result.matched, `expected match for ${variant}`).toBe(true);
      expect(['High', 'Medium']).toContain(result.confidence);
    }
  });

  it('does not flag unrelated names', () => {
    const result = matchesSanctionsList('John Smith', SDN_LIST);
    expect(result.matched).toBe(false);
  });

  it('flags High/Medium matches for manual compliance hold', () => {
    const result = matchesSanctionsList('Mohammed Al Assad', SDN_LIST);
    expect(result.requiresReview).toBe(true);
  });
});
