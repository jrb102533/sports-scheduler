import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary] caught error:', error);
    console.error('[AppErrorBoundary] component stack:', info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    if (this.state.hasError) {
      const { error, componentStack } = this.state;
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 720 }}>
          <h1 style={{ color: '#dc2626', fontSize: 20, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ color: '#374151', marginBottom: 16 }}>
            {error?.message ?? 'Unknown error'}
          </p>
          {componentStack && (
            <details open style={{ marginBottom: 16 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>
                Component Stack
              </summary>
              <pre style={{
                background: '#f3f4f6',
                padding: 16,
                borderRadius: 8,
                fontSize: 12,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                color: '#1f2937',
              }}>
                {componentStack}
              </pre>
            </details>
          )}
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null, componentStack: null });
              window.location.href = '/';
            }}
            style={{
              background: '#2563eb',
              color: 'white',
              border: 'none',
              padding: '8px 20px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
