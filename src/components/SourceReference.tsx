import { useState } from 'react';

/**
 * Small, accessible source-reference control (`ICON 1.5 · p.46`). It is
 * reachable by hover, keyboard focus, and touch/tap, and it is deliberately
 * NOT the only tap/click target for selecting an option — every creation
 * choice is itself focusable. The page is shown inline on activation so the
 * information is available to keyboard and assistive-technology users without
 * relying on hover-driven tooltips.
 */
export function SourceReference({ page, label = 'ICON 1.5' }: { page: number; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="source-reference" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="source-reference-trigger"
        aria-expanded={open}
        aria-label={`Source reference: ${label}, page ${page}`}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {label} · p.{page}
      </button>
      {open && <span className="source-reference-pop">{label} · p.{page}</span>}
    </span>
  );
}