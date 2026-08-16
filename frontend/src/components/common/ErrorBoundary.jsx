import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled React Error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          width: '100vw',
          padding: '1.5rem',
          backgroundColor: '#0a0d14',
          color: '#f1f5f9',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          textAlign: 'center',
        }}>
          <div style={{
            background: '#101524',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '2rem 1.5rem',
            maxWidth: '420px',
            width: '100%',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'rgba(244, 63, 94, 0.15)',
              color: '#f43f5e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
            }}>
              <AlertCircle size={26} />
            </div>

            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              화면을 불러오는 중 오류가 발생했습니다
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              일시적인 네트워크 또는 브라우저 오류일 수 있습니다. 새로고침을 눌러 다시 시도해 주세요.
            </p>

            {this.state.error && (
              <div style={{
                background: '#0a0d14',
                padding: '0.6rem 0.8rem',
                borderRadius: '8px',
                fontSize: '0.72rem',
                color: '#f43f5e',
                marginBottom: '1.25rem',
                textAlign: 'left',
                overflowX: 'auto',
                fontFamily: 'monospace',
                maxHeight: '80px',
              }}>
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <button
              onClick={this.handleReload}
              style={{
                width: '100%',
                padding: '0.65rem 1rem',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <RefreshCw size={16} />
              <span>새로고침</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
