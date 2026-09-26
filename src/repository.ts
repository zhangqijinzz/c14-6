import { readIndexedHistory, readIndexedWorkspace, readLocalHistory, readLocalWorkspace, writeIndexedHistory, writeIndexedWorkspace, writeLocalHistory, writeLocalWorkspace } from './storage';
import type { PersistedHistory, PersistedWorkspace } from './types';

export interface ScenarioRepository {
  load(): Promise<PersistedWorkspace | null>;
  save(workspace: PersistedWorkspace): Promise<void>;
  loadHistory(): Promise<PersistedHistory | null>;
  saveHistory(history: PersistedHistory): Promise<void>;
}

export class LocalScenarioRepository implements ScenarioRepository {
  async load(): Promise<PersistedWorkspace | null> {
    return (await readIndexedWorkspace()) ?? (await readLocalWorkspace());
  }

  async save(workspace: PersistedWorkspace): Promise<void> {
    let indexedSaved = false;
    try {
      await writeIndexedWorkspace(workspace);
      indexedSaved = true;
    } catch {
      // localStorage below is the recoverable fallback when IndexedDB is unavailable.
    }
    try {
      await writeLocalWorkspace(workspace);
    } catch (error) {
      if (!indexedSaved) throw error;
    }
  }

  async loadHistory(): Promise<PersistedHistory | null> {
    return (await readIndexedHistory()) ?? (await readLocalHistory());
  }

  async saveHistory(history: PersistedHistory): Promise<void> {
    let indexedSaved = false;
    try {
      await writeIndexedHistory(history);
      indexedSaved = true;
    } catch {
      // localStorage below is the recoverable fallback when IndexedDB is unavailable.
    }
    try {
      await writeLocalHistory(history);
    } catch (error) {
      if (!indexedSaved) throw error;
    }
  }
}
