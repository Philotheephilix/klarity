'use client';

import { monogram, thumbStyle } from '../lib/cardmeta';
import { TagChip } from './Chip';
import type { SeedEntity } from '../lib/entities';

/**
 * Companies as a shadcn-style vertical list: one thin-bordered row per entity,
 * a small generated monogram, the display name + org sub-text, and a trailing
 * meta cluster. Each row stays an <article> (the browse test clicks
 * `.closest('article')`) and is keyboard-activatable.
 */
export function CompanyGrid({
  entities,
  onSelect,
}: {
  entities: SeedEntity[];
  onSelect: (entityName: string) => void;
}) {
  return (
    <div className="company-list">
      {entities.map((entity) => (
        <article
          key={entity.entityName}
          className="company-row"
          role="button"
          tabIndex={0}
          onClick={() => onSelect(entity.entityName)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(entity.entityName);
            }
          }}
        >
          <span
            className="company-row-thumb"
            style={thumbStyle(entity.entityName)}
            aria-hidden="true"
          >
            {monogram(entity.displayName)}
          </span>
          <span className="company-row-text">
            <span className="company-row-title">{entity.displayName}</span>
            <span className="company-row-sub">{entity.entityName}</span>
          </span>
          <span className="company-row-meta">
            <TagChip>ERC-7730</TagChip>
            <span className="company-row-status">registry</span>
          </span>
          <span className="company-row-chevron" aria-hidden="true">
            &rsaquo;
          </span>
        </article>
      ))}
    </div>
  );
}
