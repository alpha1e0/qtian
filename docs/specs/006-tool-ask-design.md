# 006-tool-ask-design.md — AskHumanTool 设计文档

## 概述

AskHumanTool 允许 AI Agent 在执行过程中向用户提出多选题，等待用户选择后返回结果。
与其他内置工具不同，该工具需要**双向 IPC 通信**：主进程发送问题到渲染器，渲染器返回用户回答。

## 参考

- Claude Code `AskUserQuestionTool` (`.reference/claude-code-source-code-2.1.88/src/tools/AskUserQuestionTool/`)
- 已剥离：React/Ink UI、preview 功能、annotations、metadata 追踪、权限系统

## 架构设计

### 通信流程

```
LLM → tool_call(ask_human) → AiAgentService.executeTool()
  → AskHumanTool.execute()
    → askUserCallback(toolCallId, questions)
      → ipcMain: BrowserWindow.send(AI_ASK_QUESTION, { toolCallId, questions })
        → Renderer: 显示问题 UI
        → Renderer: ipcRenderer.invoke(AI_ANSWER_QUESTION, toolCallId, answers)
      → ipcMain: AI_ANSWER_QUESTION handler → resolve(pendingPromise)
    ← answers
  ← formatted result string
← tool_result → LLM 继续推理
```

### 核心组件

#### 1. AskHumanTool (`ask-tool/ask-tool.ts`)

- 实现 `ITool` 接口
- 通过构造函数注入 `AskUserCallback` 回调（不依赖 Electron API，便于测试）
- 参数校验：1-4 个问题，每题 2-4 个选项，header 唯一性，选项 label 唯一性
- 返回格式化文本给 LLM

#### 2. IPC Channel (`shared/ipc-channels.ts`)

| Channel | 方向 | 用途 |
|---------|------|------|
| `AI_ASK_QUESTION` | Main → Renderer | 发送问题到渲染器 |
| `AI_ANSWER_QUESTION` | Renderer → Main | 返回用户回答 |

#### 3. Handler (`ai-assistant.handler.ts`)

- `pendingQuestions` Map：存储待回答问题的 Promise resolve/reject
- `currentSender`：当前活跃的渲染器 WebContents 引用
- `askUserViaIpc()`：回调函数，发送问题到渲染器并创建等待 Promise（含 5 分钟超时）
- `AI_ANSWER_QUESTION` handler：收到回答后 resolve 对应的 Promise

#### 4. Preload Bridge (`preload/index.ts`)

- `onAskQuestion(callback)`：监听问题事件
- `answerQuestion(toolCallId, answers)`：发送回答

## 数据模型

```typescript
/** 单个问题选项 */
interface AskQuestionOption {
  label: string;       // 选项显示文本
  description: string; // 选项说明
}

/** 单个问题 */
interface AskQuestion {
  question: string;            // 完整问题文本
  header: string;              // 短标签（≤12 字符）
  options: AskQuestionOption[];// 2-4 个选项
  multiSelect?: boolean;       // 是否多选
}

/** 回调函数类型 */
type AskUserCallback = (
  toolCallId: string,
  questions: AskQuestion[],
) => Promise<Record<string, string>>;
// key = question 文本, value = 用户选择（选项 label 或自定义文本）
```

## 参数 Schema (OpenAI function calling)

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "question": { "type": "string" },
          "header": { "type": "string" },
          "options": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "label": { "type": "string" },
                "description": { "type": "string" }
              },
              "required": ["label", "description"]
            }
          },
          "multiSelect": { "type": "boolean" }
        },
        "required": ["question", "header", "options"]
      }
    }
  },
  "required": ["questions"]
}
```

## 安全与限制

- 问题数量限制：1-4 个
- 每题选项数量：2-4 个
- Header 长度限制：≤12 字符
- Header 唯一性校验
- 同一问题内选项 label 唯一性校验
- 超时保护：5 分钟无回答自动取消
- Sender 有效性检查：发送前检查 `currentSender` 是否存在且未销毁
- `currentSender` 在 chat/regenerate 结束后清理（`finally` 块）

## 注册

- 工具名称：`ask_human`（在 Agent 的 `tools` 数组中配置）
- `buildTools()` case `'ask_human'` → `new AskHumanTool(askUserViaIpc)`
- `index.ts` 导出 `AskHumanTool`、`AskQuestion`、`AskQuestionOption`、`AskUserCallback`

## 测试

- 28 个单元测试用例
- 覆盖：属性、参数校验（13 个）、正常执行（4 个）、回调错误处理（2 个）、边界情况（5 个）
- 使用 mock 回调函数隔离 IPC 通信
