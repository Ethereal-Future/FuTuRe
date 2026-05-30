export interface Transaction {
  id?: string;
  memo?: string;
  source?: string;
  destination?: string;
  type?: string;
  status?: string;
  created_at?: string;
  amount?: string;
}

export interface SearchCriteria {
  query?: string;
  type?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: string;
  amountMax?: string;
  address?: string;
}

export function highlightSearchTerms(text: string, query: string): string {
  if (!query || !text) return text;

  const regex = new RegExp(`(${query})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

export function filterTransactions(transactions: Transaction[], criteria: SearchCriteria): Transaction[] {
  return transactions.filter(tx => {
    // Text search
    if (criteria.query) {
      const searchText = criteria.query.toLowerCase();
      const matchesQuery =
        tx.id?.toLowerCase().includes(searchText) ||
        tx.memo?.toLowerCase().includes(searchText) ||
        tx.source?.toLowerCase().includes(searchText) ||
        tx.destination?.toLowerCase().includes(searchText);

      if (!matchesQuery) return false;
    }

    // Type filter
    if (criteria.type && criteria.type !== 'all') {
      if (tx.type !== criteria.type) return false;
    }

    // Status filter
    if (criteria.status && criteria.status !== 'all') {
      if (tx.status !== criteria.status) return false;
    }

    // Date range filter
    if (criteria.dateFrom) {
      const txDate = new Date(tx.created_at ?? '');
      const fromDate = new Date(criteria.dateFrom);
      if (txDate < fromDate) return false;
    }

    if (criteria.dateTo) {
      const txDate = new Date(tx.created_at ?? '');
      const toDate = new Date(criteria.dateTo);
      toDate.setHours(23, 59, 59, 999);
      if (txDate > toDate) return false;
    }

    // Amount range filter
    if (criteria.amountMin) {
      const amount = parseFloat(tx.amount ?? '0');
      if (amount < parseFloat(criteria.amountMin)) return false;
    }

    if (criteria.amountMax) {
      const amount = parseFloat(tx.amount ?? '0');
      if (amount > parseFloat(criteria.amountMax)) return false;
    }

    // Address filter
    if (criteria.address) {
      const addressLower = criteria.address.toLowerCase();
      const matchesAddress =
        tx.source?.toLowerCase().includes(addressLower) ||
        tx.destination?.toLowerCase().includes(addressLower);

      if (!matchesAddress) return false;
    }

    return true;
  });
}
