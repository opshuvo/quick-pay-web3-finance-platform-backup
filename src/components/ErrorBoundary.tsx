import { Component, type ReactNode } from 'react'
import { ErrorState } from '@/components/ui'

interface State {
  failed: boolean
}

/** Keeps one broken screen from taking the whole app down. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }

  componentDidCatch(error: unknown) {
    console.error('Screen crashed', error)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="card">
          <ErrorState body="This screen hit an unexpected problem. Your funds are not affected." onRetry={() => this.setState({ failed: false })} />
        </div>
      )
    }
    return this.props.children
  }
}
