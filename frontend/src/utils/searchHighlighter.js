/**
 * Highlights search terms in text
 * @param {string} text - The text to highlight
 * @param {string} query - The search query
 * @returns {string} HTML string with highlighted terms
 */
export function highlightSearchTerms(text, query) {
  if (!query || !text) return text;
  
  const regex = new RegExp(`(${query})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

/**
 * Filters transactions based on search criteria
 * @param {Array} transactions - Array of transactions
 * @param {Object} criteria - Search criteria
 * @returns {Array} Filtered transactions
 */
export function filterTransactions(transactions, criteria) {
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
      const txDate = new Date(tx.created_at);
      const fromDate = new Date(criteria.dateFrom);
      if (txDate < fromDate) return false;
    }

    if (criteria.dateTo) {
      const txDate = new Date(tx.created_at);
      const toDate = new Date(criteria.dateTo);
      toDate.setHours(23, 59, 59, 999);
      if (txDate > toDate) return false;
    }

    // Amount range filter
    if (criteria.amountMin) {
      const amount = parseFloat(tx.amount);
      if (amount < parseFloat(criteria.amountMin)) return false;
    }

    if (criteria.amountMax) {
      const amount = parseFloat(tx.amount);
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
