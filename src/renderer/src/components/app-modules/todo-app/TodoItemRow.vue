<template>
  <div class="todo-item-row" :data-item-id="item.id">
    <div
      class="item-row-main"
      :style="{ paddingLeft: depth * 20 + 'px' }"
      :class="[priorityRowClass, { selected: item.id === selectedItemId }]"
      @click="$emit('select', item.id)"
      @contextmenu="onContextMenu"
    >
      <!-- 左侧左对齐：勾选框、优先级标记、下拉箭头、标题 -->
      <el-checkbox
        :model-value="item.status === 'done'"
        :checked="item.status === 'done'"
        @change="handleToggleDone"
        @click.stop
      />
      <span class="priority-dot" :class="priorityClass" :title="priorityLabel" />

      <el-icon
        v-if="hasChildren"
        class="expand-arrow"
        :class="{ 'is-expanded': expanded }"
        :title="expanded ? '折叠' : '展开'"
        @click.stop="expanded = !expanded"
      >
        <ArrowRight />
      </el-icon>
      <span v-else class="expand-arrow-placeholder" />

      <span class="item-title" :class="{ done: item.status === 'done' }">{{ item.title }}</span>

      <!-- 右侧右对齐：子条目数量、进度 -->
      <div class="item-tail">
        <span v-if="hasChildren" class="child-count" :title="`子条目数：${children.length}`">
          {{ children.length }}
        </span>
        <span v-if="item.progress > 0 && item.status !== 'done'" class="item-progress">{{ item.progress }}%</span>
      </div>
    </div>

    <div v-if="expanded && hasChildren" class="item-children">
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
        @delete="$emit('delete', $event)"
      />
    </div>

    <!-- 右键菜单：创建子条目 / 删除条目（复用 TodoContextMenu，与 sidebar 同款） -->
    <TodoContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenuItems"
      @command="onCtxCommand"
      @close="ctxMenu.visible = false"
    />
  </div>
</template>

<script>
import { ArrowRight, Plus, Delete } from '@element-plus/icons-vue';
import TodoContextMenu from './TodoContextMenu.vue';
import { markRaw } from 'vue';

export default {
  name: 'TodoItemRow',
  components: { ArrowRight, TodoContextMenu },
  // delete：右键菜单触发，由父组件走确认 + IPC + 刷新流程
  emits: ['toggle-status', 'select', 'create-child', 'delete'],
  props: {
    item: { type: Object, required: true },
    depth: { type: Number, default: 0 },
    children: { type: Array, default: () => [] },
    selectedItemId: { type: Number, default: null },
  },
  data() {
    return {
      expanded: true,
      // 右键菜单状态：visible + 鼠标坐标
      ctxMenu: {
        visible: false,
        x: 0,
        y: 0,
      },
      // 菜单项图标（markRaw 避免组件进入响应式）
      icons: {
        add: markRaw(Plus),
        delete: markRaw(Delete),
      },
    };
  },
  computed: {
    hasChildren() {
      return Array.isArray(this.children) && this.children.length > 0;
    },
    priorityClass() {
      const map = { urgent: 'dot-urgent', important: 'dot-important', normal: 'dot-normal', hint: 'dot-hint' };
      return map[this.item.priority] || 'dot-normal';
    },
    priorityLabel() {
      const map = { urgent: '紧急', important: '重要', normal: '普通', hint: '提示' };
      return `优先级：${map[this.item.priority] || '普通'}`;
    },
    /** 用于 item-row-main 左侧 2px 优先级强调条（选中态可见） */
    priorityRowClass() {
      return `${this.priorityClass}-row`;
    },
    /** 右键菜单项：创建子条目 / 删除条目（与 sidebar 同款 TodoContextMenu） */
    ctxMenuItems() {
      return [
        { command: 'create-child', label: '创建子条目', icon: this.icons.add },
        { command: 'delete', label: '删除条目', icon: this.icons.delete, divided: true },
      ];
    },
  },
  methods: {
    handleToggleDone(checked) {
      const newStatus = checked ? 'done' : 'in_progress';
      this.$emit('toggle-status', { id: this.item.id, status: newStatus });
    },
    /**
     * 行右键：阻止默认菜单，记录鼠标坐标后展开自封装菜单。
     * 菜单实例随行存在，但 visible 仅在命中行上为 true，全局同时只有一个打开。
     */
    onContextMenu(event) {
      event.preventDefault();
      event.stopPropagation();
      this.ctxMenu.x = event.clientX;
      this.ctxMenu.y = event.clientY;
      this.ctxMenu.visible = true;
    },
    onCtxCommand({ command }) {
      this.ctxMenu.visible = false;
      if (command === 'create-child') {
        this.$emit('create-child', this.item.id);
      } else if (command === 'delete') {
        this.$emit('delete', this.item.id);
      }
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
  background: rgba(99, 102, 241, 0.06);
}

.item-row-main.selected {
  background: linear-gradient(
    90deg,
    rgba(99, 102, 241, 0.14) 0%,
    rgba(99, 102, 241, 0.03) 100%
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
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);
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
  text-decoration-color: rgba(31, 30, 46, 0.45);
  opacity: 0.55;
}

/*
 * 右侧 tail 区：子条目数量 + 进度，统一靠右对齐。
 * 用 .item-tail 容器把右侧元素聚合，避免外层 .item-row-main 的 gap 把它们与标题隔远。
 */
.item-tail {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}

.child-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-on-dark-muted, #8b8aa0);
  font-feature-settings: 'tnum';
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.08);
  letter-spacing: 0.04em;
}

.item-progress {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-on-dark-secondary);
  font-feature-settings: 'tnum';
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.12);
  flex-shrink: 0;
  letter-spacing: 0.04em;
}

/*
 * 展开箭头：左侧图标化（ArrowRight 旋转 90° 表示展开）。
 * 占位符保证无子项时标题与有子项行对齐。
 */
.expand-arrow {
  font-size: 12px;
  color: var(--text-on-dark-muted, #5c5b72);
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.18s ease, color 0.18s ease;
}

.expand-arrow:hover {
  color: var(--text-on-dark-secondary, #8b8aa0);
}

.expand-arrow.is-expanded {
  transform: rotate(90deg);
}

.expand-arrow-placeholder {
  display: inline-block;
  width: 12px;
  flex-shrink: 0;
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
    rgba(99, 102, 241, 0.22),
    rgba(99, 102, 241, 0.06)
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
