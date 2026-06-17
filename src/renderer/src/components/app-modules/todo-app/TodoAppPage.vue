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

    <!-- 右侧详情：状态机路由 -->
    <TodoItemDetail
      v-if="rightPanelView === 'item-detail'"
      :key="`item-${selectedItemId}-${detailKey}`"
      class="todo-item-detail"
      :item-id="selectedItemId"
      @updated="handleItemUpdated"
      @open-doc="openDoc"
    />
    <TodoCategoryDetail
      v-else-if="rightPanelView === 'category-detail'"
      :key="`cat-${selectedCategoryId}-${detailKey}`"
      class="todo-item-detail"
      :category-id="selectedCategoryId"
      :category-name="selectedCategoryName"
      @open-doc="openDoc"
    />
    <TodoDocumentEditor
      v-else-if="rightPanelView === 'document-editor'"
      class="todo-item-detail todo-item-detail-wide"
      :doc-id="activeDoc?.id ?? null"
      :item-id="activeDoc?.itemId ?? null"
      :category-id="activeDoc?.categoryId ?? null"
      :title-path="activeDoc?.titlePath ?? ''"
      @back="handleEditorBack"
      @saved="handleDocSaved"
    />
    <div v-else class="todo-item-detail todo-item-detail-empty">
      <el-empty description="选择一个待办条目或分类查看详情" />
    </div>
  </div>
</template>

<script>
import TodoSidebar from './TodoSidebar.vue';
import TodoListPanel from './TodoListPanel.vue';
import TodoItemDetail from './TodoItemDetail.vue';
import TodoCategoryDetail from './TodoCategoryDetail.vue';
import TodoDocumentEditor from './TodoDocumentEditor.vue';
import { ElMessage, ElMessageBox } from 'element-plus';

export default {
  name: 'TodoAppPage',
  components: { TodoSidebar, TodoListPanel, TodoItemDetail, TodoCategoryDetail, TodoDocumentEditor },
  data() {
    return {
      categoryTree: [],
      labels: [],
      selectedCategoryId: null,
      selectedLabelId: null,
      selectedListId: null,
      selectedItemId: null,
      // 右侧视图状态机：'empty' | 'item-detail' | 'category-detail' | 'document-editor'
      rightPanelView: 'empty',
      // 当前打开的文档上下文（编辑器视图使用）
      activeDoc: null,
      // 强制右侧详情组件刷新（文档保存后刷新关联列表）
      detailKey: 0,
    };
  },
  computed: {
    /** 从 categoryTree 中递归解析当前分类名称（用于 TodoCategoryDetail 标题与 titlePath） */
    selectedCategoryName() {
      if (!this.selectedCategoryId) return '';
      return this.findCategoryName(this.categoryTree, this.selectedCategoryId) || '';
    },
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
    /** 递归查找分类名称（树可能为空或多层） */
    findCategoryName(nodes, targetId) {
      if (!Array.isArray(nodes)) return '';
      for (const node of nodes) {
        if (node.id === targetId) return node.name;
        const found = this.findCategoryName(node.children, targetId);
        if (found) return found;
      }
      return '';
    },
    handleSelectCategory(categoryId) {
      this.selectedCategoryId = categoryId;
      this.selectedLabelId = null;
      this.selectedItemId = null;
      this.activeDoc = null;
      this.rightPanelView = categoryId ? 'category-detail' : 'empty';
    },
    handleSelectLabel(labelId) {
      this.selectedLabelId = labelId;
      this.selectedCategoryId = null;
      this.selectedItemId = null;
      this.activeDoc = null;
      // 标签视图暂无独立详情面板，先回退到 empty
      this.rightPanelView = 'empty';
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
          this.rightPanelView = 'empty';
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
      this.activeDoc = null;
      // 选中列表但未选条目时，根据是否有分类决定回退到分类详情或空
      if (this.selectedCategoryId) {
        this.rightPanelView = 'category-detail';
      } else {
        this.rightPanelView = 'empty';
      }
    },
    handleSelectItem(itemId) {
      this.selectedItemId = itemId;
      this.activeDoc = null;
      this.rightPanelView = 'item-detail';
    },
    async handleToggleStatus({ id, status }) {
      try {
        await window.todoApp.updateTodoItemStatus(id, status);
      } catch (err) {
        ElMessage.error(err.message || '状态更新失败');
      }
    },
    handleItemUpdated() {
      // TodoListPanel 自行 watch categoryId/currentListId 刷新；这里仅作为事件出口
    },
    /**
     * 子组件请求打开文档：切换到编辑器视图。
     * payload: { id?, itemId?, categoryId?, titlePath }
     */
    openDoc(payload) {
      this.activeDoc = {
        id: payload.id ?? null,
        itemId: payload.itemId ?? null,
        categoryId: payload.categoryId ?? null,
        titlePath: payload.titlePath ?? '',
      };
      this.rightPanelView = 'document-editor';
    },
    /** 编辑器返回：依据 activeDoc 上下文回退到上一级视图 */
    handleEditorBack() {
      if (this.activeDoc?.itemId) {
        this.rightPanelView = 'item-detail';
      } else if (this.activeDoc?.categoryId) {
        this.rightPanelView = 'category-detail';
      } else if (this.selectedItemId) {
        this.rightPanelView = 'item-detail';
      } else if (this.selectedCategoryId) {
        this.rightPanelView = 'category-detail';
      } else {
        this.rightPanelView = 'empty';
      }
      this.activeDoc = null;
    },
    /** 文档保存后刷新对应源详情（通过 :key 强制重渲染） */
    handleDocSaved() {
      this.detailKey += 1;
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

/* 文档编辑器视图：右侧扩展到 600px 以获得更合理的编辑宽度 */
.todo-item-detail-wide {
  width: 600px;
  overflow: hidden;
}

.todo-item-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
