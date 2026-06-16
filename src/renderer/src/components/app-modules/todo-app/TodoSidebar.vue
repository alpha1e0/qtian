<template>
  <div class="todo-sidebar-inner">
    <el-radio-group v-model="view" size="small" class="view-toggle">
      <el-radio-button label="category">分类</el-radio-button>
      <el-radio-button label="label">标签</el-radio-button>
    </el-radio-group>

    <TodoCategoryTree
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
</style>
