import './agent-activity.css';

export function AgentWorkingMark() {
  return (
    <svg
      className="studio-agent-working-mark"
      width="14"
      height="14"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <g fill="currentColor">
        <circle cx="10" cy="3" r="2.2" />
        <circle cx="17" cy="10" r="2.2" />
        <circle cx="10" cy="17" r="2.2" />
        <circle cx="3" cy="10" r="2.2" />
        <path d="m10 6 4 4-4 4-4-4z" />
      </g>
    </svg>
  );
}
