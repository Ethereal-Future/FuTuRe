/**
 * Card — surface container with optional header and footer slots.
 *
 * @param {React.ReactNode} header  Optional header content
 * @param {React.ReactNode} footer  Optional footer content
 * @param {'sm'|'md'|'lg'} padding
 */
export function Card({ header, footer, padding = 'md', children, className = '', ...props }) {
  return (
    <div className={['card', `card-p-${padding}`, className].filter(Boolean).join(' ')} {...props}>
      {header && <div className="card-header">{header}</div>}
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}
