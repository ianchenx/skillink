import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from 'fs';
import { join, relative } from 'path';
import type { SyncResult, SyncEntry } from './types.ts';

const CANONICAL_SOURCE = '.agents/skills';

interface AgentTarget {
  skillsDir: string;
}

export interface SyncOptions {
  agents: Record<string, AgentTarget>;
  filterAgents?: string[];
  dryRun?: boolean;
}

export interface StatusEntry {
  agent: string;
  skillsDir: string;
  linked: string[];
  unlinked: string[];
  wrong: string[];
}

/** Discover all skill directories under .agents/skills/ */
function discoverSkills(root: string): string[] {
  const skillsDir = join(root, CANONICAL_SOURCE);
  if (!existsSync(skillsDir)) {
    throw new Error(`${CANONICAL_SOURCE} does not exist in ${root}`);
  }

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/**
 * Sync skills from .agents/skills/ to target agents via symlinks.
 *
 * For each non-universal agent, creates:
 *   <agent.skillsDir>/<skill-name> → relative symlink to .agents/skills/<skill-name>
 */
export function syncSkills(root: string, options: SyncOptions): SyncResult {
  const skills = discoverSkills(root);
  const result: SyncResult = { created: [], skipped: [], failed: [] };

  const targetAgents = options.filterAgents
    ? Object.entries(options.agents).filter(([name]) =>
        options.filterAgents!.includes(name),
      )
    : Object.entries(options.agents);

  for (const [agentName, agentConfig] of targetAgents) {
    const agentSkillsDir = join(root, agentConfig.skillsDir);

    for (const skill of skills) {
      const source = join(root, CANONICAL_SOURCE, skill);
      const target = join(agentSkillsDir, skill);
      const entry: SyncEntry = { skill, agent: agentName, source, target };

      // Check if target already exists
      if (existsSync(target) || isSymlink(target)) {
        if (isSymlink(target)) {
          const currentTarget = readlinkSync(target);
          const expectedTarget = relative(agentSkillsDir, source);

          if (currentTarget === expectedTarget) {
            // Correct symlink already exists
            result.skipped.push({ ...entry, reason: 'already linked' });
            continue;
          }

          // Wrong symlink — remove and recreate
          if (!options.dryRun) {
            unlinkSync(target);
          }
        } else {
          // Real directory — don't touch it (hybrid strategy)
          result.skipped.push({
            ...entry,
            reason: 'real directory exists, skipping',
          });
          continue;
        }
      }

      // Create the symlink
      const relativeSource = relative(agentSkillsDir, source);

      if (!options.dryRun) {
        mkdirSync(agentSkillsDir, { recursive: true });
        symlinkSync(relativeSource, target, 'dir');
      }

      result.created.push(entry);
    }
  }

  return result;
}

/**
 * Clean symlinks created by skillink.
 * Only removes symlinks that point back to .agents/skills/.
 */
export function cleanSkills(root: string, options: SyncOptions): SyncResult {
  const result: SyncResult = { created: [], skipped: [], failed: [] };

  const targetAgents = options.filterAgents
    ? Object.entries(options.agents).filter(([name]) =>
        options.filterAgents!.includes(name),
      )
    : Object.entries(options.agents);

  for (const [agentName, agentConfig] of targetAgents) {
    const agentSkillsDir = join(root, agentConfig.skillsDir);

    if (!existsSync(agentSkillsDir)) {
      continue;
    }

    const entries = readdirSync(agentSkillsDir, { withFileTypes: true });

    for (const entry of entries) {
      const target = join(agentSkillsDir, entry.name);
      const syncEntry: SyncEntry = {
        skill: entry.name,
        agent: agentName,
        source: join(root, CANONICAL_SOURCE, entry.name),
        target,
      };

      if (!isSymlink(target)) {
        result.skipped.push({ ...syncEntry, reason: 'not a symlink, preserving' });
        continue;
      }

      // Only remove symlinks that point to our canonical source
      const linkTarget = readlinkSync(target);
      const resolvedTarget = join(agentSkillsDir, linkTarget);
      const canonicalDir = join(root, CANONICAL_SOURCE);

      if (!resolvedTarget.startsWith(canonicalDir)) {
        result.skipped.push({
          ...syncEntry,
          reason: 'symlink points elsewhere, preserving',
        });
        continue;
      }

      if (!options.dryRun) {
        unlinkSync(target);
      }

      result.created.push(syncEntry); // "created" = "removed" in clean context
    }
  }

  return result;
}

/**
 * Get distribution status for each agent.
 */
export function getStatus(root: string, options: SyncOptions): StatusEntry[] {
  const skills = discoverSkills(root);
  const statuses: StatusEntry[] = [];

  const targetAgents = options.filterAgents
    ? Object.entries(options.agents).filter(([name]) =>
        options.filterAgents!.includes(name),
      )
    : Object.entries(options.agents);

  for (const [agentName, agentConfig] of targetAgents) {
    const agentSkillsDir = join(root, agentConfig.skillsDir);
    const linked: string[] = [];
    const unlinked: string[] = [];
    const wrong: string[] = [];

    for (const skill of skills) {
      const target = join(agentSkillsDir, skill);
      const expectedTarget = relative(
        agentSkillsDir,
        join(root, CANONICAL_SOURCE, skill),
      );

      if (isSymlink(target)) {
        const actual = readlinkSync(target);
        if (actual === expectedTarget) {
          linked.push(skill);
        } else {
          wrong.push(skill);
        }
      } else if (existsSync(target)) {
        // Real directory — treat as "linked" (has content)
        linked.push(skill);
      } else {
        unlinked.push(skill);
      }
    }

    statuses.push({
      agent: agentName,
      skillsDir: agentConfig.skillsDir,
      linked,
      unlinked,
      wrong,
    });
  }

  return statuses;
}

/** Check if a path is a symlink (without following it) */
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
