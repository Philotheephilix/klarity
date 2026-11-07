'use client';

import { useEffect, useState } from 'react';
import { Card } from './Card';

export function LoadingCard({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="card-grid">
      <Card>
        <div className="card-pad state-card">
          <div className="card-title">{label}</div>
          <p className="card-note">Fetching from the Klarity API...</p>
        </div>
      </Card>
    </div>
  );
}

export function ErrorCard({ error }: { error: string }) {
  return (
    <div className="card-grid">
      <Card>
        <div className="card-pad state-card">
          <div className="card-title state-error">Could not load</div>
          <p className="card-note">{error}</p>
        </div>
      </Card>
    </div>
  );
}

type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: T };

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    fn()
      .then((data) => {
        if (active) setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (active) {
          setState({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
