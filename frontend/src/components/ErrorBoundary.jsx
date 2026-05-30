import { Component } from 'react';
import { logError } from '../utils/errorLogger';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.state.errorInfo = errorInfo;
    logError(error, {
      componentStack: errorInfo?.componentStack,
      context: this.props.context ?? 'unknown',
    });
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    // Allow custom fallback UI
    if (this.props.fallback) {
      return this.props.fallback({ error: this.state.error, reset: this.handleReset });
    }

    // Section-specific fallback for non-full-page errors
    if (this.props.context && this.props.context !== 'root') {
      return (
        <div role="alert" style={styles.sectionContainer}>
          <span style={styles.icon}>⚠️</span>
          <p style={styles.sectionTitle}>{this.props.context} Error</p>
          <p style={styles.message}>{this.state.error.message}</p>
          <button style={styles.button} onClick={this.handleReset}>Try again</button>
        </div>
      );
    }

    // Full-page error fallback
    return (
      <div role="alert" style={styles.container}>
        <span style={styles.icon}>⚠️</span>
        <p style={styles.title}>Something went wrong</p>
        <p style={styles.message}>{this.state.error.message}</p>
        <button style={styles.button} onClick={this.handleReset}>Try again</button>
      </div>
    );
  }
}

const styles = {
  container: {
    padding: '20px 16px',
    margin: '16px 0',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: 6,
    textAlign: 'center',
  },
  sectionContainer: {
    padding: '16px 12px',
    margin: '12px 0',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: 4,
    textAlign: 'center',
  },
  icon:    { fontSize: '2rem' },
  title:   { fontWeight: 600, margin: '8px 0 4px', color: '#b91c1c' },
  sectionTitle: { fontWeight: 600, margin: '4px 0 2px', color: '#b91c1c', fontSize: 14 },
  message: { fontSize: 13, color: '#7f1d1d', marginBottom: 12, wordBreak: 'break-word' },
  button:  {
    background: '#0066cc', color: '#fff', border: 'none',
    padding: '8px 20px', borderRadius: 4, cursor: 'pointer', fontSize: 14,
  },
};
