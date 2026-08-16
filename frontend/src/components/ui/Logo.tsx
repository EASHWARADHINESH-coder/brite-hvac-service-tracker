// brite engineers brand logo — the bordered box with "brite" over three flow bars, redrawn as
// SVG from the brand mark. The white panel keeps it legible on both light and dark surfaces.

export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 48" className={className} role="img" aria-label="brite engineers">
      {/* outer bordered box */}
      <rect x="2.5" y="2.5" width="39" height="43" rx="4" fill="#ffffff" stroke="#111111" strokeWidth="3.5" />
      {/* brite banner */}
      <rect x="6.5" y="6.5" width="31" height="16" rx="2" fill="#111111" />
      <text
        x="22" y="19"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="12.5"
        fontWeight="800"
        letterSpacing="0.2"
        fill="#ffffff"
      >
        brite
      </text>
      {/* three flow bars with a central vertical spine */}
      <rect x="9" y="27.5" width="26" height="3.8" rx="1.9" fill="#111111" />
      <rect x="9" y="34" width="26" height="3.8" rx="1.9" fill="#111111" />
      <rect x="9" y="40.5" width="26" height="3.8" rx="1.9" fill="#111111" />
      <rect x="20.1" y="27.5" width="3.8" height="16.8" rx="1.9" fill="#111111" />
    </svg>
  );
}

export default function Logo({
  wordmark = true,
  markClassName,
}: {
  wordmark?: boolean;
  markClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className={markClassName} />
      {wordmark && (
        <div className="leading-tight">
          <div className="text-lg font-bold text-slate-800">brite engineers</div>
          <div className="text-xs text-slate-400">AI Service Tracker</div>
        </div>
      )}
    </div>
  );
}
