"use client";

// Bouton d'envoi qui demande une confirmation avant une action irréversible.
export function ConfirmButton({
  message,
  className,
  label,
  children,
}: {
  message: string;
  className?: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      aria-label={label}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
