interface RequirementInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmitShortcut: () => void;
  loading: boolean;
  onSearch: () => void;
}

/** Roughly the length at which a brief starts carrying more than a job title. */
const USEFUL_LENGTH = 60;

export default function RequirementInput({
  value,
  onChange,
  onSubmitShortcut,
  loading,
  onSearch,
}: RequirementInputProps) {
  const trimmed = value.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const thin = trimmed.length > 0 && trimmed.length < USEFUL_LENGTH;

  return (
    <div className="space-y-4">
      <label className="block" htmlFor="requirement">
        <span className="mb-2 block font-jakarta text-lg font-semibold text-alphanom-navy">
          Who are you looking for?
        </span>
        <textarea
          id="requirement"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // keydown, not keypress: Ctrl+Enter does not fire a keypress event
          // in Firefox, so the shortcut printed below the box did nothing
          // there. keypress is also deprecated.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSubmitShortcut();
            }
          }}
          placeholder="Paste a job description, or describe your ideal candidate — role, must-have skills, years of experience, and location."
          className="input-field h-36 resize-none leading-relaxed"
          disabled={loading}
          aria-describedby="requirement-hint"
        />
      </label>

      <p id="requirement-hint" className="-mt-1 text-xs text-alphanom-muted">
        {trimmed.length === 0 ? (
          <>
            The four things that change the results most:{' '}
            <strong className="font-medium text-alphanom-navy">job title</strong>,{' '}
            <strong className="font-medium text-alphanom-navy">must-have skills</strong>,{' '}
            <strong className="font-medium text-alphanom-navy">years of experience</strong> and{' '}
            <strong className="font-medium text-alphanom-navy">location</strong>.
          </>
        ) : thin ? (
          <>
            {words} word{words === 1 ? '' : 's'} — a title on its own returns everyone with that
            title. Add skills, experience and a city, or press the button and answer the questions
            on the next screen.
          </>
        ) : (
          <>
            {words} words. You&rsquo;ll see what was understood — and can correct it — before any
            search runs.
          </>
        )}
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          onClick={onSearch}
          disabled={loading || trimmed.length === 0}
          className="btn-primary w-full sm:w-auto sm:flex-1"
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Reading your requirement…
            </>
          ) : (
            <>Review &amp; find candidates →</>
          )}
        </button>

        <span className="text-center text-xs text-alphanom-muted sm:text-left">
          or press{' '}
          <kbd className="rounded border border-alphanom-line bg-alphanom-bg px-1.5 py-0.5 font-mono text-[11px]">
            Ctrl
          </kbd>{' '}
          +{' '}
          <kbd className="rounded border border-alphanom-line bg-alphanom-bg px-1.5 py-0.5 font-mono text-[11px]">
            Enter
          </kbd>
        </span>
      </div>
    </div>
  );
}
