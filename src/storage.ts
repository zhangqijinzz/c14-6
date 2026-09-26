import { repairHistories } from './history';
import type { FinanceScenario, PersistedWorkspace, PersistedWorkspaceV1 } from './types';

const STORAGE_KEY = 'money-scenario.workspace.v1';
const DB_NAME = 'money-scenario-db';

function isScenario(value: unknown): value is FinanceScenario {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FinanceScenario>;
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.color === 'string'
    && ['principal', 'recurring', 'years', 'annualRate', 'inflationRate', 'feeRate'].every(
      (key) => typeof candidate[key as keyof FinanceScenario] === 'number',
    );
}

function isV1(value: unknown): value is PersistedWorkspaceV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedWorkspaceV1>;
  return candidate.version === 1 && Array.isArray(candidate.scenarios) && candidate.scenarios.every(isScenario)
    && typeof candidate.selectedId === 'string';
}

function isV2(value: unknown): value is PersistedWorkspace {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedWorkspace>;
  return candidate.version === 2 && Array.isArray(candidate.scenarios) && candidate.scenarios.every(isScenario)
    && typeof candidate.selectedId === 'string'
    && (candidate.histories === undefined || typeof candidate.histories === 'object');
}

/**
 * 老数据（v1）第一次载入时没有流水：原样保留参数，
 * 为每个情景补一条起始记录，此后即可正常记录与回放。
 */
export function migrateWorkspace(value: unknown, now: number = Date.now()): PersistedWorkspace | null {
  if (isV2(value)) {
    return { ...value, histories: repairHistories(value.histories, value.scenarios, now) };
  }
  if (isV1(value)) {
    return {
      version: 2,
      scenarios: value.scenarios,
      selectedId: value.selectedId,
      histories: repairHistories(undefined, value.scenarios, now),
    };
  }
  return null;
}

export async function readLocalWorkspace(): Promise<PersistedWorkspace | null> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateWorkspace(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeLocalWorkspace(workspace: PersistedWorkspace): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

export async function readIndexedWorkspace(): Promise<PersistedWorkspace | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspace');
      request.onsuccess = () => {
        const transaction = request.result.transaction('workspace', 'readonly');
        const getRequest = transaction.objectStore('workspace').get('active');
        getRequest.onsuccess = () => resolve(migrateWorkspace(getRequest.result));
        getRequest.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writeIndexedWorkspace(workspace: PersistedWorkspace): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspace');
      request.onsuccess = () => {
        const transaction = request.result.transaction('workspace', 'readwrite');
        transaction.objectStore('workspace').put(workspace, 'active');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}
