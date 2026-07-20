/**
 * macOS-style app window chrome. Reinforces "native macOS app" (not a browser
 * tab) and frames the hero demo. Sharp corners per the global design language.
 */
export function WindowFrame({
  title = "CodeGrid",
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "overflow-hidden bg-[#121212] border border-[#2e2e32]",
        "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_1px_0_0_rgba(255,255,255,0.06)_inset,0_40px_80px_-24px_rgba(0,0,0,0.75)]",
        className,
      ].join(" ")}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 h-9 bg-[#1a1a1c] border-b border-[#2e2e32]">
        <span className="flex items-center gap-2">
          <span className="round-full w-3 h-3 bg-[#ff5f57]" />
          <span className="round-full w-3 h-3 bg-[#febc2e]" />
          <span className="round-full w-3 h-3 bg-[#28c840]" />
        </span>
        <span className="flex-1 text-center font-mono text-[11px] text-text-secondary truncate">
          {title}
        </span>
        <span className="w-12" />
      </div>
      {children}
    </div>
  );
}
