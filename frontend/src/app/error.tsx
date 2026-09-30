'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-paper text-ink p-8">
      <div className="max-w-md w-full bg-paper-dim border border-hairline p-8 rounded shadow-sm text-center">
        <AlertCircle className="w-12 h-12 text-risk-critical mx-auto mb-4" />
        <h2 className="font-serif-display text-2xl font-semibold mb-2">Service Unavailable</h2>
        <p className="text-ink-soft mb-6 text-sm">
          We encountered an issue connecting to the SwasthyaGrid operations center. 
          The backend service might be down or unreachable.
        </p>
        <button
          onClick={() => reset()}
          className="flex items-center justify-center mx-auto gap-2 bg-ink text-paper px-4 py-2 rounded font-medium hover:bg-ink-soft transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    </div>
  );
}
