<template>
  <div class="chat-message" :class="`chat-message-${message.role}`">
    <!-- 消息头部：角色 + 模型 + 时间 -->
    <div class="message-header">
      <span class="message-role-icon">{{ roleIcon }}</span>
      <span class="message-role-name">{{ roleName }}</span>
      <span v-if="llmConfigName" class="message-model">{{ llmConfigName }}</span>
      <span v-if="formattedTime" class="message-time">{{ formattedTime }}</span>
    </div>

    <!-- 展示模式 -->
    <template v-if="!isEditing">
      <!-- 普通消息 (user / assistant) -->
      <template v-if="message.role === 'user' || (message.role === 'assistant' && !hasToolCalls)">
        <div class="message-bubble" v-html="renderedContent"></div>
      </template>
      <!-- 工具调用消息 (assistant with tool_calls) -->
      <template v-else-if="message.role === 'assistant' && hasToolCalls">
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
      <!-- 独立 tool 消息 (由 tool_calls 关联处理，不需要单独渲染) -->
      <template v-else-if="message.role === 'tool'">
      </template>

      <!-- 操作按钮 -->
      <div class="message-actions" v-if="message.role === 'user' || message.role === 'assistant'">
        <el-tooltip content="复制" placement="top" :show-after="500">
          <el-button link size="small" @click="handleCopy">
            <el-icon><DocumentCopy /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip v-if="message.role === 'user'" content="编辑" placement="top" :show-after="500">
          <el-button link size="small" @click="startEdit">
            <el-icon><Edit /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip v-if="message.role === 'assistant'" content="重新生成" placement="top" :show-after="500">
          <el-button link size="small" @click="$emit('regenerate')">
            <el-icon><RefreshRight /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="删除" placement="top" :show-after="500">
          <el-button link size="small" @click="$emit('delete-message', messageIndex)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </template>

    <!-- 编辑模式 -->
    <template v-else>
      <div class="message-edit">
        <el-input
          v-model="editContent"
          type="textarea"
          :rows="3"
          resize="none"
          aria-label="编辑消息"
        />
        <div class="edit-actions">
          <el-button size="small" @click="cancelEdit">取消</el-button>
          <el-button type="primary" size="small" @click="saveEdit">保存</el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { DocumentCopy, Edit, RefreshRight, Delete } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import MarkdownIt from 'markdown-it';
import ToolCallView from './ToolCallView.vue';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/** 使用 markdown-it 渲染 Markdown 文本 */
function renderMarkdown(text) {
  if (!text) return '';
  return md.render(text);
}

/**
 * 格式化时间戳为可读字符串
 * @param {number} timestamp - Unix 时间戳 (毫秒)
 * @returns {string} 格式化后的时间字符串
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

export default {
  name: 'ChatMessage',
  components: { ToolCallView, DocumentCopy, Edit, RefreshRight, Delete },
  props: {
    message: { type: Object, required: true },
    /** 消息在 displayMessages 中的索引 (用于编辑/删除) */
    messageIndex: { type: Number, default: -1 },
    /** 所有消息列表 (用于查找 tool result) */
    allMessages: { type: Array, default: () => [] },
    /** Agent 名称 */
    agentName: { type: String, default: '' },
    /** LLM 配置名称 */
    llmConfigName: { type: String, default: '' },
  },
  emits: ['edit-message', 'delete-message', 'regenerate'],
  data() {
    return {
      isEditing: false,
      editContent: '',
    };
  },
  computed: {
    renderedContent() {
      return renderMarkdown(this.message.content);
    },
    hasToolCalls() {
      return this.message.tool_calls && this.message.tool_calls.length > 0;
    },
    roleIcon() {
      return this.message.role === 'user' ? '\u{1F9D1}' : '\u{1F916}';
    },
    roleName() {
      if (this.message.role === 'user') return 'User';
      if (this.message.role === 'assistant') return this.agentName || 'AI 助手';
      return '';
    },
    formattedTime() {
      return formatTimestamp(this.message.timestamp);
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
    /** 复制消息内容到剪贴板 */
    handleCopy() {
      navigator.clipboard.writeText(this.message.content).then(() => {
        ElMessage.success('已复制');
      }).catch(() => {
        ElMessage.error('复制失败');
      });
    },
    /** 进入编辑模式 */
    startEdit() {
      this.editContent = this.message.content;
      this.isEditing = true;
    },
    /** 取消编辑 */
    cancelEdit() {
      this.isEditing = false;
      this.editContent = '';
    },
    /** 保存编辑 */
    saveEdit() {
      if (!this.editContent.trim()) {
        ElMessage.warning('消息内容不能为空');
        return;
      }
      this.$emit('edit-message', this.messageIndex, this.editContent.trim());
      this.isEditing = false;
      this.editContent = '';
    },
  },
};
</script>

