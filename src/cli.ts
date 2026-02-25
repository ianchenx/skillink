#!/usr/bin/env node

import pc from 'picocolors';
import * as p from '@clack/prompts';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { agents, getTargetAgents } from './agents.ts';
import { syncSkills, cleanSkills, getStatus, type SyncOptions } from './sync.ts';

const CANONICAL_SOURCE = '.agents/skills';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
    );
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();

function showHelp(): void {
  console.log(`
${pc.bold('skillink')} — Symlink skills from .agents/skills/ to other agents (project-level)

${pc.bold('Usage:')} skillink <command> [options]

${pc.bold('Commands:')}
  sync              Symlink all skills to target agents
  clean             Remove symlinks created by skillink
  status            Show distribution status
  agents            List supported agents
  help              Show this help

${pc.bold('Options:')}
  --agent <names>   Specify agents (space-separated, skips prompt)
  --dry-run         Preview changes without applying
  -y, --yes         Skip prompts, sync all agents
  --version, -v     Show version

${pc.bold('Examples:')}
  ${pc.dim('$')} skillink sync                              ${pc.dim('# interactive: select agents')}
  ${pc.dim('$')} skillink sync --agent claude-code opencode  ${pc.dim('# non-interactive: specific agents')}
  ${pc.dim('$')} skillink sync -y                            ${pc.dim('# non-interactive: all agents')}
  ${pc.dim('$')} skillink status                             ${pc.dim('# check current state')}
  ${pc.dim('$')} skillink clean                              ${pc.dim('# remove all symlinks')}

${pc.dim('Source: .agents/skills/')}
`);
}

interface ParsedArgs {
  command: string;
  agents: string[];
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0] || 'help';
  const agentFilters: string[] = [];
  let dryRun = false;
  let yes = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--agent' || arg === '-a') {
      // Consume all following non-flag tokens as agent names
      while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        i++;
        agentFilters.push(args[i]);
      }
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '-y' || arg === '--yes') {
      yes = true;
    } else if (arg === '--version' || arg === '-v') {
      console.log(VERSION);
      process.exit(0);
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  return { command, agents: agentFilters, dryRun, yes };
}

