<template>
  <div class="todo-sidebar-inner">
    <el-radio-group v-model="view" size="small" class="view-toggle">
      <el-radio-button label="category">分类</el-radio-button>
      <el-radio-button label="label">标签</el-radio-button>
    </el-radio-group>

    <TodoCategoryTree
      ref="categoryTree"
      v-if="view === 'category'"
      :tree-data="categoryTree"
      :selected-id="selectedCategoryId"
      @select="$emit('select-category', $event)"
      @create="$emit('create-category', $event)"
      @rename="$emit('rename-category', $event)"
      @delete="$emit('delete-category', $event)"
    />

    <TodoLabelCloud
      v-else
      :labels="labels"
      :selected-id="selectedLabelId"
      @select-label="$emit('select-label', $event)"
    />
  </div>
</template>

<script>
import TodoCategoryTree from './TodoCategoryTree.vue';
import TodoLabelCloud from './TodoLabelCloud.vue';

export default {
  name: 'TodoSidebar',
  components: { TodoCategoryTree, TodoLabelCloud },
  props: {
    categoryTree: { type: Array, default: () => [] },
    labels: { type: Array, default: () => [] },
    selectedCategoryId: { type: Number, default: null },
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
.todo-sidebar-inner {
  padding: 8px;
}

.view-toggle {
  width: 100%;
  margin-bottom: 12px;
}

.view-toggle :deep(.el-radio-button) {
  width: 50%;
}

.view-toggle :deep(.el-radio-button__inner) {
  width: 100%;
}

/* 搜索跳转闪烁高亮（Phase 3）：通过 DOM 操作附加到 el-tree 当前节点 */
:deep(.cat-flash) {
  animation: cat-flash-anim 1.5s ease-out;
}

@keyframes cat-flash-anim {
  0% { background: rgba(64, 158, 255, 0.35); }
  60% { background: rgba(64, 158, 255, 0.15); }
  100% { background: transparent; }
}
</style>
