<template>
  <div class="chat-sidebar">
    <!-- 新建对话按钮 -->
    <div class="sidebar-header">
      <el-button type="primary"  @click="$emit('create-history')" style="width: 100%">
        + 新建对话
      </el-button>
    </div>

    <!-- 对话历史列表 -->
    <div class="history-list" v-if="histories.length > 0">
      <div
        v-for="item in histories"
        :key="item.id"
        class="history-item"
        :class="{ active: selectedHistory === item.id }"
        @click="$emit('history-change', item.id)"
      >
        <div class="history-title">{{ item.title || '未命名对话' }}</div>
        <div class="history-meta">
          <span class="history-time" v-if="item.updated_at">{{ formatTime(item.updated_at) }}</span>
          <span class="history-actions">
            <el-icon class="action-icon" @click.stop="openEditDialog(item)" title="编辑标题">
              <Edit />
            </el-icon>
            <el-icon class="action-icon" @click.stop="confirmDelete(item)" title="删除对话">
              <Delete />
            </el-icon>
          </span>
        </div>
      </div>
    </div>
    <div v-else class="history-empty">
      暂无对话历史
    </div>

    <!-- 编辑标题对话框 -->
    <el-dialog v-model="isEditDialogVisible" title="编辑对话标题" width="360px" :close-on-click-modal="false">
      <el-input v-model="editTitle" placeholder="请输入对话标题" maxlength="100" show-word-limit />
      <template #footer>
        <el-button @click="isEditDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmEdit">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { Edit, Delete } from '@element-plus/icons-vue';

/**
 * 格式化时间戳为短格式
 * @param {number} timestamp - Unix 时间戳 (毫秒)
 * @returns {string} 格式化后的时间字符串 (MM-DD HH:mm)
 */
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m}-${d} ${h}:${min}`;
}

export default {
  name: 'ChatSidebar',
  components: { Edit, Delete },
  props: {
    /** 对话历史摘要列表 Array<{ id, title, updated_at }> */
    histories: { type: Array, default: () => [] },
    selectedHistory: { type: String, default: '' },
  },
  emits: ['history-change', 'create-history', 'delete-history', 'rename-history'],
  data() {
    return {
      isEditDialogVisible: false,
      editTitle: '',
      editingHistoryId: '',
    };
  },
  methods: {
    formatTime,
    /**
     * 打开编辑标题对话框
     * @param {Object} item - 对话历史项
     */
    openEditDialog(item) {
      this.editingHistoryId = item.id;
      this.editTitle = item.title || '';
      this.isEditDialogVisible = true;
    },
    /** 确认编辑标题 */
    confirmEdit() {
      if (!this.editTitle.trim()) return;
      this.$emit('rename-history', this.editingHistoryId, this.editTitle.trim());
      this.isEditDialogVisible = false;
    },
    /**
     * 确认删除对话
     * @param {Object} item - 对话历史项
     */
    confirmDelete(item) {
      this.$confirm('确定要删除该对话吗？删除后不可恢复。', '删除确认', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      }).then(() => {
        this.$emit('delete-history', item.id);
      }).catch(() => {
        // 用户取消，不做任何操作
      });
    },
  },
};
</script>

<style scoped>
.chat-sidebar {
  width: 240px;
  background: var(--surface-dark-secondary);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sidebar-header {
  padding: 16px 14px 10px;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.history-item {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  margin-bottom: 2px;
  transition: all 0.15s ease;
}

.history-item:hover {
  background: var(--surface-dark-hover);
}

.history-item.active {
  background: var(--surface-dark-active);
}

.history-title {
  font-size: 13px;
  color: var(--text-on-dark);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 450;
}

.history-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.history-time {
  font-size: 11px;
  color: var(--text-on-dark-muted);
  font-variant-numeric: tabular-nums;
}

.history-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.history-item:hover .history-actions {
  opacity: 1;
}

.action-icon {
  font-size: 13px;
  color: var(--text-on-dark-muted);
  cursor: pointer;
  transition: color 0.15s ease;
}

.action-icon:hover {
  color: var(--accent);
}

.history-empty {
  padding: 24px 14px;
  text-align: center;
  color: var(--text-on-dark-muted);
  font-size: 13px;
}
</style>
