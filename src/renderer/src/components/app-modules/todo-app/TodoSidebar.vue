<template>
  <div class="todo-sidebar-inner">
    <div class="sidebar-top">
      <el-radio-group v-model="view" size="small" class="view-toggle">
        <el-radio-button value="category">分类</el-radio-button>
        <el-radio-button value="label">标签</el-radio-button>
      </el-radio-group>

      <!-- 可滚动内容区：树/标签云过长时仅此处滚动，footer 始终可见 -->
      <div class="sidebar-scroll">
        <TodoCategoryTree
          ref="categoryTree"
          v-if="view === 'category'"
          :tree-data="categoryTree"
          :selected-node-key="selectedNodeKey"
          @select="$emit('tree-select', $event)"
          @create="$emit('create-category', $event)"
          @rename="$emit('rename-category', $event)"
          @delete="$emit('delete-category', $event)"
          @create-list="$emit('create-list', $event)"
          @rename-list="$emit('rename-list', $event)"
          @delete-list="$emit('delete-list', $event)"
        />

        <TodoLabelCloud
          v-else
          :labels="labels"
          :selected-id="selectedLabelId"
          @select-label="$emit('select-label', $event)"
        />
      </div>
    </div>

    <!-- 底部入口（设计文档 §9.3：回收站入口在左下角） -->
    <div class="sidebar-footer">
      <el-button
        size="small"
        plain
        class="trash-btn"
        @click="$emit('open-trash')"
      >
        <el-icon><Delete /></el-icon>
        <span>回收站</span>
      </el-button>
    </div>
  </div>
</template>

<script>
import TodoCategoryTree from './TodoCategoryTree.vue';
import TodoLabelCloud from './TodoLabelCloud.vue';
import { Delete } from '@element-plus/icons-vue';

export default {
  name: 'TodoSidebar',
  components: { TodoCategoryTree, TodoLabelCloud, Delete },
  props: {
    // 父组件已合并好的统一树（category + todo_list），原样透传给 TodoCategoryTree
    categoryTree: { type: Array, default: () => [] },
    labels: { type: Array, default: () => [] },
    // 复合 nodeKey（`cat_<id>` / `list_<id>`），用于 el-tree 高亮
    selectedNodeKey: { type: String, default: null },
    selectedLabelId: { type: Number, default: null },
  },
  data() {
    return {
      view: 'category',
    };
  },
  methods: {
    /**
     * 闪烁高亮分类节点（搜索跳转用，Phase 3）。
     * 通过 DOM 临时附加 flash class，1.5s 后移除。
     *
     * 实际"选中"由父组件设置 selectedCategoryId 驱动（current-node-key）；
     * 此方法仅做视觉强化提示。
     */
    highlightCategory(_categoryId) {
      this.$nextTick(() => {
        const root = this.$el;
        if (!root) return;
        // el-tree 当前选中节点会带 is-current class
        const current = root.querySelector('.el-tree-node.is-current > .el-tree-node__content');
        if (!current) return;
        current.classList.add('cat-flash');
        setTimeout(() => {
          current.classList.remove('cat-flash');
        }, 1500);
      });
    },
  },
};
</script>

<style scoped>
/*
 * 三段式布局：toggle（固定）+ 滚动内容区 + footer（固定）
 * 关键链路（全部 flex，不用 height:100%）：
 *   .todo-sidebar (flex column, overflow:hidden)
 *     └─ .todo-sidebar-inner (flex:1, min-height:0) ← 锁定高度不溢出
 *          ├─ .sidebar-top (flex:1, min-height:0)
 *          │    ├─ .view-toggle (flex-shrink:0)
 *          │    └─ .sidebar-scroll (flex:1, min-height:0, overflow:auto)
 *          └─ .sidebar-footer (flex-shrink:0) ← 永远可见
 */
.todo-sidebar-inner {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 14px 12px 12px;
}

.sidebar-top {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 树/标签云过长时仅此区域滚动，view-toggle 与 sidebar-footer 保持可见 */
.sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.sidebar-footer {
  flex-shrink: 0;
  padding-top: 12px;
  border-top: 1px solid rgba(99, 102, 241, 0.10);
}

.trash-btn {
  width: 100%;
  letter-spacing: 0.04em;
  --el-button-bg-color: rgba(239, 68, 68, 0.06);
  --el-button-hover-bg-color: rgba(239, 68, 68, 0.12);
  --el-button-border-color: rgba(239, 68, 68, 0.18);
  --el-button-hover-border-color: rgba(239, 68, 68, 0.32);
  --el-button-text-color: var(--color-danger, #ef4444);
  --el-button-hover-text-color: var(--color-danger, #ef4444);
}

/* 视图切换：编辑级 eyebrow toggle，告别 Element Plus 默认蓝色 */
.view-toggle {
  width: 100%;
  flex-shrink: 0;
  margin-bottom: 14px;
  --el-radio-button-checked-bg-color: rgba(99, 102, 241, 0.14);
  --el-radio-button-checked-text-color: var(--accent-text);
  --el-radio-button-checked-border-color: rgba(99, 102, 241, 0.36);
  --el-radio-button-input-border-color: rgba(99, 102, 241, 0.16);
}

.view-toggle :deep(.el-radio-button) {
  width: 50%;
}

.view-toggle :deep(.el-radio-button__inner) {
  width: 100%;
  padding: 8px 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  background: rgba(99, 102, 241, 0.03);
  border-color: rgba(99, 102, 241, 0.16);
  color: var(--text-on-dark-secondary);
  transition: all 0.2s ease;
}

.view-toggle :deep(.el-radio-button__inner:hover) {
  color: var(--text-on-dark);
}

/* 搜索跳转闪烁高亮（Phase 3）：通过 DOM 操作附加到 el-tree 当前节点 */
:deep(.cat-flash) {
  animation: cat-flash-anim 1.5s ease-out;
}

@keyframes cat-flash-anim {
  0% { background: rgba(99, 102, 241, 0.40); }
  60% { background: rgba(99, 102, 241, 0.16); }
  100% { background: transparent; }
}
</style>
