# compliance/sanctionsChecker.js: Sanctions screening fuzzy name matching lacks phonetic normalization (Double Metaphone / Levenshtein), missing aliases

**Domain:** Compliance & AML  
**Complexity:** Hard  
**Labels:** `bug`, `compliance`, `security`, `legal`  
**Issue ID:** ISSUE-083

---

## Background
In `backend/src/compliance/sanctionsChecker.js`, names are checked against the OFAC Specially Designated Nationals (SDN) sanctions list using simple string substring matching or basic lowercase comparison:
```javascript
export function matchesSanctionsList(name, sanctionsList) {
  const normalized = name.toLowerCase().trim();
  return sanctionsList.some(entry => entry.name.toLowerCase().includes(normalized));
}
```

## Problem
- Sanctions lists contain names in various transliterations (e.g. Arabic, Cyrillic, Persian transliterated into Latin characters).
- Simple string substring matching fails completely if:
  1. Names have minor spelling variations (e.g. "Mohammad" vs "Mohammed" vs "Muhamad").
  2. First and last names are inverted (e.g. "Vladimir Putin" vs "Putin, Vladimir").
  3. Punctuation, hyphens, or middle names differ (e.g. "Al-Assad" vs "Al Assad").
- Sanctioned entities can bypass screening by simply inserting a space or changing a single vowel, leading to catastrophic violations of OFAC and international sanctions laws.

## Proposed Solution
Implement enterprise-grade phonetic and fuzzy matching algorithms:
1. Normalize names: remove honorifics, strip punctuation, sort name tokens alphabetically (Token Sort Ratio).
2. Apply the **Double Metaphone** phonetic algorithm to generate primary and secondary phonetic keys.
3. Use **Damerau-Levenshtein distance** / Jaro-Winkler string similarity with a configurable threshold (e.g. similarity >= 0.85).
4. Score match confidence (Low, Medium, High) and automatically flag High/Medium matches for manual compliance hold.

## Implementation Steps
1. Integrate `double-metaphone` and `fast-levenshtein` libraries.
2. Create `normalizeAndTokenizeName(name)` helper in `sanctionsChecker.js`.
3. Compute phonetic similarity and Jaro-Winkler score against all OFAC alias entries.
4. Flag any match with similarity > 0.85 for human compliance officer review.
5. Add comprehensive test suite with 20 known transliterated OFAC entity variants asserting detection.

## Acceptance Criteria
- [ ] Sanctions checker catches transliterated and misspelled variants of sanctioned names.
- [ ] Phonetic matching (Double Metaphone) identifies sound-alike names.
- [ ] Test suite verifies detection of common evasion spelling tricks.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1330](https://github.com/Ethereal-Future/FuTuRe/issues/1330)
