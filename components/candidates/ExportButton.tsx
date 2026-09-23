'use client';

import { useState } from 'react';
import { Candidate } from '@/types/index';

interface ExportButtonProps {
  candidates: Candidate[];
  roleName: string;
  removed?: Candidate[];
}

export default function ExportButton({ candidates, roleName, removed = [] }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    if (candidates.length === 0) {
      setError('Please select candidates to export');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates, roleName, removed }),
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // The server already sets a sanitised filename in Content-Disposition,
      // but `download` overrides it. Unsanitised, a role like
      // "Backend/Frontend Engineer" puts a path separator in the filename and
      // the browser keeps only the part after it. Same rule as the server's
      // getExcelFileName, inlined rather than imported so the client bundle
      // does not pull in exceljs.
      const safeRole = roleName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') || 'Candidates';
      a.download = `AlphaSourcer_${safeRole}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleExport}
        disabled={loading || candidates.length === 0}
        className="inline-flex items-center gap-2 rounded-card bg-white px-5 py-3 font-jakarta font-semibold text-alphanom-navy shadow-lift transition-all hover:brightness-95 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span aria-hidden>⬇</span>
        {loading ? 'Preparing…' : `Export ${candidates.length} to Excel`}
      </button>
      {error && <p className="mt-2 text-sm text-rose-200">{error}</p>}
    </div>
  );
}
