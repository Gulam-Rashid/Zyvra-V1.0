import React from 'react';

interface ZyvraLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  showWordmark?: boolean;
  className?: string;
}

export const ZyvraLogo: React.FC<ZyvraLogoProps> = ({
  size = 'md',
  showTagline = true,
  showWordmark = true,
  className = '',
}) => {
  const dimensions =
    size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-9 w-9';
  const titleSize =
    size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Minimal Geometric Z + Ascending Knowledge Symbol */}
      <div
        className={`relative flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0F172A] via-[#1E1B4B] to-[#0F172A] shadow-sm ring-1 ring-white/15 ${dimensions}`}
      >
        <svg
          viewBox="0 0 128 128"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-full w-full p-1.5"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="zyvraMarkGrad"
              x1="20"
              y1="20"
              x2="108"
              y2="108"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#6366F1" />
              <stop offset="55%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>
          </defs>
          <path
            d="M28 32C28 28.6863 30.6863 26 34 26H94C98.2199 26 100.699 30.748 98.1946 34.1489L48.5 92H92C95.3137 92 98 94.6863 98 98V100C98 103.314 95.3137 106 92 106H32C27.7801 106 25.3012 101.252 27.8054 97.8511L77.5 40H34C30.6863 40 28 37.3137 28 34V32Z"
            fill="url(#zyvraMarkGrad)"
          />
          <circle cx="94" cy="64" r="7.5" fill="#06B6D4" />
          <path
            d="M30 64H48"
            stroke="#38BDF8"
            strokeWidth="6"
            strokeLinecap="round"
            opacity="0.85"
          />
        </svg>
      </div>

      {showWordmark && (
        <div className=" leading-none">
          <div className="flex items-baseline gap-0.5">
            <span className={`font-extrabold tracking-tight ${titleSize}`}>
              Zyvra
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
          </div>
          {showTagline && (
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Exam Prep Platform
            </p>
          )}
        </div>
      )}
    </div>
  );
};
