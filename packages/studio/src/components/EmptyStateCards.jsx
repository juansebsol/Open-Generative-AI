"use client";

// Decorative, self-contained hero for studio empty states: four overlapping
// gradient cards with line icons. Uses no remote media.

const ICONS = {
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M10 9l5 3-5 3z" />
    </>
  ),
  sparkle: (
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  ),
  layers: (
    <>
      <path d="M12 2l10 5-10 5L2 7z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </>
  ),
};

const CARDS = [
  {
    icon: "image",
    rotate: "-rotate-[12deg]",
    tone: "from-cyan-400/25 via-cyan-500/5 text-cyan-300/70",
  },
  {
    icon: "video",
    rotate: "-rotate-[4deg]",
    tone: "from-violet-400/25 via-violet-500/5 text-violet-300/70",
  },
  {
    icon: "sparkle",
    rotate: "rotate-[6deg]",
    tone: "from-amber-300/25 via-amber-400/5 text-amber-200/70",
    round: true,
  },
  {
    icon: "layers",
    rotate: "rotate-[12deg]",
    tone: "from-rose-400/25 via-rose-500/5 text-rose-300/70",
  },
];

const SIZES = {
  default: {
    card: "w-16 h-20 sm:w-24 sm:h-28",
    round: "w-16 h-16 sm:w-24 sm:h-24",
    overlap: "-ml-3 sm:-ml-4",
    icon: "w-6 h-6 sm:w-8 sm:h-8",
  },
  large: {
    card: "w-20 h-24 sm:w-28 sm:h-32",
    round: "w-20 h-20 sm:w-28 sm:h-28",
    overlap: "-ml-4",
    icon: "w-7 h-7 sm:w-9 sm:h-9",
  },
};

export default function EmptyStateCards({ size = "default", className = "mb-10" }) {
  const s = SIZES[size] || SIZES.default;
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center select-none scale-90 sm:scale-100 ${className}`}
    >
      {CARDS.map((card, i) => (
        <div
          key={card.icon}
          className={`${card.round ? `${s.round} rounded-full` : `${s.card} rounded-2xl`} ${i > 0 ? s.overlap : ""} ${card.rotate} border border-white/10 shadow-2xl transform hover:rotate-0 hover:scale-110 hover:z-20 transition-all duration-300 flex-shrink-0 flex items-center justify-center bg-white/[0.02] bg-gradient-to-br to-transparent ${card.tone}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={s.icon}
          >
            {ICONS[card.icon]}
          </svg>
        </div>
      ))}
    </div>
  );
}
