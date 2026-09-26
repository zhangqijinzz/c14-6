import { describe, expect, it } from 'vitest';
import { SAMPLE_SCENARIOS } from '../domain';
import { migrateWorkspace } from '../storage';
import type { PersistedWorkspaceV1 } from '../types';

describe('workspace migration', () => {
  it('starts auditing legacy v1 data the first time it loads', () => {
    const v1: PersistedWorkspaceV1 = { version: 1, scenarios: SAMPLE_SCENARIOS, selectedId: 'steady' };
    const migrated = migrateWorkspace(v1, 5000);
    expect(migrated?.version).toBe(2);
    expect(Object.keys(migrated?.histories ?? {})).toEqual(['steady', 'balanced', 'growth']);
    expect(migrated?.histories.steady.entries[0]).toMatchObject({ seq: 1, kind: 'init', at: 5000 });
    // 参数原样保留，只是补上了流水。
    expect(migrated?.scenarios).toEqual(SAMPLE_SCENARIOS);
  });

  it('repairs v2 workspaces that are missing histories for some scenarios', () => {
    const v2 = { version: 2 as const, scenarios: SAMPLE_SCENARIOS, selectedId: 'balanced', histories: { steady: { dropped: 0, entries: [] } } };
    const migrated = migrateWorkspace(v2, 6000);
    expect(migrated?.histories.steady.entries).toHaveLength(1);
    expect(migrated?.histories.balanced.entries[0].at).toBe(6000);
  });

  it('rejects unrecognized payloads', () => {
    expect(migrateWorkspace(null)).toBeNull();
    expect(migrateWorkspace({ version: 9, scenarios: [] })).toBeNull();
    expect(migrateWorkspace({ version: 1, scenarios: 'not-array', selectedId: 'x' })).toBeNull();
  });
});
