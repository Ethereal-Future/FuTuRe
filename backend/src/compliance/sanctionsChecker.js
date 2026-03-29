// Sanctions list checker.
// In production, integrate with OFAC SDN, UN, EU sanctions APIs.
// This module ships with a minimal built-in list and supports loading external lists.

const BUILT_IN_SANCTIONS = [
  // Format: { name, country, reason }
  // Populated from public OFAC/UN data in production
];

class SanctionsChecker {
  constructor() {
    this._list = [...BUILT_IN_SANCTIONS];
  }

  loadList(entries) {
    this._list = entries;
  }

  async check(fullName, nationality) {
    const nameLower = fullName.toLowerCase();

    const match = this._list.find(entry => {
      const entryName = entry.name.toLowerCase();
      return nameLower.includes(entryName) || entryName.includes(nameLower);
    });

    if (match) {
      return { hit: true, reason: `Matched sanctions entry: ${match.name} (${match.reason})` };
    }

    return { hit: false };
  }
}

export default new SanctionsChecker();
