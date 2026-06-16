<template>
  <div class="todo-item-row">
    <div
      class="item-row-main"
      :style="{ paddingLeft: depth * 20 + 'px' }"
      :class="{ selected: item.id === selectedItemId }"
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
.todo-item-row {
  user-select: none;
}

.item-row-main {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
}

.item-row-main:hover {
  background: rgba(255, 255, 255, 0.04);
}

.item-row-main.selected {
  background: rgba(64, 158, 255, 0.12);
}

.priority-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-urgent { background: #f56c6c; }
.dot-important { background: #e6a23c; }
.dot-normal { background: #409eff; }
.dot-hint { background: #909399; }

.item-title {
  font-size: 13px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-title.done {
  text-decoration: line-through;
  opacity: 0.5;
}

.item-progress {
  font-size: 11px;
  color: var(--text-on-dark-muted, #888);
  flex-shrink: 0;
}

.expand-btn {
  font-size: 11px;
  color: var(--text-on-dark-muted, #888);
}

.add-child-btn {
  opacity: 0;
}

.item-row-main:hover .add-child-btn {
  opacity: 1;
}
</style>
