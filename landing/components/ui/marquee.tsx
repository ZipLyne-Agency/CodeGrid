/**
 * Seamless infinite marquee. Renders the children twice and translates -50%,
 * so the loop is gapless. Pauses on hover; halts under reduced-motion (CSS).
 */
export function Marquee({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`marquee-mask overflow-hidden ${className}`}>
      <div className="marquee-track hover:[animation-play-state:paused]">
        <div className="flex shrink-0">{children}</div>
        <div className="flex shrink-0" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}
