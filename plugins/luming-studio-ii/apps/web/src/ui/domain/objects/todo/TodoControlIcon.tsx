const paths = {
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  expand:
    'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3m-5 13h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3',
  link: 'M9 17H7a5 5 0 0 1 0-10h2m6 0h2a5 5 0 0 1 0 10h-2m-7-5h8',
  remove:
    'M3 6h18m-2 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m4 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-5 4v7m4-7v7',
  add: 'M12 5v14M5 12h14',
};

export function TodoControlIcon({
  icon,
  size = 16,
}: {
  readonly icon: keyof typeof paths;
  readonly size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[icon]} />
    </svg>
  );
}
