// Icônes au trait, en SVG, qui prennent la couleur du texte.
type Props = { className?: string };
const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

export const PlusIcon = ({ className = "size-5" }: Props) => (
  <svg {...base} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const BackIcon = ({ className = "size-6" }: Props) => (
  <svg {...base} className={className}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
export const CloseIcon = ({ className = "size-6" }: Props) => (
  <svg {...base} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const ChevronIcon = ({ className = "size-5" }: Props) => (
  <svg {...base} className={className}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const ChevronDownIcon = ({ className = "size-5" }: Props) => (
  <svg {...base} className={className}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const CheckIcon = ({ className = "size-4" }: Props) => (
  <svg {...base} strokeWidth={2.4} className={className}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);
export const CalendarIcon = ({ className = "size-6" }: Props) => (
  <svg {...base} className={className}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
export const WalletIcon = ({ className = "size-6" }: Props) => (
  <svg {...base} className={className}>
    <path d="M4 7h16v12H4z" />
    <path d="M4 11h16M15 15h2" />
  </svg>
);
export const UserIcon = ({ className = "size-5" }: Props) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </svg>
);
export const QrIcon = ({ className = "size-5" }: Props) => (
  <svg {...base} className={className}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4" />
  </svg>
);
export const TrashIcon = ({ className = "size-5" }: Props) => (
  <svg {...base} className={className}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
);
export const UploadIcon = ({ className = "size-5" }: Props) => (
  <svg {...base} className={className}>
    <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
  </svg>
);
