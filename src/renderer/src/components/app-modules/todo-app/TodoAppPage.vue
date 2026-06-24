<template>
  <div class="todo-app-page">
    <!-- 顶部搜索栏（Phase 3）：横跨三栏上方 -->
    <div class="search-bar-row">
      <TodoSearchBar @jump-to-result="handleJumpToResult" />
    </div>

    <!-- 三栏布局：左导航 / 中待办项目 / 右详情 -->
    <div class="columns-row">
      <!-- 左侧导航：分类+待办项目 统一树 / 标签云 -->
      <TodoSidebar
        ref="sidebar"
        class="todo-sidebar"
        :category-tree="mergedTree"
        :labels="labels"
        :selected-node-key="currentNodeKey"
        :selected-label-id="selectedLabelId"
        @tree-select="handleTreeSelect"
        @create-category="handleCreateCategory"
        @rename-category="handleRenameCategory"
        @delete-category="handleDeleteCategory"
        @create-list="handleCreateListUnderCategory"
        @rename-list="handleRenameList"
        @delete-list="handleDeleteList"
        @import-list="handleImportList"
        @export-list="handleExportList"
        @select-label="handleSelectLabel"
        @open-trash="trashDialogVisible = true"
      />

      <!--
        中间面板：todo_list + todo_item 树（受控组件）。
        始终渲染，由 listId / labelId props 驱动内部展示分支：
          - labelId 命中 → 标签关联条目列表
          - listId 命中 → item 树
          - 都为 null → 空状态（用户未在侧边栏选中 list）
        item-detail / category-detail / document-editor 等视图由右侧列独立承载，
        中间列在这些视图下保留原 list 上下文，避免用户切换详情后列表消失。
      -->
      <TodoListPanel
        ref="listPanel"
        class="todo-list-panel"
        :list-id="selectedListId"
        :list-name="selectedListName"
        :label-id="selectedLabelId"
        :selected-item-id="selectedItemId"
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
        @run-task="openRunDialog('run')"
        @view-task="openTaskPanel"
        @rerun-task="openRunDialog('rerun')"
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
      <TaskPanel
        v-else-if="rightPanelView === 'task-panel'"
        :key="`task-${taskPanelTaskId}`"
        class="todo-item-detail todo-item-detail-wide"
        :item-id="selectedItemId"
        :task-id="taskPanelTaskId"
        @back="handleTaskPanelBack"
        @open-doc="openDoc"
        @select-task="handleSelectTask"
      />
      <div v-else class="todo-item-detail todo-item-detail-empty">
        <el-empty description="选择一个待办条目或分类查看详情" />
      </div>
    </div>

    <!-- 回收站对话框（Phase 4） -->
    <TrashDialog
      v-model:visible="trashDialogVisible"
      @restored="handleTrashRestored"
      @purged="handleTrashChanged"
      @emptied="handleTrashChanged"
    />

    <!-- 任务运行对话框（Phase 5） -->
    <TaskRunDialog
      v-model:visible="taskDialogVisible"
      :mode="taskDialogMode"
      :item-id="selectedItemId"
      @confirm="handleTaskConfirm"
    />
  </div>
</template>

<script>
import TodoSidebar from './TodoSidebar.vue';
import TodoListPanel from './TodoListPanel.vue';
import TodoItemDetail from './TodoItemDetail.vue';
import TodoCategoryDetail from './TodoCategoryDetail.vue';
import TodoDocumentEditor from './TodoDocumentEditor.vue';
import TodoSearchBar from './TodoSearchBar.vue';
import TrashDialog from './TrashDialog.vue';
import TaskRunDialog from './TaskRunDialog.vue';
import TaskPanel from './TaskPanel.vue';
import { ElMessage, ElMessageBox } from 'element-plus';

