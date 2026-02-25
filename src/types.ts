export interface AgentConfig {
  name: string;
  displayName: string;
  /** Project-level skills directory (relative to project root) */
  skillsDir: string;
}

export interface SyncResult {
  created: SyncEntry[];
  skipped: SyncEntry[];
  failed: SyncEntry[];
}

export interface SyncEntry {
  skill: string;
  agent: string;
  source: string;
  target: string;
  reason?: string;
}
