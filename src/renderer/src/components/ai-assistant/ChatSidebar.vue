<template>
  <div class="chat-sidebar">
    <!-- 新建对话按钮 -->
    <div class="sidebar-header">
      <el-button type="primary" size="small" @click="$emit('create-history')" style="width: 100%">
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
        <div class="history-time" v-if="item.updated_at">{{ formatTime(item.updated_at) }}</div>
      </div>
    </div>
    <div v-else class="history-empty">
      暂无对话历史
    </div>
  </div>
</template>

<script>
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
  props: {
    /** 对话历史摘要列表 Array<{ id, title, updated_at }> */
    histories: { type: Array, default: () => [] },
    selectedHistory: { type: String, default: '' },
  },
  emits: ['history-change', 'create-history'],
  methods: {
    formatTime,
  },
};
</script>

<style scoped>
.chat-sidebar {
  width: 220px;
  background: #f5f5f5;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.sidebar-header {
  padding: 16px 12px 8px;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.history-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s;
}

.history-item:hover {
  background: #e8e8e8;
}

.history-item.active {
  background: #d4e4ff;
}

.history-title {
  font-size: 13px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-time {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
}

.history-empty {
  padding: 20px 12px;
  text-align: center;
  color: #999;
  font-size: 13px;
}
</style>
