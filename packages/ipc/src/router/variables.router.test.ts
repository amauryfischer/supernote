import { describe, it, expect } from 'vitest';
import { variablesRouter } from './variables.router.js';

describe('variablesRouter', () => {
  it('exposes the expected procedures', () => {
    const procs = Object.keys((variablesRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(['create', 'delete', 'evaluate', 'get', 'list', 'update']);
  });
});
