/**
 * ToolRegistry 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry } from '@/core/services/tools/tool-registry';
import { ITool } from '@/core/services/tools/tool.interface';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

/** 创建一个 mock 工具 */
function createMockTool(name: string, description = 'Mock tool'): ITool {
  return {
    name,
    description,
    parameters: { type: 'object', properties: { input: { type: 'string' } } },
    execute: vi.fn(async () => `Result from ${name}`),
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool', () => {
      const tool = createMockTool('test_tool');
      registry.register(tool);
      expect(registry.size).toBe(1);
    });

    it('should throw when registering duplicate tool name', () => {
      const tool = createMockTool('dup_tool');
      registry.register(tool);
      expect(() => registry.register(tool)).toThrow("Tool 'dup_tool' already registered");
    });
  });

  describe('registerAll', () => {
    it('should register multiple tools', () => {
      const tools = [
        createMockTool('tool_a'),
        createMockTool('tool_b'),
        createMockTool('tool_c'),
      ];
      registry.registerAll(tools);
      expect(registry.size).toBe(3);
    });

    it('should skip duplicate tools silently', () => {
      const tools = [createMockTool('skip_tool'), createMockTool('skip_tool')];
      registry.registerAll(tools);
      expect(registry.size).toBe(1);
    });

    it('should handle empty array', () => {
      registry.registerAll([]);
      expect(registry.size).toBe(0);
    });
  });

  describe('get', () => {
    it('should return tool by name', () => {
      const tool = createMockTool('findme');
      registry.register(tool);
      expect(registry.get('findme')).toBe(tool);
    });

    it('should return undefined for non-existent tool', () => {
      expect(registry.get('not_found')).toBeUndefined();
    });
  });

  describe('getByNames', () => {
    it('should return tools for existing names', () => {
      const toolA = createMockTool('alpha');
      const toolB = createMockTool('beta');
      registry.register(toolA);
      registry.register(toolB);

      const result = registry.getByNames(['alpha', 'beta']);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('alpha');
      expect(result[1].name).toBe('beta');
    });

    it('should skip non-existent names', () => {
      registry.register(createMockTool('exists'));
      const result = registry.getByNames(['exists', 'ghost']);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('exists');
    });

    it('should return empty array for all non-existent', () => {
      const result = registry.getByNames(['a', 'b']);
      expect(result).toHaveLength(0);
    });
  });

  describe('unregister', () => {
    it('should remove tool and return true', () => {
      registry.register(createMockTool('remove_me'));
      expect(registry.unregister('remove_me')).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('should return false for non-existent tool', () => {
      expect(registry.unregister('ghost')).toBe(false);
    });
  });

  describe('listNames', () => {
    it('should return sorted tool names', () => {
      registry.register(createMockTool('charlie'));
      registry.register(createMockTool('alpha'));
      registry.register(createMockTool('bravo'));

      const names = registry.listNames();
      expect(names).toEqual(['alpha', 'bravo', 'charlie']);
    });

    it('should return empty array when no tools', () => {
      expect(registry.listNames()).toEqual([]);
    });
  });

  describe('getFunctionDefinitions', () => {
    it('should return correct format for OpenAI function calling', () => {
      const tool = createMockTool('fn_tool', 'A test function tool');
      registry.register(tool);

      const defs = registry.getFunctionDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].type).toBe('function');
      expect(defs[0].function.name).toBe('fn_tool');
      expect(defs[0].function.description).toBe('A test function tool');
      expect(defs[0].function.parameters).toBeDefined();
    });

    it('should return definitions for all registered tools', () => {
      registry.register(createMockTool('t1'));
      registry.register(createMockTool('t2'));
      const defs = registry.getFunctionDefinitions();
      expect(defs).toHaveLength(2);
    });
  });

  describe('hasTools', () => {
    it('should return false when empty', () => {
      expect(registry.hasTools()).toBe(false);
    });

    it('should return true when tools exist', () => {
      registry.register(createMockTool('any'));
      expect(registry.hasTools()).toBe(true);
    });
  });

  describe('size', () => {
    it('should reflect current tool count', () => {
      expect(registry.size).toBe(0);
      registry.register(createMockTool('a'));
      expect(registry.size).toBe(1);
      registry.register(createMockTool('b'));
      expect(registry.size).toBe(2);
      registry.unregister('a');
      expect(registry.size).toBe(1);
    });
  });
});
