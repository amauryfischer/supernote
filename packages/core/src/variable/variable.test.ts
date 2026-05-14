import { describe, it, expect } from 'vitest';
import { Variable, VariableInput, VariableType, VariableValue } from './index.js';

describe('Variable schemas', () => {
  it('accepts a literal number variable', () => {
    const parsed = Variable.parse({
      id: '01H0000000000000000000',
      name: 'tauxTVA',
      type: 'number',
      value: { kind: 'literal', value: 0.2 },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(parsed.value).toEqual({ kind: 'literal', value: 0.2 });
  });

  it('accepts a formula variable', () => {
    const parsed = Variable.parse({
      id: '01H0000000000000000001',
      name: 'totalTTC',
      type: 'number',
      value: { kind: 'formula', expression: '100 * (1 + $tauxTVA)' },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(parsed.value).toEqual({ kind: 'formula', expression: '100 * (1 + $tauxTVA)' });
  });

  it('rejects names with spaces or starting digits', () => {
    expect(() => VariableInput.parse({
      name: '1abc',
      type: 'number',
      value: { kind: 'literal', value: 1 },
    })).toThrow();
    expect(() => VariableInput.parse({
      name: 'taux TVA',
      type: 'number',
      value: { kind: 'literal', value: 1 },
    })).toThrow();
  });

  it('rejects formula without expression', () => {
    expect(() => VariableValue.parse({ kind: 'formula', expression: '' })).toThrow();
  });

  it('enumerates types', () => {
    expect(VariableType.options).toEqual(['number', 'string', 'boolean', 'date']);
  });
});
