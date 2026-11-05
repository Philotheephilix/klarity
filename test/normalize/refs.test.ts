import { describe, it, expect } from 'vitest';
import { inlineRefs } from '../../src/normalize/refs.js';

describe('inlineRefs', () => {
  it('inlines a $.display.definitions.X reference into the field', () => {
    const doc = {
      display: {
        definitions: {
          minReceiveAmount: { label: 'Minimum to Receive', format: 'tokenAmount' },
        },
        formats: {
          'swap(uint256)': {
            fields: [
              { path: 'minReturn', $ref: '$.display.definitions.minReceiveAmount' },
            ],
          },
        },
      },
    };
    const out = inlineRefs(doc) as typeof doc;
    const field = out.display.formats['swap(uint256)'].fields[0] as Record<string, unknown>;
    expect(field.label).toBe('Minimum to Receive');
    expect(field.format).toBe('tokenAmount');
    expect(field.path).toBe('minReturn');
    expect('$ref' in field).toBe(false);
  });

  it('field keys win over definition keys on conflict (visible)', () => {
    const doc = {
      display: {
        definitions: {
          amt: { label: 'Def Label', format: 'raw', visible: 'never' },
        },
        formats: {
          'f(uint256)': {
            fields: [
              { path: 'x', $ref: '$.display.definitions.amt', visible: 'always' },
            ],
          },
        },
      },
    };
    const out = inlineRefs(doc) as typeof doc;
    const field = out.display.formats['f(uint256)'].fields[0] as Record<string, unknown>;
    expect(field.visible).toBe('always'); // field wins
    expect(field.label).toBe('Def Label'); // from definition
    expect(field.format).toBe('raw');
  });

  it('accepts the #/display/definitions/X pointer form', () => {
    const doc = {
      display: {
        definitions: { d: { label: 'L' } },
        formats: { 'f()': { fields: [{ path: 'p', $ref: '#/display/definitions/d' }] } },
      },
    };
    const out = inlineRefs(doc) as typeof doc;
    const field = out.display.formats['f()'].fields[0] as Record<string, unknown>;
    expect(field.label).toBe('L');
    expect('$ref' in field).toBe(false);
  });

  it('leaves non-$ref objects untouched and removes no other data', () => {
    const doc = {
      display: {
        definitions: { d: { label: 'L' } },
        formats: {
          'f()': { fields: [{ path: 'keep', label: 'Keep', visible: 'always' }] },
        },
      },
    };
    const out = inlineRefs(doc) as typeof doc;
    expect(out.display.formats['f()'].fields[0]).toEqual({
      path: 'keep',
      label: 'Keep',
      visible: 'always',
    });
  });

  it('no $ref string remains anywhere after inlining (real OKX fixture)', () => {
    // sanity against the real nested shape is covered in normalize.test.ts;
    // here we confirm nested arrays recurse.
    const doc = {
      display: {
        definitions: { d: { format: 'tokenAmount' } },
        formats: {
          'f()': {
            fields: [
              { path: 'a', $ref: '$.display.definitions.d' },
              { path: 'b', label: 'plain' },
            ],
          },
        },
      },
    };
    const out = inlineRefs(doc);
    expect(JSON.stringify(out)).not.toContain('$ref');
  });
});
