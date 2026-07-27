import { useTranslation } from 'react-i18next';

/**
 * Breadcrumb - hierarchical page trail following the ARIA breadcrumb pattern.
 * @param {{label: string, path?: string|null}[]} items - trail from root to current page.
 *   The last item is treated as the current page (rendered as text, not a link).
 */
export function Breadcrumb({ items = [] }) {
  const { t } = useTranslation();
  if (!items.length) return null;

  return (
    <nav aria-label={t('breadcrumb.ariaLabel')} className="breadcrumb">
      <ol className="breadcrumb__list">
        {items.map((item, i) => {
          const isCurrent = i === items.length - 1;
          return (
            <li key={item.path || item.label} className="breadcrumb__item">
              {isCurrent || !item.path ? (
                <span aria-current={isCurrent ? 'page' : undefined}>{item.label}</span>
              ) : (
                <a href={item.path}>{item.label}</a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
