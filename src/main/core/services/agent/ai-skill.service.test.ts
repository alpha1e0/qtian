/**
 * AiSkillService 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { AiSkillService } from '@/core/services/agent/ai-skill.service';
import {
  getTestAssistantSkillDir,
  createTestAssistantSkill,
  setupTestAssistantEnvironment,
  finalAssistantCleanup,
  initAssistantTestState,
  markAssistantTestFailed,
} from '#testing/scripts/ai-assistant-test-helper';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

const TEST_FILE = 'test_ai-skill.service';

const SAMPLE_SKILL_MD = `---
name: "中英翻译"
description: "中英文互翻译助手，支持专业术语"
version: "1.0.0"
---
## 指令

你是专业的中英翻译助手，请根据用户输入进行准确翻译。
`;

const SAMPLE_SKILL_2_MD = `---
name: "代码审查"
description: "审查代码质量和安全性"
version: "2.1.0"
---
## 审查规则

1. 检查代码风格
2. 检查安全漏洞
3. 检查性能问题
`;

const NO_FRONTMATTER_SKILL_MD = `## 指令\n\n简单指令，没有 front-matter。`;

describe('AiSkillService', () => {
  let service: AiSkillService;
  let skillDir: string;

  beforeEach(async () => {
    skillDir = getTestAssistantSkillDir(TEST_FILE);
    // 每个测试前清理目录，确保隔离
    await fs.rm(skillDir, { recursive: true, force: true });
    await setupTestAssistantEnvironment(skillDir);
    service = new AiSkillService();
    // 覆盖内部路径为测试路径
    (service as any).skillDir = skillDir;
    initAssistantTestState(TEST_FILE);
  });

  afterEach(async () => {
    await finalAssistantCleanup(TEST_FILE);
  });

  describe('listSkills', () => {
    it('should list skills from directories with SKILL.md', async () => {
      await createTestAssistantSkill(skillDir, 'translator', SAMPLE_SKILL_MD);
      await createTestAssistantSkill(skillDir, 'code-review', SAMPLE_SKILL_2_MD);

      const skills = await service.listSkills();
      expect(skills).toHaveLength(2);
      expect(skills.map((s) => s.name)).toContain('中英翻译');
      expect(skills.map((s) => s.name)).toContain('代码审查');
    });

    it('should skip directories without SKILL.md', async () => {
      const noMdDir = skillDir + '/no-skill-md';
      const { mkdir, writeFile } = await import('fs/promises');
      await mkdir(noMdDir, { recursive: true });
      await writeFile(noMdDir + '/readme.txt', 'not a skill');

      await createTestAssistantSkill(skillDir, 'translator', SAMPLE_SKILL_MD);
      const skills = await service.listSkills();
      expect(skills).toHaveLength(1);
    });

    it('should return empty array when no skills', async () => {
      const skills = await service.listSkills();
      expect(skills).toEqual([]);
    });
  });

  describe('getSkill', () => {
    it('should return full skill data', async () => {
      await createTestAssistantSkill(skillDir, 'translator', SAMPLE_SKILL_MD, {
        hasScripts: true,
        hasTemplates: false,
      });

      const skill = await service.getSkill('translator');
      expect(skill.name).toBe('中英翻译');
      expect(skill.description).toBe('中英文互翻译助手，支持专业术语');
      expect(skill.version).toBe('1.0.0');
      expect(skill.dir_name).toBe('translator');
      expect(skill.instructions).toContain('翻译助手');
      expect(skill.has_scripts).toBe(true);
      expect(skill.has_templates).toBe(false);
    });

    it('should throw for non-existent skill', async () => {
      await expect(service.getSkill('ghost')).rejects.toThrow();
    });

    it('should detect scripts and templates directories', async () => {
      await createTestAssistantSkill(skillDir, 'full', SAMPLE_SKILL_MD, {
        hasScripts: true,
        hasTemplates: true,
      });

      const skill = await service.getSkill('full');
      expect(skill.has_scripts).toBe(true);
      expect(skill.has_templates).toBe(true);
    });
  });

  describe('skillExists', () => {
    it('should return true for existing skill', async () => {
      await createTestAssistantSkill(skillDir, 'translator', SAMPLE_SKILL_MD);
      expect(await service.skillExists('translator')).toBe(true);
    });

    it('should return false for non-existent skill', async () => {
      expect(await service.skillExists('ghost')).toBe(false);
    });
  });

  describe('parseSkillMd', () => {
    it('should parse YAML front-matter and instructions', () => {
      const { meta, instructions } = service.parseSkillMd(SAMPLE_SKILL_MD);
      expect(meta.name).toBe('中英翻译');
      expect(meta.description).toBe('中英文互翻译助手，支持专业术语');
      expect(meta.version).toBe('1.0.0');
      expect(instructions).toContain('翻译助手');
    });

    it('should handle missing front-matter gracefully', () => {
      const { meta, instructions } = service.parseSkillMd(NO_FRONTMATTER_SKILL_MD);
      expect(meta.name).toBe('Unknown');
      expect(meta.description).toBe('');
      expect(meta.version).toBe('0.0.0');
      expect(instructions).toContain('简单指令');
    });

    it('should handle partial front-matter', () => {
      const partial = `---\nname: "Test"\n---\nSome content`;
      const { meta } = service.parseSkillMd(partial);
      expect(meta.name).toBe('Test');
      expect(meta.version).toBe('0.0.0');
    });

    it('should handle single-quoted YAML values', () => {
      const single = `---\nname: '单引号值'\nversion: '3.0'\n---\nContent`;
      const { meta } = service.parseSkillMd(single);
      expect(meta.name).toBe('单引号值');
      expect(meta.version).toBe('3.0');
    });

    it('should handle unquoted YAML values', () => {
      const unquoted = `---\nname: plain_name\nversion: 1.2.3\n---\nContent`;
      const { meta } = service.parseSkillMd(unquoted);
      expect(meta.name).toBe('plain_name');
      expect(meta.version).toBe('1.2.3');
    });
  });

  describe('validateSkillDirName', () => {
    it('should accept valid names', () => {
      expect(() => service.validateSkillDirName('translator')).not.toThrow();
      expect(() => service.validateSkillDirName('code-review')).not.toThrow();
      expect(() => service.validateSkillDirName('my_skill_01')).not.toThrow();
    });

    it('should reject empty names', () => {
      expect(() => service.validateSkillDirName('')).toThrow();
      expect(() => service.validateSkillDirName(null as any)).toThrow();
    });

    it('should reject path traversal attempts', () => {
      expect(() => service.validateSkillDirName('../etc')).toThrow();
      expect(() => service.validateSkillDirName('foo/bar')).toThrow();
      expect(() => service.validateSkillDirName('foo\\bar')).toThrow();
    });
  });
});
