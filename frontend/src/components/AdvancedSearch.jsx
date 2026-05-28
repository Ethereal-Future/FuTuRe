import { useState, useEffect } from 'react';
import './AdvancedSearch.css';

export default function AdvancedSearch({ onSearch, onSaveSearch, savedSearches = [] }) {
  const [searchCriteria, setSearchCriteria] = useState({
    query: '',
    type: 'all',
    status: 'all',
    dateFrom: '',
    dateTo: '',
    amountMin: '',
    amountMax: '',
    address: ''
  });

  const [searchHistory, setSearchHistory] = useState(() => {
    const saved = localStorage.getItem('searchHistory');
    return saved ? JSON.parse(saved) : [];
  });

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (searchCriteria.query.length > 2) {
      const filtered = searchHistory
        .filter(h => h.toLowerCase().includes(searchCriteria.query.toLowerCase()))
        .slice(0, 5);
      setSuggestions(filtered);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [searchCriteria.query, searchHistory]);

  const handleSearch = () => {
    onSearch(searchCriteria);
    
    // Add to search history
    if (searchCriteria.query && !searchHistory.includes(searchCriteria.query)) {
      const newHistory = [searchCriteria.query, ...searchHistory].slice(0, 10);
      setSearchHistory(newHistory);
      localStorage.setItem('searchHistory', JSON.stringify(newHistory));
    }
  };

  const handleSaveSearch = () => {
    const searchName = prompt('Enter a name for this search:');
    if (searchName) {
      onSaveSearch({ name: searchName, criteria: searchCriteria });
    }
  };

  const handleLoadSearch = (search) => {
    setSearchCriteria(search.criteria);
  };

  const handleClearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem('searchHistory');
  };

  return (
    <div className="advanced-search">
      <div className="search-header">
        <h3>Advanced Search</h3>
      </div>

      <div className="search-form">
        <div className="search-input-wrapper">
          <input
            type="text"
            placeholder="Search transactions..."
            value={searchCriteria.query}
            onChange={(e) => setSearchCriteria({ ...searchCriteria, query: e.target.value })}
            onFocus={() => searchCriteria.query.length > 2 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="suggestions-dropdown">
              {suggestions.map((suggestion, idx) => (
                <div
                  key={idx}
                  className="suggestion-item"
                  onClick={() => {
                    setSearchCriteria({ ...searchCriteria, query: suggestion });
                    setShowSuggestions(false);
                  }}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="filter-row">
          <select
            value={searchCriteria.type}
            onChange={(e) => setSearchCriteria({ ...searchCriteria, type: e.target.value })}
          >
            <option value="all">All Types</option>
            <option value="payment">Payment</option>
            <option value="create_account">Create Account</option>
            <option value="path_payment">Path Payment</option>
          </select>

          <select
            value={searchCriteria.status}
            onChange={(e) => setSearchCriteria({ ...searchCriteria, status: e.target.value })}
          >
            <option value="all">All Status</option>
            <option value="success">Success</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="filter-row">
          <div className="date-range">
            <label>From:</label>
            <input
              type="date"
              value={searchCriteria.dateFrom}
              onChange={(e) => setSearchCriteria({ ...searchCriteria, dateFrom: e.target.value })}
            />
            <label>To:</label>
            <input
              type="date"
              value={searchCriteria.dateTo}
              onChange={(e) => setSearchCriteria({ ...searchCriteria, dateTo: e.target.value })}
            />
          </div>
        </div>

        <div className="filter-row">
          <div className="amount-range">
            <label>Amount:</label>
            <input
              type="number"
              placeholder="Min"
              value={searchCriteria.amountMin}
              onChange={(e) => setSearchCriteria({ ...searchCriteria, amountMin: e.target.value })}
            />
            <span>-</span>
            <input
              type="number"
              placeholder="Max"
              value={searchCriteria.amountMax}
              onChange={(e) => setSearchCriteria({ ...searchCriteria, amountMax: e.target.value })}
            />
          </div>
        </div>

        <div className="filter-row">
          <input
            type="text"
            placeholder="Filter by address..."
            value={searchCriteria.address}
            onChange={(e) => setSearchCriteria({ ...searchCriteria, address: e.target.value })}
          />
        </div>

        <div className="search-actions">
          <button onClick={handleSearch} className="btn-primary">Search</button>
          <button onClick={handleSaveSearch} className="btn-secondary">Save Search</button>
          <button onClick={() => setSearchCriteria({
            query: '', type: 'all', status: 'all', dateFrom: '', dateTo: '', 
            amountMin: '', amountMax: '', address: ''
          })} className="btn-secondary">Clear</button>
        </div>
      </div>

      {savedSearches.length > 0 && (
        <div className="saved-searches">
          <h4>Saved Searches</h4>
          <div className="saved-search-list">
            {savedSearches.map((search, idx) => (
              <div key={idx} className="saved-search-item" onClick={() => handleLoadSearch(search)}>
                {search.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {searchHistory.length > 0 && (
        <div className="search-history">
          <div className="history-header">
            <h4>Recent Searches</h4>
            <button onClick={handleClearHistory} className="btn-link">Clear</button>
          </div>
          <div className="history-list">
            {searchHistory.map((item, idx) => (
              <span key={idx} className="history-item" onClick={() => setSearchCriteria({ ...searchCriteria, query: item })}>
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
