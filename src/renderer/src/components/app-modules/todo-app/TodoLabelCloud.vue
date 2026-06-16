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
        class="label-tag"
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
  padding: 4px 0;
  margin-bottom: 8px;
}

.header-title {
  font-size: 12px;
  color: var(--text-on-dark-secondary, #aaa);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.empty-hint {
  color: var(--text-on-dark-muted, #666);
  font-size: 13px;
  padding: 8px 0;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.label-tag {
  cursor: pointer;
  user-select: none;
}
</style>
