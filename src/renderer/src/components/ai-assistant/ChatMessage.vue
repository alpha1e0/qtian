<template>
  <div class="chat-message" :class="`chat-message-${message.role}`">
    <!-- 普通消息 (user / assistant) -->
    <template v-if="message.role === 'user' || message.role === 'assistant'">
      <div class="message-bubble" v-html="renderedContent"></div>
    </template>
    <!-- 工具调用消息 (assistant with tool_calls) -->
    <template v-else-if="message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0">
      <div v-if="message.content" class="message-bubble" v-html="renderedContent"></div>
      <ToolCallView
        v-for="tc in message.tool_calls"
        :key="tc.id"
        :name="tc.function.name"
        :arguments="tc.function.arguments"
        :result="getToolResult(tc.id)"
        :is-error="getToolResultIsError(tc.id)"
      />
    </template>
    <!-- 独立 tool 消息 (已由 tool_calls 关联处理，通常不需要单独渲染) -->
    <template v-else-if="message.role === 'tool'">
      <!-- tool 角色的消息由 ToolCallView 在 assistant 消息中展示，此处不单独渲染 -->
    </template>
  </div>
</template>

<script>
import ToolCallView from './ToolCallView.vue';

/**
 * 简单的 Markdown 渲染
 * 将 Markdown 文本转换为 HTML (支持标题、加粗、斜体、代码块、行内代码、列表)
 */
function renderMarkdown(text) {
  if (!text) return '';

  let html = text
    // 转义 HTML 特殊字符
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 代码块 (```...```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

  // 行内代码 (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 标题
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 加粗和斜体
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

  // 段落换行
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  // 包裹段落
  html = '<p>' + html + '</p>';

  // 清理空段落
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

export default {
  name: 'ChatMessage',
  components: { ToolCallView },
  props: {
    message: { type: Object, required: true },
    /** 所有消息列表 (用于查找 tool result) */
    allMessages: { type: Array, default: () => [] },
  },
  computed: {
    renderedContent() {
      return renderMarkdown(this.message.content);
    },
  },
  methods: {
    /**
     * 根据工具调用 ID 查找对应的 tool 结果内容
     */
    getToolResult(toolCallId) {
      const toolMsg = this.allMessages.find(
        (msg) => msg.role === 'tool' && msg.tool_call_id === toolCallId
      );
      return toolMsg ? toolMsg.content : '...';
    },
    /**
     * 判断工具调用结果是否为错误
     */
    getToolResultIsError(toolCallId) {
      const toolMsg = this.allMessages.find(
        (msg) => msg.role === 'tool' && msg.tool_call_id === toolCallId
      );
      return toolMsg ? toolMsg.content.startsWith('Error:') : false;
    },
  },
};
</script>

<style scoped>
.chat-message {
  margin-bottom: 8px;
}

.chat-message-user .message-bubble {
  background: #e3f2fd;
  color: #333;
  border-radius: 12px 12px 4px 12px;
  padding: 10px 14px;
}

.chat-message-assistant .message-bubble {
  background: white;
  color: #333;
  border-radius: 12px 12px 12px 4px;
  padding: 10px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.message-bubble {
  word-break: break-word;
  line-height: 1.6;
  font-size: 14px;
}

/* Markdown 渲染样式 */
.message-bubble :deep(h1),
.message-bubble :deep(h2),
.message-bubble :deep(h3) {
  margin: 12px 0 8px;
  font-weight: 600;
}

.message-bubble :deep(h1) { font-size: 18px; }
.message-bubble :deep(h2) { font-size: 16px; }
.message-bubble :deep(h3) { font-size: 15px; }

.message-bubble :deep(pre) {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 10px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-bubble :deep(code) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
}

.message-bubble :deep(pre code) {
  background: transparent;
  padding: 0;
}

.message-bubble :deep(a) {
  color: #409eff;
  text-decoration: none;
}

.message-bubble :deep(a:hover) {
  text-decoration: underline;
}

.message-bubble :deep(li) {
  margin-left: 20px;
  list-style: disc;
}

.message-bubble :deep(strong) {
  font-weight: 600;
}
</style>
