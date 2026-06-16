<template>
  <div class="todo-app-page">
    <!-- 左侧导航：分类树 / 标签云 -->
    <TodoSidebar
      class="todo-sidebar"
      :category-tree="categoryTree"
      :labels="labels"
      :selected-category-id="selectedCategoryId"
      :selected-label-id="selectedLabelId"
      @select-category="handleSelectCategory"
      @create-category="handleCreateCategory"
      @rename-category="handleRenameCategory"
      @delete-category="handleDeleteCategory"
      @select-label="handleSelectLabel"
    />

    <!-- 中间面板：todo_list + todo_item 树 -->
    <TodoListPanel
      class="todo-list-panel"
      :category-id="selectedCategoryId"
      :label-id="selectedLabelId"
      :selected-item-id="selectedItemId"
      @select-list="handleSelectList"
      @select-item="handleSelectItem"
      @toggle-status="handleToggleStatus"
    />

    <!-- 右侧详情 -->
    <TodoItemDetail
      v-if="selectedItemId"
      class="todo-item-detail"
      :item-id="selectedItemId"
      @updated="handleItemUpdated"
    />
    <div v-else class="todo-item-detail todo-item-detail-empty">
      <el-empty description="选择一个待办条目查看详情" />
    </div>
  </div>
</template>

<script>
import TodoSidebar from './TodoSidebar.vue';
import TodoListPanel from './TodoListPanel.vue';
import TodoItemDetail from './TodoItemDetail.vue';
import { ElMessage, ElMessageBox } from 'element-plus';

export default {
  name: 'TodoAppPage',
  components: { TodoSidebar, TodoListPanel, TodoItemDetail },
  data() {
    return {
      categoryTree: [],
      labels: [],
      selectedCategoryId: null,
      selectedLabelId: null,
      selectedListId: null,
      selectedItemId: null,
    };
  },
  async mounted() {
    await Promise.all([this.loadCategoryTree(), this.loadLabels()]);
  },
  methods: {
    async loadCategoryTree() {
      try {
        this.categoryTree = await window.todoApp.getCategoryTree();
      } catch (err) {
        ElMessage.error('加载分类失败');
        console.error(err);
      }
    },
    async loadLabels() {
      try {
        this.labels = await window.todoApp.listLabels();
      } catch (err) {
        ElMessage.error('加载标签失败');
        console.error(err);
      }
    },
    handleSelectCategory(categoryId) {
      this.selectedCategoryId = categoryId;
      this.selectedLabelId = null;
      this.selectedItemId = null;
    },
    handleSelectLabel(labelId) {
      this.selectedLabelId = labelId;
      this.selectedCategoryId = null;
      this.selectedItemId = null;
    },
    async handleCreateCategory({ name, parentId }) {
      try {
        await window.todoApp.createCategory({ name, parent_id: parentId });
        await this.loadCategoryTree();
        ElMessage.success('分类已创建');
      } catch (err) {
        ElMessage.error(err.message || '创建失败');
      }
    },
    async handleRenameCategory({ id, name }) {
      try {
        await window.todoApp.updateCategory(id, { name });
        await this.loadCategoryTree();
        ElMessage.success('已重命名');
      } catch (err) {
        ElMessage.error(err.message || '重命名失败');
      }
    },
    async handleDeleteCategory(id) {
      try {
        await ElMessageBox.confirm('删除分类将级联删除其下所有列表和条目（软删除），确认？', '确认删除', {
          type: 'warning',
        });
        await window.todoApp.deleteCategory(id);
        await this.loadCategoryTree();
        if (this.selectedCategoryId === id) {
          this.selectedCategoryId = null;
        }
        ElMessage.success('已删除');
      } catch (err) {
        if (err !== 'cancel') {
          ElMessage.error(err.message || '删除失败');
        }
      }
    },
    handleSelectList(listId) {
      this.selectedListId = listId;
      this.selectedItemId = null;
    },
    handleSelectItem(itemId) {
      this.selectedItemId = itemId;
    },
    async handleToggleStatus({ id, status }) {
      try {
        await window.todoApp.updateTodoItemStatus(id, status);
      } catch (err) {
        ElMessage.error(err.message || '状态更新失败');
      }
    },
    handleItemUpdated() {
      // 详情更新后可触发列表刷新（由 TodoListPanel 自行刷新）
    },
  },
};
</script>

<style scoped>
.todo-app-page {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--surface-dark, #1e1e1e);
  color: var(--text-on-dark, #e0e0e0);
}

.todo-sidebar {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  overflow-y: auto;
}

.todo-list-panel {
  flex: 1;
  overflow: hidden;
}

.todo-item-detail {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  overflow-y: auto;
}

.todo-item-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
