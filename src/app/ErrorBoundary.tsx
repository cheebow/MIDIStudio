// Last line of defence (ADR-087): an unexpected error while drawing (e.g. a damaged value that got
// past the project-file checks) shows a way out instead of a blank page. Edits are autosaved, so a
// reload offers to restore them.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="fatal-error" role="alert">
        <h1>{t('問題が起きたため、画面を表示できません。')}</h1>
        <p>{t('ページを再読み込みしてください。自動保存があれば、起動時に復元できます。')}</p>
        <pre>{error.message}</pre>
        <button type="button" className="primary" onClick={() => location.reload()}>
          {t('再読み込み')}
        </button>
      </div>
    );
  }
}