export default {
  name: 'TodoAppPage',
  components: { TodoSidebar, TodoListPanel, TodoItemDetail, TodoCategoryDetail, TodoDocumentEditor, TodoSearchBar, TrashDialog, TaskRunDialog, TaskPanel },
  data() {
    return {
      categoryTree: [],
      // 全量 todo_list（不按 category 分批拉，避免多次 IPC；用于 mergedTree 组装）
      allTodoLists: [],
      labels: [],
      selectedCategoryId: null,
      selectedLabelId: null,
      selectedListId: null,
      selectedItemId: null,
      // 右侧视图状态机：'empty' | 'item-detail' | 'item-tree' | 'category-detail' | 'label-items' | 'document-editor' | 'task-panel'
      rightPanelView: 'empty',
      // 当前打开的文档上下文（编辑器视图使用）
      activeDoc: null,
      // 强制右侧详情组件刷新（文档保存后刷新关联列表）
      detailKey: 0,
      // 回收站对话框（Phase 4）
      trashDialogVisible: false,
      // 任务运行对话框（Phase 5）
      taskDialogVisible: false,
      taskDialogMode: 'run',
      taskPanelTaskId: null,
    };
  },
  computed: {
    /** 从 categoryTree 中递归解析当前分类名称（用于 TodoCategoryDetail 标题与 titlePath） */
    selectedCategoryName() {
      if (!this.selectedCategoryId) return '';
      return this.findCategoryName(this.categoryTree, this.selectedCategoryId) || '';
    },
    /**
     * 从 allTodoLists 中查当前 todo_list 名称（用于 TodoListPanel 顶部标题）。
     * 取代原 TodoListPanel 内部 todoLists/currentListName 的本地状态。
     */
    selectedListName() {
      if (!this.selectedListId) return '';
      const found = this.allTodoLists.find((l) => l.id === this.selectedListId);
      return found ? found.name : '';
    },
    /**
     * 合并 category + todo_list 为统一树（D1）。
     * category 作为分支节点，其下 todo_list 作为叶子节点。
     * 深拷贝避免污染 categoryTree 原始数据；todo_list 节点用复合 nodeKey 区分。
     */
    mergedTree() {
      return this.buildMergedTree(this.categoryTree);
    },
    /**
     * el-tree 的 current-node-key（D2）。
     * 按 rightPanelView 与选中态返回 `cat_${id}` / `list_${id}` 字符串。
     * 未命中时返回 null（el-tree 不高亮任何节点）。
     */
    currentNodeKey() {
      if (this.rightPanelView === 'item-tree' && this.selectedListId) {
        return `list_${this.selectedListId}`;
      }
      if (
        (this.rightPanelView === 'category-detail' || this.rightPanelView === 'item-detail') &&
        this.selectedCategoryId
      ) {
        return `cat_${this.selectedCategoryId}`;
      }
      return null;
    },
  },
  async mounted() {
    await Promise.all([
      this.loadCategoryTree(),
      this.loadLabels(),
      this.loadAllTodoLists(),
    ]);
    // 首次进入自动选中首个顶层分类，让右侧立即展示 TodoCategoryDetail，
    // 避免初始空状态（设计意图见 spec §配置 default_category_id）。
    if (Array.isArray(this.categoryTree) && this.categoryTree.length > 0) {
      this.handleSelectCategory(this.categoryTree[0].id);
    }
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
    /**
     * 一次性加载全部 todo_list（不按 category 分批拉）。
     * mergedTree computed 在渲染时按 category_id 分组挂载到对应 category 节点。
     */
    async loadAllTodoLists() {
      try {
        // listTodoLists() 无参 = 全部
        this.allTodoLists = await window.todoApp.listTodoLists();
      } catch (err) {
        ElMessage.error('加载待办项目失败');
        console.error(err);
      }
    },
    /**
     * 递归构建 mergedTree（D1）。
     * 对每个 category 深拷贝并挂上 __type/category_id 过滤后的 todo_list 叶子。
     * todo_list 节点字段：{ __type: 'list', nodeKey: 'list_<id>', id, name, category_id }
     * category 节点字段：{ __type: 'category', nodeKey: 'cat_<id>', id, name, children: [...] }
     *
     * @param {Array} nodes - 原 categoryTree 节点数组
     * @returns {Array} 带 __type/nodeKey 的统一树
     */
    buildMergedTree(nodes) {
      if (!Array.isArray(nodes)) return [];
      return nodes.map((node) => {
        const catNode = {
          __type: 'category',
          nodeKey: `cat_${node.id}`,
          id: node.id,
          name: node.name,
          children: [],
        };
        // 先递归子分类
        catNode.children = this.buildMergedTree(node.children);
        // 再把直属该 category 的 todo_list 作为叶子追加（放在子分类之后）
        const lists = this.allTodoLists
          .filter((l) => l.category_id === node.id)
          .map((l) => ({
            __type: 'list',
            nodeKey: `list_${l.id}`,
            id: l.id,
            name: l.name,
            category_id: node.id,
          }));
        catNode.children.push(...lists);
        return catNode;
      });
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
    /**
     * 统一树节点点击分流（D5）。
     * payload: { type: 'category' | 'list', id }
     * - category → 切到 category-detail
     * - list     → 切到 item-tree（中间面板显示 item 树）
     */
    handleTreeSelect(payload) {
      if (!payload || !payload.type) return;
      if (payload.type === 'category') {
        this.handleSelectCategory(payload.id);
      } else if (payload.type === 'list') {
        this.handleSelectList(payload.id);
      }
    },
    handleSelectCategory(categoryId) {
      this.selectedCategoryId = categoryId;
      this.selectedLabelId = null;
      // D7：切换 category 时清空 list 与 item，避免上一个 list 的 item 高亮残留
      this.selectedListId = null;
      this.selectedItemId = null;
      this.activeDoc = null;
      this.rightPanelView = categoryId ? 'category-detail' : 'empty';
    },
    handleSelectLabel(labelId) {
      this.selectedLabelId = labelId;
      this.selectedCategoryId = null;
      this.selectedListId = null;
      this.selectedItemId = null;
      this.activeDoc = null;
      // 标签视图：中间面板切换到「标签关联条目列表」模式
      this.rightPanelView = labelId ? 'label-items' : 'empty';
    },
    /**
     * 选中待办项目（来自侧边栏 list 节点点击）。
     * 切到 item-tree 视图；同时把 category 设为该 list 的归属分类，
     * 让 TodoCategoryDetail 在 list 无条目时仍能反映归属关系（通过 selectedListName 推导）。
     */
    handleSelectList(listId) {
      const list = this.allTodoLists.find((l) => l.id === listId);
      this.selectedListId = listId;
      // D7：切换 list 时清空 item，避免上一个 list 的 item 高亮残留
      this.selectedItemId = null;
      this.activeDoc = null;
      this.selectedLabelId = null;
      // 同步 category 上下文（编辑器/详情回退要用）
      this.selectedCategoryId = list?.category_id ?? null;
      this.rightPanelView = listId ? 'item-tree' : 'empty';
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
        await ElMessageBox.confirm('删除分类将级联删除其下所有待办项目和待办条目（软删除），确认？', '确认删除', {
          type: 'warning',
        });
        await window.todoApp.deleteCategory(id);
        await Promise.all([this.loadCategoryTree(), this.loadAllTodoLists()]);
        if (this.selectedCategoryId === id) {
          this.selectedCategoryId = null;
          this.selectedListId = null;
          this.rightPanelView = 'empty';
        }
        ElMessage.success('已删除');
      } catch (err) {
        if (err !== 'cancel') {
          ElMessage.error(err.message || '删除失败');
        }
      }
    },
    /**
     * 在指定 category 下新建 todo_list（取代原 TodoListPanel.handleCreateList）。
     * payload: { categoryId, name? } —— name 省略时弹 prompt 询问。
     * 创建成功后刷新 allTodoLists 并自动选中新建的 list。
     */
    async handleCreateListUnderCategory(payload) {
      const categoryId = payload?.categoryId;
      if (!categoryId) {
        ElMessage.warning('请先选择分类');
        return;
      }
      let name = payload?.name;
      try {
        if (!name) {
          const res = await ElMessageBox.prompt('请输入待办项目名称', '新建待办项目', {
            confirmButtonText: '创建',
            cancelButtonText: '取消',
          });
          name = res.value;
        }
        if (name && name.trim()) {
          const created = await window.todoApp.createTodoList({
            name: name.trim(),
            category_id: categoryId,
          });
          await this.loadAllTodoLists();
          // 自动选中并切到 item-tree 视图
          this.handleSelectList(created.id);
          ElMessage.success('待办项目已创建');
        }
      } catch (err) {
        if (err !== 'cancel') {
          ElMessage.error(err.message || '创建失败');
        }
      }
    },
    async handleRenameList({ id, name }) {
      try {
        await window.todoApp.updateTodoList(id, { name });
        await this.loadAllTodoLists();
        ElMessage.success('已重命名');
      } catch (err) {
        ElMessage.error(err.message || '重命名失败');
      }
    },
    async handleDeleteList(id) {
      try {
        await ElMessageBox.confirm('删除待办项目将级联删除其下所有待办条目（软删除），确认？', '确认删除', {
          type: 'warning',
        });
        await window.todoApp.deleteTodoList(id);
        await this.loadAllTodoLists();
        if (this.selectedListId === id) {
          this.selectedListId = null;
          this.selectedItemId = null;
          this.rightPanelView = this.selectedCategoryId ? 'category-detail' : 'empty';
        }
        ElMessage.success('已删除');
      } catch (err) {
        if (err !== 'cancel') {
          ElMessage.error(err.message || '删除失败');
        }
      }
    },
    /**
     * 导出待办项目为 JSON。
     * 主进程聚合 dialog + fs + exchange.serialize，返回 null 表示用户取消（静默）。
     */
    async handleExportList({ listId }) {
      try {
        const result = await window.todoApp.exportTodoList(listId);
        if (!result) return; // 用户取消 dialog
        ElMessage.success(`已导出到：${result.filePath}`);
      } catch (err) {
        ElMessage.error(err.message || '导出失败');
      }
    },
    /**
     * 从 JSON 导入待办项目到指定 category 下。
     * 成功后刷新 list 列表并自动选中新导入的 list。
     */
    async handleImportList({ categoryId }) {
      try {
        const result = await window.todoApp.importTodoList(categoryId);
        if (!result) return; // 用户取消 dialog
        await this.loadAllTodoLists();
        this.handleSelectList(result.listId);
        ElMessage.success(`已导入 ${result.itemCount} 个条目`);
      } catch (err) {
        ElMessage.error(err.message || '导入失败');
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
      // 表单字段（标题/状态等）变化后，强制中间面板刷新 itemTree，
      // 让列表项标题/状态等立即同步（否则用户改了标题，列表里还是旧值）。
      // TodoListPanel 只 watch listId（切 list 时刷新），selectedItemId 不变时
      // 不会自动 reload，所以这里显式调用 loadItemTree。
      this.$refs.listPanel?.loadItemTree?.();
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
     *   todo_list  → 反查 list.category_id 后切换 list 视图
     *   todo_item  → 反查 item.todo_list_id → list.category_id 后切换 + 滚动到 item
     *   document   → 打开文档编辑器
     */
    async handleJumpToResult(result) {
      if (!result) return;
      try {
        if (result.type === 'category') {
          this.selectedLabelId = null;
          this.selectedItemId = null;
          this.selectedListId = null;
          this.activeDoc = null;
          this.selectedCategoryId = result.id;
          this.rightPanelView = 'category-detail';
          await this.$nextTick();
          this.$refs.sidebar?.highlightCategory(result.id);
        } else if (result.type === 'todo_list') {
          // 直接切到 item-tree 视图，listPanel 由 v-if 挂载并 watch listId 自动 loadItemTree
          this.handleSelectList(result.id);
          await this.$nextTick();
          await this.$refs.listPanel?.focusTarget?.(result.id, null);
        } else if (result.type === 'todo_item') {
          const item = await window.todoApp.getTodoItem(result.id);
          if (!item) {
            ElMessage.warning('该待办条目不存在或已删除');
            return;
          }
          // 先切到 item-tree 让 listPanel 挂载、加载 item 树
          this.handleSelectList(item.todo_list_id);
          await this.$nextTick();
          await this.$refs.listPanel?.focusTarget?.(item.todo_list_id, item.id);
          // 滚动完成后再切到右侧 item-detail 视图
          this.selectedItemId = item.id;
          this.rightPanelView = 'item-detail';
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
    /**
     * 回收站单条恢复回调（Phase 4）：
     * 按 type 刷新对应源（categoryTree / labels）。
     * todo_item / todo_document 由所在面板组件自行 watch 刷新，
     * 这里不强制全量刷新避免打断用户当前视图。
     */
    async handleTrashRestored(item) {
      if (!item) return;
      if (item.type === 'category' || item.type === 'todo_list') {
        await Promise.all([this.loadCategoryTree(), this.loadAllTodoLists()]);
      }
      if (item.type === 'label') {
        await this.loadLabels();
      }
    },
    /** 回收站 purge / empty 后刷新 categoryTree + allTodoLists + labels（结构可能变化） */
    async handleTrashChanged() {
      await Promise.all([
        this.loadCategoryTree(),
        this.loadLabels(),
        this.loadAllTodoLists(),
      ]);
    },
    // ====================================================================
    // Phase 5：Todo 驱动 AI 任务
    // ====================================================================

    /** 打开运行 / 重跑任务对话框 */
    openRunDialog(mode) {
      this.taskDialogMode = mode;
      this.taskDialogVisible = true;
    },

    /** 打开任务面板：从 todo_item 取最新 agent_task_id */
    async openTaskPanel() {
      if (!this.selectedItemId) return;
      try {
        const item = await window.todoApp.getTodoItem(this.selectedItemId);
        if (!item || !item.agent_task_id) {
          ElMessage.warning('该待办条目尚未运行任务');
          return;
        }
        this.taskPanelTaskId = item.agent_task_id;
        this.rightPanelView = 'task-panel';
      } catch (err) {
        ElMessage.error(err?.message || '打开任务面板失败');
      }
    },

    /** 任务对话框确认：发起任务并切换到任务面板 */
    async handleTaskConfirm({ agentName, llmConfigName, extraPrompt }) {
      if (!this.selectedItemId) return;
      try {
        const view = await window.todoApp.createTaskFromItem(this.selectedItemId, {
          agentName,
          llmConfigName,
          extraPrompt,
        });
        this.taskPanelTaskId = view.id;
        this.rightPanelView = 'task-panel';
        // 强制 TodoItemDetail 刷新以反映新的 agent_task_id
        this.detailKey += 1;
      } catch (err) {
        ElMessage.error(err?.message || '任务创建失败');
      }
    },

    /** 任务面板返回：回到 todo_item 详情 */
    handleTaskPanelBack() {
      if (this.selectedItemId) {
        this.rightPanelView = 'item-detail';
        // 刷新详情以反映最新的 agent_task_id（任务结束后可能更新）
        this.detailKey += 1;
      } else {
        this.rightPanelView = 'empty';
      }
    },

    /** 任务面板内切换历史任务（TaskHistoryList 选择） */
    handleSelectTask(taskId) {
      this.taskPanelTaskId = taskId;
    },
  },
};
</script>

<style scoped>
/*
 * Aurora Library 视觉基调（浅色版）
 * --------------------------------------------------
 * 在统一的浅色纸张底（--surface-base / --surface-dark）之上叠加柔和极光氛围，
 * 让整个 todo-app 三栏呈现"漂浮于晨光纸面"的编辑级质感。
 * 渐变透明度较深色版降低，避免在浅底上喧宾夺主。
 */
.todo-app-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--surface-dark);
  color: var(--text-on-dark);
  isolation: isolate;
}

/* 氛围底层：双 radial-gradient 形成左上 / 右下两束极光
 * 通过 ::before 实现，避免污染主层 z-index 与事件命中 */
.todo-app-page::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(900px 540px at 8% -6%,
      rgba(99, 102, 241, 0.10),
      transparent 60%),
    radial-gradient(720px 480px at 102% 108%,
      rgba(139, 92, 246, 0.07),
      transparent 62%),
    radial-gradient(520px 360px at 50% 140%,
      rgba(99, 102, 241, 0.04),
      transparent 70%);
  opacity: 0.9;
}

/* 顶部搜索栏行（Phase 3）：横跨三栏 */
.search-bar-row {
  flex-shrink: 0;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.55) 0%,
    rgba(255, 255, 255, 0.15) 100%
  );
  border-bottom: 1px solid rgba(99, 102, 241, 0.14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: aurora-fade-down 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* 三栏布局行 */
.columns-row {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/*
 * 三栏布局：按 24 份分配，左:中:右 = 5:10:9
 * 用 flex 比例而不是固定 px，窗口缩放时三栏按权重等比伸缩。
 * min-width:0 让 flex 子项在内容（长文本）超出时仍可收缩，避免溢出。
 */
.todo-sidebar {
  position: relative;
  flex: 5;
  min-width: 0;
  border-right: 1px solid rgba(99, 102, 241, 0.12);
  /* 外层自身作为 flex column 容器，让 .todo-sidebar-inner 用 flex:1 填充；
   * 避免 height:100% 在 padding/border 上溢出导致 footer 被切 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(243, 241, 236, 0.55);
  animation: aurora-fade-up 0.5s 0.05s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.todo-list-panel {
  position: relative;
  flex: 10;
  min-width: 0;
  overflow: hidden;
  /* 与 .todo-sidebar 同款：作为 flex column 容器，让内部的 .list-panel-scroll
   * 用 flex:1 + min-height:0 锁定可滚动高度。
   * 注：TodoListPanel 组件根元素 .todo-list-panel-inner 因 Vue attribute inheritance
   * 与本 class 合并到同一 DOM 元素，真正的滚动容器是它内部的 .list-panel-scroll。 */
  display: flex;
  flex-direction: column;
  animation: aurora-fade-up 0.5s 0.12s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.todo-item-detail {
  position: relative;
  flex: 9;
  min-width: 0;
  border-left: 1px solid rgba(99, 102, 241, 0.12);
  overflow-y: auto;
  background: rgba(243, 241, 236, 0.55);
  animation: aurora-fade-up 0.5s 0.18s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* 文档编辑器视图：覆盖比例布局，固定 600px 以获得合理的编辑宽度 */
.todo-item-detail-wide {
  flex: 0 0 600px;
  min-width: 0;
  overflow: hidden;
}

.todo-item-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 空状态文案做轻微提亮，避免与背景过于接近 */
.todo-item-detail-empty :deep(.el-empty__description) {
  color: var(--text-on-dark-secondary);
  letter-spacing: 0.02em;
}

/* 入场动画关键帧 */
@keyframes aurora-fade-down {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes aurora-fade-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 尊重用户的动效偏好：减少动效时直接显示终态 */
@media (prefers-reduced-motion: reduce) {
  .search-bar-row,
  .todo-sidebar,
  .todo-list-panel,
  .todo-item-detail {
    animation: none;
  }
}
</style>
