import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
    if (typeof this.props.onError === 'function') {
      try {
        this.props.onError(error, errorInfo);
      } catch (err) {
        console.error('[ErrorBoundary onError callback failed]:', err);
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (typeof this.props.onReset === 'function') {
      try {
        this.props.onReset();
      } catch (err) {
        console.error('[ErrorBoundary onReset callback failed]:', err);
      }
    }
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({
          error: this.state.error,
          errorInfo: this.state.errorInfo,
          resetError: this.handleReset
        });
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      const title = this.props.title || 'Something went wrong displaying this view';
      const errorMessage = this.state.error?.message || 'An unexpected rendering error occurred.';

      return (
        <div
          role="alert"
          className="error-boundary-container"
          style={{
            margin: '20px auto',
            maxWidth: '680px',
            padding: '24px 28px',
            backgroundColor: 'var(--card-bg, #182030)',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
            borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
            color: 'var(--text-primary, #ffffff)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            fontFamily: 'inherit'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>{title}</h3>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary, #94a3b8)'
                }}
              >
                {errorMessage}
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '10px',
              marginTop: '6px',
              flexWrap: 'wrap'
            }}
          >
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--theme-primary, #0075ed)',
                color: '#ffffff',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={14} />
              Try Again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
                background: 'transparent',
                color: 'var(--text-primary, #ffffff)',
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

