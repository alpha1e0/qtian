<template>
  <div class="todo-item-row" :data-item-id="item.id">
    <div
      class="item-row-main"
      :style="{ paddingLeft: depth * 20 + 'px' }"
      :class="[priorityRowClass, { selected: item.id === selectedItemId }]"
      @click="$emit('select', item.id)"
    >
      <el-checkbox
        :model-value="item.status === 'done'"
        :checked="item.status === 'done'"
        @change="handleToggleDone"
        @click.stop
      />
      <span class="priority-dot" :class="priorityClass" />
      <span class="item-title" :class="{ done: item.status === 'done' }">{{ item.title }}</span>
      <span v-if="item.progress > 0 && item.status !== 'done'" class="item-progress">{{ item.progress }}%</span>
      <el-button
        v-if="children && children.length > 0"
        size="small"
        text
        class="expand-btn"
        @click.stop="expanded = !expanded"
      >
        {{ expanded ? '▼' : '▶' }} {{ children.length }}
      </el-button>
      <el-button size="small" text class="add-child-btn" @click.stop="$emit('create-child', item.id)">
        <el-icon><Plus /></el-icon>
      </el-button>
    </div>

    <div v-if="expanded && children && children.length > 0" class="item-children">
      <TodoItemRow
        v-for="child in children"
        :key="child.id"
        :item="child"
        :depth="child.depth"
        :children="child.children"
        :selected-item-id="selectedItemId"
        @toggle-status="$emit('toggle-status', $event)"
        @select="$emit('select', $event)"
        @create-child="$emit('create-child', $event)"
      />
    </div>
  </div>
</template>

<script>
import { Plus } from '@element-plus/icons-vue';

export default {
  name: 'TodoItemRow',
  components: { Plus },
  props: {
    item: { type: Object, required: true },
    depth: { type: Number, default: 0 },
    children: { type: Array, default: () => [] },
    selectedItemId: { type: Number, default: null },
  },
  data() {
    return {
      expanded: true,
    };
  },
  computed: {
    priorityClass() {
      const map = { urgent: 'dot-urgent', important: 'dot-important', normal: 'dot-normal', hint: 'dot-hint' };
      return map[this.item.priority] || 'dot-normal';
    },
    /** 用于 item-row-main 左侧 2px 优先级强调条（选中态可见） */
    priorityRowClass() {
      return `${this.priorityClass}-row`;
    },
  },
  methods: {
    handleToggleDone(checked) {
      const newStatus = checked ? 'done' : 'in_progress';
      this.$emit('toggle-status', { id: this.item.id, status: newStatus });
    },
  },
};
</script>

<style scoped>
/* 搜索跳转临时高亮（Phase 3）：父组件 scrollToItem 通过 DOM 操作附加 */
.todo-item-row.flash-highlight {
  animation: todo-flash 1.5s ease-out;
}

@keyframes todo-flash {
  0% { background: rgba(99, 102, 241, 0.42); }
  60% { background: rgba(99, 102, 241, 0.16); }
  100% { background: transparent; }
}

.todo-item-row {
  user-select: none;
}

.item-row-main {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.18s ease, box-shadow 0.18s ease;
}

.item-row-main::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 50%;
  width: 2px;
  height: 14px;
  border-radius: 2px;
  background: transparent;
  transform: translateY(-50%);
  transition: background 0.18s ease, height 0.18s ease;
}

.item-row-main:hover {
  background: rgba(99, 102, 241, 0.08);
}

.item-row-main.selected {
  background: linear-gradient(
    90deg,
    rgba(99, 102, 241, 0.22) 0%,
    rgba(99, 102, 241, 0.04) 100%
  );
}

/* 选中 + 优先级条：用左侧 2px 强调当前行的优先级 */
.item-row-main.selected::before,
.item-row-main:hover::before {
  height: 18px;
}

.item-row-main.selected.dot-urgent-row::before { background: var(--color-danger, #ef4444); }
.item-row-main.selected.dot-important-row::before { background: var(--color-warning, #f59e0b); }
.item-row-main.selected.dot-normal-row::before { background: var(--accent, #6366f1); }
.item-row-main.selected.dot-hint-row::before { background: var(--text-on-dark-muted, #5c5b72); }

.priority-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.02);
}

.dot-urgent { background: var(--color-danger, #ef4444); box-shadow: 0 0 8px rgba(239, 68, 68, 0.45); }
.dot-important { background: var(--color-warning, #f59e0b); box-shadow: 0 0 8px rgba(245, 158, 11, 0.42); }
.dot-normal { background: var(--accent, #6366f1); }
.dot-hint { background: var(--text-on-dark-muted, #5c5b72); }

.item-title {
  font-size: 13px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.01em;
  color: var(--text-on-dark, #e4e4ed);
}

.item-title.done {
  text-decoration: line-through;
  text-decoration-color: rgba(139, 138, 160, 0.55);
  opacity: 0.55;
}

.item-progress {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-on-dark-secondary, #8b8aa0);
  font-feature-settings: 'tnum';
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.10);
  flex-shrink: 0;
  letter-spacing: 0.04em;
}

.expand-btn {
  font-size: 11px;
  color: var(--text-on-dark-muted, #5c5b72);
  font-feature-settings: 'tnum';
}

.expand-btn:hover {
  color: var(--text-on-dark-secondary, #8b8aa0);
}

.add-child-btn {
  opacity: 0;
  transition: opacity 0.18s ease;
}

.item-row-main:hover .add-child-btn {
  opacity: 1;
}

/* 子项缩进引导线 */
.item-children {
  position: relative;
}

.item-children::before {
  content: '';
  position: absolute;
  left: 22px;
  top: 0;
  bottom: 6px;
  width: 1px;
  background: linear-gradient(
    180deg,
    rgba(99, 102, 241, 0.20),
    rgba(99, 102, 241, 0.04)
  );
}

/* checkbox 与新主色调对齐 */
.item-row-main :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
}

.item-row-main :deep(.el-checkbox__inner) {
  border-radius: 4px;
}
</style>
