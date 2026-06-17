<template>
  <div class="todo-app-page">
    <!-- 顶部搜索栏（Phase 3）：横跨三栏上方 -->
    <div class="search-bar-row">
      <TodoSearchBar @jump-to-result="handleJumpToResult" />
    </div>

    <!-- 三栏布局：左导航 / 中列表 / 右详情 -->
    <div class="columns-row">
      <!-- 左侧导航：分类树 / 标签云 -->
      <TodoSidebar
        ref="sidebar"
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
        ref="listPanel"
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
  </div>
</template>

<script>
import TodoSidebar from './TodoSidebar.vue';
import TodoListPanel from './TodoListPanel.vue';
import TodoItemDetail from './TodoItemDetail.vue';
import TodoCategoryDetail from './TodoCategoryDetail.vue';
import TodoDocumentEditor from './TodoDocumentEditor.vue';
import TodoSearchBar from './TodoSearchBar.vue';
import { ElMessage, ElMessageBox } from 'element-plus';

export default {
  name: 'TodoAppPage',
  components: { TodoSidebar, TodoListPanel, TodoItemDetail, TodoCategoryDetail, TodoDocumentEditor, TodoSearchBar },
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
    /**
     * 搜索结果跳转（Phase 3）：根据命中类型切换视图 + 滚动 + 高亮。
     *
     * 设计文档 §7.5：
     *   category   → 选中该 category + 中间显示其下 list + sidebar 闪烁高亮
     *   todo_list  → 反查 list.category_id 后切换 category + 滚动到该 list
     *   todo_item  → 反查 item.todo_list_id → list.category_id 后切换 + 滚动到 item
     *   document   → 打开文档编辑器
     */
    async handleJumpToResult(result) {
      if (!result) return;
      try {
        if (result.type === 'category') {
          this.selectedLabelId = null;
          this.selectedItemId = null;
          this.activeDoc = null;
          this.selectedCategoryId = result.id;
          this.rightPanelView = 'category-detail';
          await this.$nextTick();
          this.$refs.sidebar?.highlightCategory(result.id);
        } else if (result.type === 'todo_list') {
          const list = await window.todoApp.getTodoList(result.id);
          this.selectedLabelId = null;
          this.selectedItemId = null;
          this.activeDoc = null;
          this.selectedCategoryId = list?.category_id ?? null;
          await this.$nextTick();
          // 等待 listPanel 加载新分类下的 list 后聚焦目标 list
          await this.$refs.listPanel?.focusTarget(result.id, null);
          this.rightPanelView = this.selectedCategoryId ? 'category-detail' : 'empty';
        } else if (result.type === 'todo_item') {
          const item = await window.todoApp.getTodoItem(result.id);
          if (!item) {
            ElMessage.warning('该条目不存在或已删除');
            return;
          }
          const list = await window.todoApp.getTodoList(item.todo_list_id);
          this.selectedLabelId = null;
          this.activeDoc = null;
          this.selectedCategoryId = list?.category_id ?? null;
          this.selectedItemId = item.id;
          this.rightPanelView = 'item-detail';
          await this.$nextTick();
          await this.$refs.listPanel?.focusTarget(item.todo_list_id, item.id);
        } else if (result.type === 'document') {
          const doc = await window.todoApp.getDocument(result.id);
          if (!doc) {
            ElMessage.warning('该文档不存在或已删除');
            return;
          }
          this.activeDoc = {
            id: doc.id,
            itemId: doc.todo_item_id ?? null,
            categoryId: doc.todo_category_id ?? null,
            titlePath: result.category_path?.join(' / ') || doc.name,
          };
          this.rightPanelView = 'document-editor';
        }
      } catch (err) {
        console.error('jump to result failed', err);
        ElMessage.error('跳转失败');
      }
    },
  },
};
</script>

<style scoped>
.todo-app-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--surface-dark, #1e1e1e);
  color: var(--text-on-dark, #e0e0e0);
}

/* 顶部搜索栏行（Phase 3）：横跨三栏 */
.search-bar-row {
  flex-shrink: 0;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
}

/* 三栏布局行 */
.columns-row {
  flex: 1;
  display: flex;
  overflow: hidden;
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
