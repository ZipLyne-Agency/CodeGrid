import Image from "next/image";
import Link from "next/link";

const sizeHeights = {
  sm: "h-5 w-auto sm:h-6",
  md: "h-7 w-auto sm:h-8",
} as const;

const wordmarkClass = {
  sm: "text-xs font-mono font-bold tracking-wider text-text-primary",
  md: "text-sm font-mono font-bold tracking-wider text-text-primary",
} as const;

type BrandLogoProps = {
  className?: string;
  priority?: boolean;
  size?: keyof typeof sizeHeights;
  /** Show “CodeGrid” next to the mark (default true). */
  wordmark?: boolean;
};

export function BrandLogo({
  className = "",
  priority = false,
  size = "md",
  wordmark = true,
}: BrandLogoProps) {
  return (
    <Link
      href="/"
      aria-label="CodeGrid home"
      className={`flex shrink-0 items-center gap-2 sm:gap-2.5 leading-none ${className}`}
    >
      <Image
        src="/logo.webp"
        alt=""
        width={653}
        height={615}
        className={sizeHeights[size]}
        priority={priority}
        aria-hidden
      />
      {wordmark && (
        <span className={wordmarkClass[size]}>CodeGrid</span>
      )}
    </Link>
  );
}
