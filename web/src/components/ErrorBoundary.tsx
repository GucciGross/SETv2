import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { hasError: boolean; message?: string };

/** Catches render errors in a subtree (e.g. charts) so the app keeps working. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(err: Error) {
    console.error('[ErrorBoundary]', err);
    this.setState({ message: err.message });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="py-6 text-center">
            <p className="text-sm text-set-dim">This part failed to load.</p>
            {this.state.message && import.meta.env.DEV && (
              <pre className="mt-2 text-[11px] text-red-400 whitespace-pre-wrap break-all px-2">{this.state.message}</pre>
            )}
          </div>
        )
      );
    }
    return this.props.children;
  }
}
