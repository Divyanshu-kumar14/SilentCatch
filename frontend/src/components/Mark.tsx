export function Mark({ className = "", tone = "ink" }: { className?: string; tone?: "ink" | "light" }) {
  const ink = tone === "light" ? "#EDE8DD" : "#15171A";
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="11" cy="12" r="8.25" stroke={ink} strokeWidth="1.25" />
      <circle cx="11" cy="12" r="3.1" stroke={ink} strokeWidth="1.25" />
      <circle cx="17.6" cy="6.2" r="2.05" fill="#B0232A" />
    </svg>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <path d="M3.5 10h12.5M11 4.8 16.2 10 11 15.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function ArrowUpRight({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <path d="M5.5 14.5 14.5 5.5M6.6 5.5h7.9v7.9" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
