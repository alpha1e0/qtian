<template>
  <div class="todo-label-cloud">
    <div class="cloud-header">
      <span class="header-title">标签</span>
    </div>
    <div v-if="labels.length === 0" class="empty-hint">暂无标签</div>
    <div class="tag-list">
      <el-tag
        v-for="label in labels"
        :key="label.id"
        :type="label.id === selectedId ? 'primary' : 'info'"
        :effect="label.id === selectedId ? 'dark' : 'plain'"
        :class="['label-tag', { 'is-active': label.id === selectedId }]"
        @click="$emit('select-label', label.id)"
      >
        {{ label.name }}
      </el-tag>
    </div>
  </div>
</template>

<script>
export default {
  name: 'TodoLabelCloud',
  props: {
    labels: { type: Array, default: () => [] },
    selectedId: { type: Number, default: null },
  },
};
</script>

<style scoped>
.todo-label-cloud {
  padding: 4px 8px;
}

.cloud-header {
  position: relative;
  padding: 4px 8px 6px;
  margin-bottom: 12px;
}

.cloud-header::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(99, 102, 241, 0.24),
    transparent
  );
}

.header-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.empty-hint {
  color: var(--text-on-dark-muted, #5c5b72);
  font-size: 13px;
  padding: 12px 8px;
  font-style: italic;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.label-tag {
  cursor: pointer;
  user-select: none;
  padding: 4px 10px;
  height: auto;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  border-radius: 999px;
  transition: all 0.2s ease;
}

/* 未选中标签：极淡的靛底描边 */
.label-tag:not(.is-active) {
  background: rgba(99, 102, 241, 0.06);
  color: var(--text-on-dark-secondary, #8b8aa0);
  border: 1px solid rgba(99, 102, 241, 0.16);
}

.label-tag:not(.is-active):hover {
  background: rgba(99, 102, 241, 0.12);
  color: var(--text-on-dark, #e4e4ed);
  border-color: rgba(99, 102, 241, 0.32);
  transform: translateY(-1px);
}

/* 选中标签：靛蓝填充 + 微光，强对比于其他标签 */
.label-tag.is-active {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #ffffff;
  border: 1px solid transparent;
  box-shadow:
    0 0 0 1px rgba(99, 102, 241, 0.3),
    0 4px 14px rgba(99, 102, 241, 0.32);
}
</style>
