export function Skeleton({ width = '100%', height = '1em', className = '' }) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