<style scoped>
.chat-message {
  margin-bottom: 20px;
  max-width: 80%;
}

.chat-message-user {
  margin-left: auto;
}

.chat-message-assistant {
  margin-right: auto;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
}

.message-role-icon {
  font-size: 16px;
}

.message-role-name {
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 13px;
}

.message-model {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: 4px;
}

.message-time {
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.message-bubble {
  word-break: break-word;
  line-height: 1.7;
  font-size: 14px;
}

.chat-message-user .message-bubble {
  background: var(--accent-gradient);
  color: #ffffff;
  border-radius: var(--radius-lg) var(--radius-lg) 4px var(--radius-lg);
  padding: 12px 16px;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
}

.chat-message-assistant .message-bubble {
  background: var(--surface-card);
  color: var(--text-primary);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) 4px;
  padding: 12px 16px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-light);
}

/* Action buttons */
.message-actions {
  display: flex;
  gap: 2px;
  margin-top: 6px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.chat-message:hover .message-actions {
  opacity: 1;
}

.message-actions :deep(.el-button) {
  color: var(--text-muted);
}

.message-actions :deep(.el-button:hover) {
  color: var(--accent);
}

/* Edit mode */
.message-edit {
  background: var(--surface-card);
  border-radius: var(--radius-md);
  padding: 12px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-light);
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

/* === Markdown: user bubble (white text on gradient) === */
.chat-message-user .message-bubble :deep(a) {
  color: #c7d2fe;
  text-decoration: underline;
}

.chat-message-user .message-bubble :deep(code) {
  background: rgba(255, 255, 255, 0.15);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: #e0e0ff;
}

.chat-message-user .message-bubble :deep(pre) {
  background: rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-sm);
  padding: 10px;
  overflow-x: auto;
  margin: 8px 0;
}

.chat-message-user .message-bubble :deep(pre code) {
  background: transparent;
  padding: 0;
}

/* === Markdown: assistant bubble (dark text on white) === */
.message-bubble :deep(h1),
.message-bubble :deep(h2),
.message-bubble :deep(h3) {
  margin: 14px 0 8px;
  font-weight: 650;
  color: var(--text-primary);
}

.message-bubble :deep(h1) { font-size: 18px; }
.message-bubble :deep(h2) { font-size: 16px; }
.message-bubble :deep(h3) { font-size: 15px; }

.message-bubble :deep(pre) {
  background: #f3f2ef;
  border-radius: var(--radius-sm);
  padding: 12px;
  overflow-x: auto;
  margin: 10px 0;
  border: 1px solid var(--border-light);
}

.message-bubble :deep(code) {
  font-family: var(--font-mono);
  font-size: 13px;
}

.message-bubble :deep(pre code) {
  background: transparent;
  padding: 0;
  border: none;
}

.message-bubble :deep(a) {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
}

.message-bubble :deep(a:hover) {
  text-decoration: underline;
}

.message-bubble :deep(li) {
  margin-left: 20px;
  list-style: disc;
}

.message-bubble :deep(strong) {
  font-weight: 650;
}

.message-bubble :deep(blockquote) {
  border-left: 3px solid var(--accent);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--text-secondary);
  font-style: italic;
}

.message-bubble :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
}

.message-bubble :deep(th),
.message-bubble :deep(td) {
  border: 1px solid var(--border-medium);
  padding: 6px 10px;
  text-align: left;
}

.message-bubble :deep(th) {
  background: #f3f2ef;
  font-weight: 600;
}
</style>
