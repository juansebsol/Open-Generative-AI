// Openstudio mark. Fills with the current text colour so it works on the
// cyan tile in the nav, on dark surfaces and in the favicon.
export default function Logo({ size = 16, className = '', ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M12 12H36V22H22V36H12V12Z" />
      <path d="M88 12V36H78V22H64V12H88Z" />
      <path d="M88 88H64V78H78V64H88V88Z" />
      <path d="M12 88V64H22V78H36V88H12Z" />
      <path d="M50 24L57 43L76 50L57 57L50 76L43 57L24 50L43 43L50 24Z" />
    </svg>
  );
}
