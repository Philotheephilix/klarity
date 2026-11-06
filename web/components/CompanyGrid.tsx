import { Card } from './Card';
import { MonoLabel } from './CodeBlock';
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
        <Card key={entity.entityName} onClick={() => onSelect(entity.entityName)}>
          <div className="card-pad">
            <div className="card-title">{entity.displayName}</div>
            <MonoLabel>{entity.entityName}</MonoLabel>
          </div>
        </Card>
      ))}
    </div>
  );
}
