import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '@/core/utils/logger';
import { wpath } from '@/core/common/context';
import { AiMemory } from '@/core/common/config';

const logger = createLogger('AiMemoryService');

/** 全局记忆文件名 */
const GLOBAL_MEMORY_FILE = '_global.jsonl';

/**
 * 记忆管理服务
 *
 * 记忆以 JSON Lines 格式存储，每个场景一个文件。
 * 全局记忆存储在 _global.jsonl 中。
 *
 * 存储结构:
 *   memory/
 *     _global.jsonl        # 全局记忆
 *     default.jsonl        # 场景 default 的记忆
 *     coder.jsonl          # 场景 coder 的记忆
 */
export class AiMemoryService {
  private memoryDir: string;

  constructor() {
    this.memoryDir = wpath.assistantMemoryDir;
  }

  /**
   * 列出记忆条目
   * @param scenarioId - 场景 ID，不传则返回所有记忆 (全局 + 所有场景)
   * @returns 记忆条目列表 (按创建时间倒序)
   */
  async listMemories(scenarioId?: string): Promise<AiMemory[]> {
    if (scenarioId) {
      // 指定场景: 返回该场景记忆 + 全局记忆
      const scenarioMemories = await this.readMemoryFile(this.getMemoryFileName(scenarioId));
      const globalMemories = await this.readMemoryFile(GLOBAL_MEMORY_FILE);
      return [...scenarioMemories, ...globalMemories].sort((a, b) => b.created_at - a.created_at);
    }

    // 不指定: 读取所有 jsonl 文件
    const allMemories: AiMemory[] = [];
    try {
      const entries = await fs.readdir(this.memoryDir);
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        const memories = await this.readMemoryFile(entry);
        allMemories.push(...memories);
      }
    } catch {
      // memoryDir 不存在，返回空
    }

    return allMemories.sort((a, b) => b.created_at - a.created_at);
  }

  /**
   * 新增记忆条目
   * @param data - 记忆数据 (不含 id 和 created_at)
   * @returns 新增的记忆条目 (含自动生成的 id 和 created_at)
   */
  async addMemory(data: { content: string; tags?: string[]; scenario_id?: string }): Promise<AiMemory> {
    const memory: AiMemory = {
      id: crypto.randomUUID(),
      content: data.content,
      tags: data.tags || [],
      scenario_id: data.scenario_id,
      created_at: Date.now(),
    };

    const fileName = memory.scenario_id
      ? this.getMemoryFileName(memory.scenario_id)
      : GLOBAL_MEMORY_FILE;

    await this.appendMemoryToFile(fileName, memory);

    logger.info(`Memory added: ${memory.id} (scenario: ${memory.scenario_id || 'global'})`);
    return memory;
  }

  /**
   * 删除记忆条目
   * @param id - 记忆 ID
   * @param scenarioId - 场景 ID (可选，加速定位)
   * @returns 是否成功删除
   */
  async deleteMemory(id: string, scenarioId?: string): Promise<boolean> {
    // 确定要搜索的文件
    const filesToSearch: string[] = [];
    if (scenarioId) {
      filesToSearch.push(this.getMemoryFileName(scenarioId));
    }
    filesToSearch.push(GLOBAL_MEMORY_FILE);

    // 如果没有指定场景，搜索所有文件
    if (!scenarioId) {
      try {
        const entries = await fs.readdir(this.memoryDir);
        for (const entry of entries) {
          if (entry.endsWith('.jsonl') && !filesToSearch.includes(entry)) {
            filesToSearch.push(entry);
          }
        }
      } catch {
        // ignore
      }
    }

    // 在文件中查找并删除
    for (const fileName of filesToSearch) {
      const filePath = path.join(this.memoryDir, fileName);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim());
        const filtered = lines.filter((line) => {
          try {
            const mem = JSON.parse(line) as AiMemory;
            return mem.id !== id;
          } catch {
            return true; // 保留无法解析的行
          }
        });

        if (filtered.length !== lines.length) {
          await fs.writeFile(filePath, filtered.join('\n') + '\n', 'utf-8');
          logger.info(`Memory deleted: ${id} from ${fileName}`);
          return true;
        }
      } catch {
        // 文件不存在，继续搜索下一个
      }
    }

    logger.warn(`Memory not found for deletion: ${id}`);
    return false;
  }

  /**
   * 构建记忆文本段，用于注入 System Prompt
   * @param scenarioId - 场景 ID
   * @returns 格式化的记忆文本，无记忆时返回空字符串
   */
  async buildMemoryPrompt(scenarioId?: string): Promise<string> {
    const memories = await this.listMemories(scenarioId);

    if (memories.length === 0) {
      return '';
    }

    const lines = memories.map((mem) => {
      const tagStr = mem.tags.length > 0 ? ` [${mem.tags.join(', ')}]` : '';
      return `- ${mem.content}${tagStr}`;
    });

    return `## 记忆\n\n以下是与当前对话相关的记忆信息：\n${lines.join('\n')}`;
  }

  /**
   * 获取记忆文件的文件名
   */
  private getMemoryFileName(scenarioId: string): string {
    // 校验场景 ID 防止路径穿越
    this.validateMemoryFileName(scenarioId);
    return `${scenarioId}.jsonl`;
  }

  /**
   * 从 JSONL 文件读取记忆条目
   */
  private async readMemoryFile(fileName: string): Promise<AiMemory[]> {
    const filePath = path.join(this.memoryDir, fileName);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      const memories: AiMemory[] = [];

      for (const line of lines) {
        try {
          const mem = JSON.parse(line) as AiMemory;
          memories.push(mem);
        } catch {
          logger.warn(`Skipping invalid memory line in ${fileName}`);
        }
      }

      return memories;
    } catch {
      return [];
    }
  }

  /**
   * 追加记忆条目到 JSONL 文件
   */
  private async appendMemoryToFile(fileName: string, memory: AiMemory): Promise<void> {
    const filePath = path.join(this.memoryDir, fileName);
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(memory) + '\n', 'utf-8');
  }

  /**
   * 校验文件名安全性
   */
  private validateMemoryFileName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error('Memory file name must be a non-empty string');
    }
    if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
      throw new Error(`Invalid memory file name: '${name}'`);
    }
  }
}
