import { Card } from './Card';
import { ClearSignPanel } from './ClearSignPanel';
import { RawPanel } from './RawPanel';
import { rawPanelVM, toClearSignVM } from '../lib/viewmodel';
import type { DecodeResponse, DescriptorRow } from '../lib/types';

export function ExampleView({
  row,
  decode,
}: {
  row: DescriptorRow;
  decode: DecodeResponse;
}) {
  const raw = rawPanelVM(row, {
    calldata: decode.raw.calldata,
    typedData: decode.raw.typedData,
  });
  const clear = toClearSignVM(decode);

  return (
    <Card>
      <div className="example-frame">
        <div className="example-panels">
          <RawPanel vm={raw} />
          <ClearSignPanel vm={clear} />
        </div>
      </div>
    </Card>
  );
}
