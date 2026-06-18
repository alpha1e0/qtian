<template>
  <div class="task-panel-inner">
    <!-- 顶部：返回 + 标题 + 状态 + 取消 -->
    <div class="panel-header">
      <el-button size="small" text @click="$emit('back')">
        <el-icon><ArrowLeft /></el-icon> 返回
      </el-button>
      <div class="title-wrap">
        <span class="title" :title="task?.title">{{ task?.title || '加载中...' }}</span>
        <el-tag v-if="task" size="small" :type="statusTagType(task.status)">
          {{ statusLabel(task.status) }}
        </el-tag>
      </div>
      <el-button
        v-if="task && task.status === 'running'"
        size="small"
        type="danger"
        plain
        @click="handleCancel"
      >
        取消
      </el-button>
    </div>

    <!-- 元信息：Agent / LLM -->
    <div v-if="task" class="panel-meta">
      <span>Agent: {{ task.agent_name }}</span>
      <span class="meta-sep">|</span>
      <span>LLM: {{ task.llm_config_name }}</span>
    </div>

    <!-- 中部：流式输出 + 工具调用 -->
    <div class="panel-body" v-loading="loading && !task">
      <div v-if="streamText.length > 0" class="stream-block">
        <div class="block-title">流式输出</div>
        <pre class="stream-output">{{ streamText }}</pre>
      </div>

      <div v-if="toolCalls.length > 0" class="tool-block">
        <div class="block-title">工具调用</div>
        <div v-for="call in toolCalls" :key="call.toolCallId" class="tool-item">
          <div class="tool-head">
            <el-icon><Tools /></el-icon>
            <span class="tool-name">{{ call.name }}</span>
            <el-tag
              v-if="call.result !== undefined"
              size="small"
              :type="call.isError ? 'danger' : 'success'"
            >
              {{ call.isError ? '错误' : '完成' }}
            </el-tag>
            <el-tag v-else size="small" type="warning">运行中</el-tag>
          </div>
          <pre v-if="call.result !== undefined" class="tool-result">{{ truncate(call.result, 300) }}</pre>
        </div>
      </div>

      <div v-if="streamText.length === 0 && toolCalls.length === 0 && task" class="empty-stream">
        <el-empty description="等待任务输出..." :image-size="80" />
      </div>
    </div>

    <!-- 底部：总结文档链接 + 历史任务列表 -->
    <div v-if="task && isTerminal" class="panel-footer">
      <div v-if="summaryDocId" class="summary-link" @click="handleOpenSummary">
        <el-icon><Document /></el-icon>
        <span>已生成总结文档</span>
        <el-button size="small" text type="primary">查看</el-button>
      </div>
      <div v-else-if="handlerError" class="summary-error">
        <el-icon><WarningFilled /></el-icon>
        <span>总结生成失败：{{ handlerError }}</span>
      </div>

      <div class="history-section">
        <el-button size="small" text @click="historyExpanded = !historyExpanded">
          <el-icon><Clock /></el-icon>
          历史任务 ({{ historyCount }})
          <el-icon class="caret"><component :is="historyExpanded ? 'ArrowUp' : 'ArrowDown'" /></el-icon>
        </el-button>
        <TaskHistoryList
          v-if="historyExpanded"
          :item-id="itemId"
          :current-task-id="taskId"
          @select="handleSelectHistory"
          @open-doc="handleOpenDoc"
          ref="historyList"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { ArrowLeft, Tools, Document, WarningFilled, Clock, ArrowUp, ArrowDown } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import TaskHistoryList from './TaskHistoryList.vue';

/**
 * TaskPanel —— 任务执行面板（Phase 5）
 *
 * 设计文档：docs/specs/100_todo-app-design.md §8.7 / §10 Phase 5
 *
 * 职责：
 * - 订阅 qtian:task:event，按 taskId 过滤累积 text_delta / tool_start / tool_result
 * - 渲染任务状态（pending/running/completed/failed/cancelled）+ Agent/LLM 元信息
 * - 任务完成后展示总结文档链接（result_meta.summary_doc_id）
 * - 可展开 TaskHistoryList 切换到其他历史任务
 *
 * 流式渲染策略（决策：不复用 ChatMessage.vue）：
 * - 直接累积 text_delta 到字符串，<pre> 保留格式
 * - tool_start/tool_result 单独区块（不渲染 markdown）
 *
 * 事件：
 * - back —— 返回 todo_item 详情
 * - open-doc({ id, itemId, titlePath }) —— 打开总结文档
 */
