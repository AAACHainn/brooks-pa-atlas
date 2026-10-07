/** Rounded robot mark, shared by the launcher and window header. */
export function AiRobotIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 32 32" fill="none"
    className={className} aria-hidden="true" focusable="false">
    <circle cx="16" cy="3.8" r="1.65" fill="currentColor" />
    <path d="M16 5.2v3.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <rect x="3" y="13.2" width="4.5" height="8.6" rx="2.25" fill="currentColor" />
    <rect x="24.5" y="13.2" width="4.5" height="8.6" rx="2.25" fill="currentColor" />
    <path d="M16 9C8.8 9 6 10.8 6 17.5S8.8 26 16 26s10-1.8 10-8.5S23.2 9 16 9Z"
      stroke="currentColor" strokeWidth="2.8" strokeLinejoin="round" />
    <ellipse cx="12.4" cy="17.5" rx="1.15" ry="1.75" fill="currentColor" />
    <ellipse cx="19.6" cy="17.5" rx="1.15" ry="1.75" fill="currentColor" />
  </svg>;
}
