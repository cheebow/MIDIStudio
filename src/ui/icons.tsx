// Small inline SVG icons (no icon font / external assets). 18px, stroke = currentColor.
import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const LoopIcon = () => (
  <Svg>
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </Svg>
);

export const MetronomeIcon = () => (
  <Svg>
    <path d="M9 3h6l4 18H5L9 3z" />
    <path d="M12 16l5-9" />
    <path d="M7 16h10" />
  </Svg>
);

export const SelectIcon = () => (
  <Svg>
    <path d="M5 3l14 8-6 2-2 6L5 3z" />
  </Svg>
);

export const PencilIcon = () => (
  <Svg>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5z" />
    <path d="M14 6l3 3" />
  </Svg>
);

export const ScissorsIcon = () => (
  <Svg>
    <circle cx="6" cy="6.5" r="2.6" />
    <circle cx="6" cy="17.5" r="2.6" />
    <path d="M20 4.5L8.2 15.8" />
    <path d="M20 19.5L8.2 8.2" />
  </Svg>
);

/** Glue: a tube with a drop at its nozzle. */
export const GlueIcon = () => (
  <Svg>
    <path d="M8 21h8l1-10H7l1 10z" />
    <path d="M10 11l1-4h2l1 4" />
    <path d="M12 7V3.5" />
  </Svg>
);

/** Snap: a note block aligned to the grid lines. */
export const SnapGridIcon = () => (
  <Svg>
    <path d="M4 3v18" strokeWidth="1.2" />
    <path d="M10 3v18" strokeWidth="1.2" />
    <path d="M16 3v18" strokeWidth="1.2" />
    <rect x="10" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
    <path d="M7 12h2" />
  </Svg>
);