export default {
  name: 'TaskPanel',
  components: { ArrowLeft, Tools, Document, WarningFilled, Clock, ArrowUp, ArrowDown, TaskHistoryList },
  emits: ['back', 'open-doc', 'select-task'],
  props: {
    itemId: { type: Number, required: true },
    taskId: { type: Number, required: true },
  },
  data() {
    return {
      task: null,
      loading: true,
      streamText: '',
      toolCalls: [],
      historyExpanded: false,
      unsubscribeEvent: null,
    };
  },
  computed: {
    isTerminal() {
      if (!this.task) return false;
      return ['completed', 'failed', 'cancelled'].includes(this.task.status);
    },
    summaryDocId() {
      return this.extractMetaField('summary_doc_id');
    },
    handlerError() {
      return this.extractMetaField('handler_error');
    },
    historyCount() {
      // 仅在展开后由 TaskHistoryList 自行加载；这里仅做占位
      return this.task ? 1 : 0;
    },
  },
  watch: {
    taskId(newId, oldId) {
      if (newId !== oldId) {
        this.resetStream();
        this.loadInitial();
      }
    },
  },
  async mounted() {
    await this.loadInitial();
    this.subscribeEvents();
  },
  beforeUnmount() {
    this.cleanup();
  },
  methods: {
    async loadInitial() {
      this.loading = true;
      try {
        await window.task.subscribe(this.taskId);
        this.task = await window.task.get(this.taskId);
        // 若任务已终态（重连场景），从 result_meta 恢复（流式内容已丢失，可接受）
      } catch (err) {
        console.error('load task failed', err);
        ElMessage.error('加载任务失败');
      } finally {
        this.loading = false;
      }
    },
    subscribeEvents() {
      this.unsubscribeEvent = window.task.onEvent((event) => {
        if (!event || event.taskId !== this.taskId) return;
        this.handleEvent(event);
      });
    },
    handleEvent(event) {
      switch (event.type) {
        case 'status_changed':
          if (this.task) {
            this.task = { ...this.task, status: event.status };
          }
          break;
        case 'progress':
          if (this.task) {
            this.task = { ...this.task, progress: event.progress };
          }
          break;
        case 'text_delta':
          this.streamText += event.content;
          break;
        case 'tool_start':
          this.toolCalls = [
            ...this.toolCalls.filter((c) => c.toolCallId !== event.toolCallId),
            { toolCallId: event.toolCallId, name: event.name, arguments: event.arguments, result: undefined, isError: false },
          ];
          break;
        case 'tool_result':
          this.toolCalls = this.toolCalls.map((c) =>
            c.toolCallId === event.toolCallId
              ? { ...c, result: event.result, isError: Boolean(event.isError) }
              : c,
          );
          break;
        case 'done':
          // 终态：刷新 task 视图以取 result_meta + 刷新历史列表
          this.refreshTask();
          this.$refs.historyList?.refresh();
          break;
        case 'error':
          if (event.message) {
            ElMessage.error(`任务错误：${event.message}`);
          }
          break;
        default:
          // log / thinking 等暂不展示（避免噪声）
          break;
      }
    },
    async refreshTask() {
      try {
        const fresh = await window.task.get(this.taskId);
        if (fresh) this.task = fresh;
      } catch (err) {
        console.error('refresh task failed', err);
      }
    },
    resetStream() {
      this.streamText = '';
      this.toolCalls = [];
    },
    async handleCancel() {
      try {
        await window.task.cancel(this.taskId);
        ElMessage.info('已请求取消');
      } catch (err) {
        ElMessage.error(err?.message || '取消失败');
      }
    },
    handleOpenSummary() {
      const docId = this.summaryDocId;
      if (!docId) return;
      this.$emit('open-doc', {
        id: docId,
        itemId: this.itemId,
        titlePath: `${this.task?.title || ''} - 任务总结`,
      });
    },
    handleOpenDoc(payload) {
      this.$emit('open-doc', payload);
    },
    handleSelectHistory(newTaskId) {
      // 由父组件切换 taskId（watch.taskId 会触发重新订阅）
      this.$emit('select-task', newTaskId);
    },
    cleanup() {
      if (this.unsubscribeEvent) {
        this.unsubscribeEvent();
        this.unsubscribeEvent = null;
      }
      // 取消订阅该任务事件（无 await，组件销毁后 IPC 仍能完成）
      try {
        window.task.unsubscribe(this.taskId);
      } catch (err) {
        console.error('unsubscribe failed', err);
      }
    },
    extractMetaField(field) {
      if (!this.task || !this.task.result_meta) return null;
      const meta = this.task.result_meta;
      const obj = typeof meta === 'string' ? safeParse(meta) : meta;
      return obj?.[field] ?? null;
    },
    statusLabel(status) {
      return STATUS_LABELS[status] ?? status;
    },
    statusTagType(status) {
      return STATUS_TAG_TYPES[status] ?? 'info';
    },
    truncate(text, max) {
      if (!text) return '';
      return text.length > max ? `${text.slice(0, max)}...` : text;
    },
  },
};

const STATUS_LABELS = {
  pending: '待运行',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_TAG_TYPES = {
  pending: 'info',
  running: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'info',
};

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
</script>

<style scoped>
.task-panel-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.title-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-meta {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-on-dark-secondary, #aaa);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.meta-sep {
  margin: 0 6px;
  color: var(--text-on-dark-muted, #666);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.stream-block,
.tool-block {
  margin-bottom: 12px;
}

.block-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-on-dark-muted, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.stream-output {
  margin: 0;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow-y: auto;
}

.tool-item {
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 4px;
  margin-bottom: 4px;
}

.tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.tool-name {
  font-weight: 500;
}

.tool-result {
  margin: 4px 0 0;
  padding: 4px 6px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 11px;
  color: var(--text-on-dark-secondary, #aaa);
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
  max-height: 120px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-stream {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
}

.panel-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding: 8px 12px;
}

.summary-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--el-color-primary, #409eff);
  font-size: 13px;
}

.summary-link:hover {
  background: rgba(64, 158, 255, 0.08);
}

.summary-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--el-color-danger, #f56c6c);
}

.history-section {
  margin-top: 8px;
}

.caret {
  margin-left: 4px;
}
</style>
