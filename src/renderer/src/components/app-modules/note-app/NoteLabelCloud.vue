<template>
  <div class="note-label-cloud">
    <div v-if="labels.length === 0" class="label-empty">
      暂无标签
    </div>
    <div v-else class="label-list">
      <el-tag
        v-for="label in labels"
        :key="label.id"
        class="label-tag"
        :class="{ 'is-selected': label.id === selectedId }"
        :effect="label.id === selectedId ? 'dark' : 'light'"
        @click="$emit('select-label', label.id)"
      >
        {{ label.name }}
      </el-tag>
    </div>
  </div>
</template>

<script>
/**
 * 标签云：展示全部 label，选中态高亮。
 */
export default {
  name: 'NoteLabelCloud',
  props: {
    labels: { type: Array, default: () => [] },
    selectedId: { type: [Number, null], default: null },
  },
  emits: ['select-label'],
};
</script>

<style scoped>
.note-label-cloud {
  padding: 8px 4px;
}

.label-empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 13px;
  color: var(--text-on-dark-secondary, #909399);
  letter-spacing: 0.02em;
}

.label-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.label-tag {
  cursor: pointer;
  border-radius: 999px;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
  user-select: none;
}

.label-tag:hover {
  transform: translateY(-1px);
}

.label-tag.is-selected {
  background: linear-gradient(135deg, var(--accent, #6366f1), #818cf8);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}
</style>
