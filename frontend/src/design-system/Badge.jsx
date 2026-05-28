const VARIANT_STYLES = {
  default: 'badge-default',
  success: 'badge-success',
  danger: 'badge-danger',
  warning: 'badge-warning',
  info: 'badge-info',
};

/**
 * Badge — compact status/label indicator.
 *
 * @param {'default'|'success'|'danger'|'warning'|'info'} variant
 */
export function Badge({ variant = 'default', children, className = '', ...props }) {
  const cls = ['badge', VARIANT_STYLES[variant] ?? VARIANT_STYLES.default, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} {...props}>
      {children}
    </span>
  );
}
