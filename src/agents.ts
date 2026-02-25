import type { AgentConfig } from './types.ts';

/**
 * Agent registry — project-level only.
 *
 * Source: .agents/skills/ (canonical)
 * Targets: each agent's own skill directory (need symlinks).
 */
export const agents: Record<string, AgentConfig> = {
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.opencode/skills',
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
  },
};

/** All agents are targets — they all need symlinks from .agents/skills/ */
export function getTargetAgents(): string[] {
  return Object.keys(agents);
}
