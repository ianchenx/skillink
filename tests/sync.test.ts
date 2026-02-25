import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
} from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { syncSkills, cleanSkills, getStatus } from '../src/sync.ts';

function createTempProject() {
  const root = mkdtempSync(join(tmpdir(), 'skillink-test-'));
  return root;
}

function setupSkills(root: string, skills: string[]) {
  const skillsDir = join(root, '.agents', 'skills');
  mkdirSync(skillsDir, { recursive: true });
  for (const skill of skills) {
    const skillDir = join(skillsDir, skill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: Test skill\n---\n# ${skill}\n`,
    );
  }
  return skillsDir;
}

describe('syncSkills', () => {
  let root: string;

  beforeEach(() => {
    root = createTempProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should create symlinks for non-universal agents', () => {
    setupSkills(root, ['skill-a', 'skill-b']);

    const result = syncSkills(root, {
      agents: {
        'claude-code': { skillsDir: '.claude/skills' },
      },
    });

    expect(result.created).toHaveLength(2);
    expect(result.failed).toHaveLength(0);

    // Verify symlinks exist
    const linkA = join(root, '.claude', 'skills', 'skill-a');
    const linkB = join(root, '.claude', 'skills', 'skill-b');
    expect(existsSync(linkA)).toBe(true);
    expect(existsSync(linkB)).toBe(true);
    expect(lstatSync(linkA).isSymbolicLink()).toBe(true);
    expect(lstatSync(linkB).isSymbolicLink()).toBe(true);

    // Verify symlinks are relative
    const target = readlinkSync(linkA);
    expect(target).not.toMatch(/^\//); // not absolute
  });

  it('should be idempotent (skip existing correct symlinks)', () => {
    setupSkills(root, ['skill-a']);

    const result1 = syncSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });
    expect(result1.created).toHaveLength(1);

    const result2 = syncSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });
    expect(result2.created).toHaveLength(0);
    expect(result2.skipped).toHaveLength(1);
    expect(result2.skipped[0].reason).toContain('already linked');
  });

  it('should skip real directories (hybrid strategy)', () => {
    setupSkills(root, ['skill-a']);

    // Pre-create a real directory at the target
    const realDir = join(root, '.claude', 'skills', 'skill-a');
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'SKILL.md'), 'custom content');

    const result = syncSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('real directory');

    // Verify the real directory is untouched
    expect(lstatSync(realDir).isSymbolicLink()).toBe(false);
  });

  it('should recreate wrong symlinks', () => {
    setupSkills(root, ['skill-a']);

    // Create a symlink pointing to wrong target
    const targetDir = join(root, '.claude', 'skills');
    mkdirSync(targetDir, { recursive: true });
    const wrongTarget = join(root, 'wrong');
    mkdirSync(wrongTarget, { recursive: true });
    symlinkSync(wrongTarget, join(targetDir, 'skill-a'));

    const result = syncSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    expect(result.created).toHaveLength(1);
    // Verify new symlink points to correct source
    const link = readlinkSync(join(targetDir, 'skill-a'));
    const expected = relative(targetDir, join(root, '.agents', 'skills', 'skill-a'));
    expect(link).toBe(expected);
  });

  it('should support multiple agents', () => {
    setupSkills(root, ['skill-a']);

    const result = syncSkills(root, {
      agents: {
        'claude-code': { skillsDir: '.claude/skills' },
        antigravity: { skillsDir: '.agent/skills' },
      },
    });

    expect(result.created).toHaveLength(2);
    expect(existsSync(join(root, '.claude', 'skills', 'skill-a'))).toBe(true);
    expect(existsSync(join(root, '.agent', 'skills', 'skill-a'))).toBe(true);
  });

  it('should filter by agent', () => {
    setupSkills(root, ['skill-a']);

    const result = syncSkills(root, {
      agents: {
        'claude-code': { skillsDir: '.claude/skills' },
        antigravity: { skillsDir: '.agent/skills' },
      },
      filterAgents: ['claude-code'],
    });

    expect(result.created).toHaveLength(1);
    expect(existsSync(join(root, '.claude', 'skills', 'skill-a'))).toBe(true);
    expect(existsSync(join(root, '.agent', 'skills', 'skill-a'))).toBe(false);
  });

  it('should support dry-run', () => {
    setupSkills(root, ['skill-a']);

    const result = syncSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
      dryRun: true,
    });

    expect(result.created).toHaveLength(1);
    // But no actual symlink should exist
    expect(existsSync(join(root, '.claude', 'skills', 'skill-a'))).toBe(false);
  });

  it('should handle empty skills directory', () => {
    mkdirSync(join(root, '.agents', 'skills'), { recursive: true });

    const result = syncSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('should error when .agents/skills does not exist', () => {
    expect(() =>
      syncSkills(root, {
        agents: { 'claude-code': { skillsDir: '.claude/skills' } },
      }),
    ).toThrow('.agents/skills');
  });
});

describe('cleanSkills', () => {
  let root: string;

  beforeEach(() => {
    root = createTempProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should remove symlinks pointing to .agents/skills', () => {
    setupSkills(root, ['skill-a', 'skill-b']);

    // First sync
    syncSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    // Then clean
    const result = cleanSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    expect(result.created).toHaveLength(2); // "created" here means "removed"
    expect(existsSync(join(root, '.claude', 'skills', 'skill-a'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'skills', 'skill-b'))).toBe(false);
  });

  it('should preserve real directories', () => {
    const realDir = join(root, '.claude', 'skills', 'my-real-skill');
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'SKILL.md'), 'content');

    const result = cleanSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('not a symlink');
    expect(existsSync(realDir)).toBe(true);
  });

  it('should support dry-run', () => {
    setupSkills(root, ['skill-a']);
    syncSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    const result = cleanSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
      dryRun: true,
    });

    expect(result.created).toHaveLength(1);
    // Symlink should still exist
    expect(existsSync(join(root, '.claude', 'skills', 'skill-a'))).toBe(true);
  });
});

describe('getStatus', () => {
  let root: string;

  beforeEach(() => {
    root = createTempProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should report linked and unlinked skills per agent', () => {
    setupSkills(root, ['skill-a', 'skill-b']);
    syncSkills(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    const status = getStatus(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    expect(status).toHaveLength(1);
    expect(status[0].agent).toBe('claude-code');
    expect(status[0].linked).toHaveLength(2);
    expect(status[0].unlinked).toHaveLength(0);
  });

  it('should show unlinked skills', () => {
    setupSkills(root, ['skill-a', 'skill-b']);

    const status = getStatus(root, {
      agents: { 'claude-code': { skillsDir: '.claude/skills' } },
    });

    expect(status[0].linked).toHaveLength(0);
    expect(status[0].unlinked).toHaveLength(2);
  });
});
