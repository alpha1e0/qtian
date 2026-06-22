<template>
  <div class="task-history-list" v-loading="loading">
    <div v-if="tasks.length === 0 && !loading" class="empty-hint">暂无历史任务</div>
    <div
      v-for="task in tasks"
      :key="task.id"
      class="history-row"
      :class="{ active: task.id === currentTaskId }"
      @click="$emit('select', task.id)"
    >
      <el-tag size="small" :type="statusTagType(task.status)">
        {{ statusLabel(task.status) }}
      </el-tag>
      <span class="row-title" :title="task.title">{{ task.title }}</span>
      <span class="row-time">{{ formatTime(task.created_at) }}</span>
      <el-button
        v-if="getSummaryDocId(task)"
        size="small"
        text
        @click.stop="handleOpenSummary(task)"
      >
        查看总结
      </el-button>
    </div>
  </div>
</template>

<script>
/**
 * TaskHistoryList —— 某个 todo_item 的历史任务列表（Phase 5）
 *
 * 设计文档：docs/specs/100_todo-app-design.md §8.6 / §8.7
 *
 * 数据来源：window.todoApp.listTasksByItem(itemId)，按 created_at DESC（后端已排序）
 *
 * 事件：
 * - select(taskId) —— 切换到该任务面板
 * - open-doc({ id, itemId, titlePath }) —— 打开总结文档
 */
export default {
  name: 'TaskHistoryList',
  emits: ['select', 'open-doc'],
  props: {
    itemId: { type: Number, required: true },
    currentTaskId: { type: Number, default: null },
  },
  data() {
    return {
      tasks: [],
      loading: false,
    };
  },
  watch: {
    itemId() {
      this.loadTasks();
    },
  },
  mounted() {
    this.loadTasks();
  },
  methods: {
    async loadTasks() {
      this.loading = true;
      try {
        this.tasks = await window.todoApp.listTasksByItem(this.itemId);
      } catch (err) {
        console.error('list tasks by item failed', err);
        this.tasks = [];
      } finally {
        this.loading = false;
      }
    },
    /** 暴露刷新入口（外部新增任务后调用） */
    refresh() {
      return this.loadTasks();
    },
    statusLabel(status) {
      return STATUS_LABELS[status] ?? status;
    },
    statusTagType(status) {
      return STATUS_TAG_TYPES[status] ?? 'info';
    },
    /** 从 result_meta 提取 summary_doc_id（任务完成后由 source handler 写入） */
    getSummaryDocId(task) {
      const meta = task.result_meta;
      if (!meta) return null;
      // result_meta 可能是对象（IPC 序列化保持）或 JSON 字符串（兜底解析）
      const obj = typeof meta === 'string' ? safeParse(meta) : meta;
      return obj?.summary_doc_id ?? null;
    },
    handleOpenSummary(task) {
      const docId = this.getSummaryDocId(task);
      if (!docId) return;
      this.$emit('open-doc', {
        id: docId,
        itemId: this.itemId,
        titlePath: `${task.title} - 任务总结`,
      });
    },
    /** 时间格式化：YYYY-MM-DD HH:mm */
    formatTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
.task-history-list {
  max-height: 220px;
  overflow-y: auto;
}

.empty-hint {
  color: var(--text-on-dark-muted);
  font-size: 12px;
  text-align: center;
  padding: 16px 0;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.1s;
}

.history-row:hover {
  background: rgba(99, 102, 241, 0.06);
}

.history-row.active {
  background: rgba(99, 102, 241, 0.12);
}

.row-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.row-time {
  flex-shrink: 0;
  color: var(--text-on-dark-muted);
}
</style>
