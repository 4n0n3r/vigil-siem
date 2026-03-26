import Link from "next/link";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
}

export function Logo({ size = "md", showWordmark = true }: LogoProps) {
  const iconSizes = { sm: 20, md: 28, lg: 40 };
  const textSizes = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-3xl",
  };
  const s = iconSizes[size];

  return (
    <Link href="/" className="flex items-center gap-2.5 group">
      {/* Sentinel Eye SVG */}
      <svg
        width={s}
        height={s}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="transition-all duration-300 group-hover:drop-shadow-[0_0_8px_rgba(0,229,255,0.7)]"
      >
        {/* Upper arc — eyelid */}
        <path
          d="M4 20 C10 8, 30 8, 36 20"
          stroke="#E2E8F0"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Pupil — glowing circle */}
        <circle
          cx="20"
          cy="20"
          r="5"
          fill="#00E5FF"
          style={{ filter: "drop-shadow(0 0 6px #00E5FF)" }}
        />
        {/* Inner pupil dot */}
        <circle cx="20" cy="20" r="2" fill="#080B10" />
      </svg>

      {showWordmark && (
        <span
          className={`font-display font-bold ${textSizes[size]} text-text-primary tracking-tight`}
        >
          vigil
        </span>
      )}
    </Link>
  );
}
