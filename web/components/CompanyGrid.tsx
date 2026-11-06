import { RichCard } from './RichCard';
import type { SeedEntity } from '../lib/entities';

export function CompanyGrid({
  entities,
  onSelect,
}: {
  entities: SeedEntity[];
  onSelect: (entityName: string) => void;
}) {
  return (
    <div className="card-grid">
      {entities.map((entity) => (
        <RichCard
          key={entity.entityName}
          thumbKey={entity.entityName}
          thumbName={entity.displayName}
          status="registry"
          statusTone="pick"
          bookmarkId={`company:${entity.entityName}`}
          title={entity.displayName}
          subtitle={entity.entityName}
          meta={[
            { label: 'org', value: entity.entityName },
            { label: 'standard', value: 'ERC-7730' },
          ]}
          footerName={entity.displayName}
          footerSource={`registry/${entity.entityName}`}
          onOpen={() => onSelect(entity.entityName)}
        />
      ))}
    </div>
  );
}
