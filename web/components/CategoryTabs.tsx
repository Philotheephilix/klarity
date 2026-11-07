export interface CategoryTab {
  id: string;
  label: string;
  count: number;
}

/**
 * Horizontal category tabs with a count badge each, one active. Composed from
 * the bencho pill-chip primitive (.bench-chip + data-on) so the active tab uses
 * the same highlight language as the rest of the explorer.
 */
export function CategoryTabs({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: CategoryTab[];
  activeId: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="bench-chips category-tabs" role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="bench-chip category-tab"
            data-on={active ? 'true' : 'false'}
            aria-selected={active}
            onClick={onSelect ? () => onSelect(tab.id) : undefined}
          >
            <span className="category-tab-label">{tab.label}</span>
            <span className="category-tab-count">{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}