/** Prompt user to select agents interactively */
async function promptAgents(): Promise<string[] | null> {
  const targets = getTargetAgents();

  const selected = await p.multiselect({
    message: 'Select agents to sync to',
    options: targets.map((name) => ({
      value: name,
      label: agents[name].displayName,
      hint: agents[name].skillsDir,
    })),
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Cancelled.');
    return null;
  }

  return selected as string[];
}

function buildSyncOptions(agentNames: string[], dryRun: boolean): SyncOptions {
  const targetAgents: Record<string, { skillsDir: string }> = {};

  for (const name of agentNames) {
    if (agents[name]) {
      targetAgents[name] = { skillsDir: agents[name].skillsDir };
    }
  }

  return {
    agents: targetAgents,
    dryRun,
  };
}

function printSyncResult(
  result: ReturnType<typeof syncSkills>,
  action: 'Linked' | 'Removed',
): void {
  if (result.created.length > 0) {
    for (const entry of result.created) {
      console.log(`  ${pc.green('✓')} ${entry.skill} ${pc.dim('→')} ${entry.agent}`);
    }
  }

  if (result.skipped.length > 0) {
    for (const entry of result.skipped) {
      console.log(`  ${pc.dim('○')} ${entry.skill} ${pc.dim(`(${entry.reason})`)}`);
    }
  }

  if (result.failed.length > 0) {
    for (const entry of result.failed) {
      console.log(
        `  ${pc.red('✗')} ${entry.skill} ${pc.red(entry.reason || 'failed')}`,
      );
    }
  }

  console.log();
  const parts: string[] = [];
  if (result.created.length > 0)
    parts.push(pc.green(`${result.created.length} ${action.toLowerCase()}`));
  if (result.skipped.length > 0)
    parts.push(pc.dim(`${result.skipped.length} skipped`));
  if (result.failed.length > 0) parts.push(pc.red(`${result.failed.length} failed`));
  if (parts.length > 0) console.log(`  ${parts.join(', ')}`);
}

/** Resolve which agents to operate on: explicit > yes (all) > interactive */
async function resolveAgents(args: ParsedArgs): Promise<string[] | null> {
  if (args.agents.length > 0) {
    return args.agents;
  }
  if (args.yes) {
    return getTargetAgents();
  }
  return promptAgents();
}

async function cmdSync(args: ParsedArgs): Promise<void> {
  const root = process.cwd();
  if (!existsSync(join(root, CANONICAL_SOURCE))) {
    p.log.error(`${pc.bold(CANONICAL_SOURCE + '/')} not found in current project.`);
    p.log.info('Create the directory and add your skills first, then re-run.');
    return;
  }

  const selected = await resolveAgents(args);
  if (!selected) return;

  const options = buildSyncOptions(selected, args.dryRun);

  if (args.dryRun) {
    console.log(pc.yellow('  Dry run — no changes will be made\n'));
  }

  const result = syncSkills(root, options);
  printSyncResult(result, 'Linked');
}

async function cmdClean(args: ParsedArgs): Promise<void> {
  const selected = await resolveAgents(args);
  if (!selected) return;

  const options = buildSyncOptions(selected, args.dryRun);
  const root = process.cwd();

  if (args.dryRun) {
    console.log(pc.yellow('  Dry run — no changes will be made\n'));
  }

  const result = cleanSkills(root, options);
  printSyncResult(result, 'Removed');
}

function cmdStatus(args: ParsedArgs): void {
  const agentNames = args.agents.length > 0 ? args.agents : getTargetAgents();
  const options = buildSyncOptions(agentNames, false);
  const root = process.cwd();

  if (!existsSync(join(root, CANONICAL_SOURCE))) {
    p.log.warn(`${pc.bold(CANONICAL_SOURCE + '/')} not found in current project.`);
    return;
  }

  const statuses = getStatus(root, options);

  console.log(`  ${pc.bold('Source:')} .agents/skills/`);
  console.log();

  for (const status of statuses) {
    const total =
      status.linked.length + status.unlinked.length + status.wrong.length;
    if (total === 0 && status.unlinked.length === 0) continue;

    const indicator =
      status.unlinked.length === 0
        ? pc.green('●')
        : status.linked.length > 0
          ? pc.yellow('◐')
          : pc.dim('○');

    console.log(
      `  ${indicator} ${pc.bold(status.agent)} ${pc.dim(`(${status.skillsDir})`)}`,
    );
    console.log(
      `    ${pc.green(`${status.linked.length} linked`)}${status.unlinked.length > 0 ? `, ${pc.yellow(`${status.unlinked.length} unlinked`)}` : ''}${status.wrong.length > 0 ? `, ${pc.red(`${status.wrong.length} wrong`)}` : ''}`,
    );
  }
}

function cmdAgents(): void {
  const targets = getTargetAgents();

  console.log(`  ${pc.bold('Source')}  .agents/skills/`);
  console.log();
  console.log(`  ${pc.bold('Targets')}`);
  for (const name of targets) {
    console.log(
      `    ${pc.dim('·')} ${agents[name].displayName} ${pc.dim(`→ ${agents[name].skillsDir}`)}`,
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.command === '--version' || args.command === '-v') {
    console.log(VERSION);
    return;
  }

  if (
    args.command === '--help' ||
    args.command === '-h' ||
    args.command === 'help'
  ) {
    showHelp();
    return;
  }

  console.log();

  switch (args.command) {
    case 'sync':
      await cmdSync(args);
      break;
    case 'clean':
    case 'rm':
    case 'remove':
      await cmdClean(args);
      break;
    case 'status':
    case 'st':
      cmdStatus(args);
      break;
    case 'agents':
      cmdAgents();
      break;
    default:
      console.log(pc.red(`  Unknown command: ${args.command}`));
      console.log(pc.dim('  Run "skillink help" for usage.'));
      process.exit(1);
  }

  console.log();
}

main().catch((e) => {
  console.error(pc.red(`Error: ${e instanceof Error ? e.message : e}`));
  process.exit(1);
});
