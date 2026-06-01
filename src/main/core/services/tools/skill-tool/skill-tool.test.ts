/**
 * SkillTool 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillTool, LoadSkillCallback } from '@/core/services/tools/skill-tool/skill-tool';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

/** 创建 mock 加载回调函数 */
function createMockLoadSkill(instructions: string): LoadSkillCallback {
  return vi.fn(async (_dirName: string) => ({ instructions }));
}

/** 创建抛出异常的 mock 回调 */
function createFailingLoadSkill(errorMsg: string): LoadSkillCallback {
  return vi.fn(async (_dirName: string) => {
    throw new Error(errorMsg);
  });
}

describe('SkillTool', () => {
  let tool: SkillTool;
  let mockLoadSkill: LoadSkillCallback;

  const SAMPLE_INSTRUCTIONS = '# Code Review Skill\n\nReview the code for quality and security.';

  beforeEach(() => {
    mockLoadSkill = createMockLoadSkill(SAMPLE_INSTRUCTIONS);
    tool = new SkillTool(mockLoadSkill);
  });

  // ==================== 属性测试 ====================

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('skill');
    });

    it('should have description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description).toContain('skill');
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toContain('skill');
      expect(tool.parameters.properties.skill.type).toBe('string');
      expect(tool.parameters.properties.args.type).toBe('string');
    });
  });

  // ==================== execute 参数校验 ====================

  describe('execute input validation', () => {
    it('should reject missing skill parameter', async () => {
      const result = await tool.execute({});
      expect(result).toContain('Error');
      expect(result).toContain('required');
    });

    it('should reject empty skill parameter', async () => {
      const result = await tool.execute({ skill: '' });
      expect(result).toContain('Error');
      expect(result).toContain('non-empty');
    });

    it('should reject whitespace-only skill parameter', async () => {
      const result = await tool.execute({ skill: '   ' });
      expect(result).toContain('Error');
      expect(result).toContain('non-empty');
    });

    it('should reject non-string skill parameter', async () => {
      const result = await tool.execute({ skill: 123 });
      expect(result).toContain('Error');
    });

    it('should return success for valid skill name', async () => {
      const result = await tool.execute({ skill: 'project-review' });
      expect(result).toContain('loaded successfully');
      expect(result).toContain('project-review');
      expect(result).not.toContain('Error');
    });
  });

  // ==================== afterExecute 正常加载 ====================

  describe('afterExecute successful loading', () => {
    it('should return skill instructions wrapped in xml tag', async () => {
      const executeResult = await tool.execute({ skill: 'project-review' });
      const content = await tool.afterExecute!({ skill: 'project-review' }, executeResult);

      expect(content).not.toBeNull();
      expect(content).toContain('<skill name="project-review">');
      expect(content).toContain(SAMPLE_INSTRUCTIONS);
      expect(content).toContain('</skill>');
    });

    it('should include args in output when provided', async () => {
      const executeResult = await tool.execute({ skill: 'project-review', args: 'Focus on security' });
      const content = await tool.afterExecute!({ skill: 'project-review', args: 'Focus on security' }, executeResult);

      expect(content).toContain('Additional context from user: Focus on security');
    });

    it('should not include args section when args is empty', async () => {
      const executeResult = await tool.execute({ skill: 'project-review' });
      const content = await tool.afterExecute!({ skill: 'project-review' }, executeResult);

      expect(content).not.toContain('Additional context from user');
    });

    it('should call loadSkill with correct dirName', async () => {
      await tool.execute({ skill: 'spec-develop' });
      await tool.afterExecute!({ skill: 'spec-develop' }, 'ok');

      expect(mockLoadSkill).toHaveBeenCalledWith('spec-develop');
    });

    it('should trim skill name', async () => {
      await tool.execute({ skill: '  project-review  ' });
      await tool.afterExecute!({ skill: '  project-review  ' }, 'ok');

      expect(mockLoadSkill).toHaveBeenCalledWith('project-review');
    });
  });

  // ==================== afterExecute 错误处理 ====================

  describe('afterExecute error handling', () => {
    it('should return null when skill name is empty', async () => {
      const content = await tool.afterExecute!({ skill: '' }, 'ok');
      expect(content).toBeNull();
    });

    it('should return error message when loadSkill fails', async () => {
      const failingTool = new SkillTool(createFailingLoadSkill('Skill not found'));
      const content = await failingTool.afterExecute!({ skill: 'nonexistent' }, 'ok');

      expect(content).toContain('Error');
      expect(content).toContain('nonexistent');
      expect(content).toContain('Skill not found');
    });

    it('should return null when skill has no instructions', async () => {
      const emptyTool = new SkillTool(createMockLoadSkill(''));
      const content = await emptyTool.afterExecute!({ skill: 'empty-skill' }, 'ok');

      expect(content).toBeNull();
    });
  });

  // ==================== 边界情况 ====================

  describe('edge cases', () => {
    it('should handle skill name with special characters', async () => {
      const result = await tool.execute({ skill: 'my-skill_v2' });
      expect(result).not.toContain('Error');

      const content = await tool.afterExecute!({ skill: 'my-skill_v2' }, result);
      expect(content).toContain('<skill name="my-skill_v2">');
    });

    it('should handle skill with args containing whitespace', async () => {
      const content = await tool.afterExecute!(
        { skill: 'project-review', args: '  review the auth module  ' },
        'ok',
      );

      expect(content).toContain('Additional context from user: review the auth module');
    });

    it('should not include args section when args is not a string', async () => {
      const content = await tool.afterExecute!(
        { skill: 'project-review', args: 123 },
        'ok',
      );

      expect(content).not.toContain('Additional context from user');
    });

    it('afterExecute should not be called when execute returns error', async () => {
      // Even though execute returns an error, afterExecute should still handle gracefully
      const result = await tool.execute({ skill: '' });
      expect(result).toContain('Error');

      // afterExecute with empty skill should return null
      const content = await tool.afterExecute!({ skill: '' }, result);
      expect(content).toBeNull();
    });
  });
});
