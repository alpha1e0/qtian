import { cut } from '@node-rs/jieba';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('TodoTokenizer');

/**
 * 匹配"纯标点/符号 token"（不含任何字母或数字）。
 *
 * jieba 会把 `，` `！` 等作为独立 token 返回，这些对 FTS 检索是噪声
 * （既不会被用户搜索，也增加索引体积），统一在此过滤。
 *
 * 使用 Unicode 属性类：`\p{L}`（字母）、`\p{N}`（数字）。
 */
const PUNCT_ONLY_RE = /^[^\p{L}\p{N}]+$/u;

/**
 * 中文/英文/混合文本分词器（基于 @node-rs/jieba）。
 *
 * 设计目标：
 * - 为 FTS5 写入与查询提供**统一**的分词入口，保证"写入分词规则 == 查询分词规则"
 * - 输出空格分隔的小写 token 字符串（FTS5 unicode61 仅按空白切分）
 *
 * 为什么单独抽类：
 *  - 单元测试可直接验证分词结果，无需启动 SQLite/FTS
 *  - 未来切换分词实现（如改用 `simple` 扩展或追加拼音）只改此处
 */
export class TodoTokenizer {
  /**
   * 对文本进行 jieba 分词（HMM 新词发现开启），输出小写、空格分隔的 token 串。
   *
   * 处理步骤：
   *  1. `cut(text, true)`：HMM 模式提升新词识别率
   *  2. 过滤空白 token（jieba 对纯空格/换行会返回空字符串）
   *  3. 过滤纯标点 token（`，` `！` 等对 FTS 是噪声）
   *  4. `toLowerCase()`：与 FTS5 unicode61 默认归一化一致，应用层做一次更可控
   *  5. 空格连接
   *
   * @param text - 原始文本（中/英/混合均可）
   * @returns 空格分隔的 token 字符串；text 为空或全空白时返回空串
   */
  cut(text: string): string {
    if (!text) {
      return '';
    }
    try {
      const tokens = cut(text, true);
      return tokens
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
        .filter((t) => !PUNCT_ONLY_RE.test(t))
        .join(' ');
    } catch (err) {
      // 分词失败不应阻塞主流程（如 jieba 词典加载异常），降级为按字符粗切
      logger.error('jieba cut failed, fallback to raw text', err);
      return text.trim().toLowerCase();
    }
  }
}
