<template>
  <div class="todo-list-panel-inner">
    <!--
      内部滚动容器：根元素 .todo-list-panel-inner 因 Vue attribute inheritance
      会与父组件传入的 .todo-list-panel 合并到同一 DOM 元素，无法既当外层 wrapper
      （需要 overflow:hidden 裁切动画）又当滚动容器（需要 overflow-y:auto）。
      这里再分一层 .list-panel-scroll 专门承担滚动，与 TodoSidebar 的 .sidebar-scroll 同款。
    -->
    <div class="list-panel-scroll">
      <!-- 标签视图模式：显示标签关联的待办项目（todo_list）列表 -->
      <div v-if="labelId" class="label-items">
        <div class="section-title">标签关联待办项目</div>
        <div v-if="labelLists.length === 0" class="empty-hint">该标签暂无关联待办项目</div>
        <div
          v-for="list in labelLists"
          :key="list.id"
          class="label-list-card"
          :title="`查看「${list.name}」`"
          @click="$emit('select-list', list.id)"
        >
          <el-icon><Document /></el-icon>
          <div class="label-list-meta">
            <div class="label-list-name">{{ list.name }}</div>
            <div v-if="list.description" class="label-list-desc">{{ list.description }}</div>
          </div>
        </div>
      </div>

      <!-- 正常模式：选中 list 后展示 items 树 -->
      <div v-else-if="listId" class="item-tree-container">
        <div class="tree-toolbar">
          <!--
            list 名作为可点击入口：触发 select-list，让父组件切到右侧 list-detail。
            中间面板的 item 树仍保留（v-if 由 selectedListId 驱动，与 rightPanelView 解耦）。
          -->
          <span
            class="section-title list-name-link"
            :title="`查看「${listName}」项目详情`"
            @click="$emit('select-list', listId)"
          >{{ listName }}</span>
          <!-- 右侧图标按钮组：纯图标（无文字），title 提供语义 -->
          <div class="toolbar-actions">
            <el-button
              size="small"
              text
              class="toolbar-icon-btn"
              title="新建待办条目"
              @click="handleCreateRootItem"
            >
              <el-icon><Plus /></el-icon>
            </el-button>
            <el-button
              size="small"
              text
              class="toolbar-icon-btn"
              :class="{ 'is-active': isFilterActive }"
              :title="filterButtonTitle"
              @click="openFilterDialog"
            >
              <el-icon><Filter /></el-icon>
            </el-button>
          </div>
        </div>
        <div v-if="itemTree.length === 0" class="empty-hint">暂无待办条目，点击"新建"开始</div>
        <div v-else-if="filteredItemTree.length === 0" class="empty-hint">没有符合筛选条件的待办条目</div>
        <TodoItemRow
          v-for="node in filteredItemTree"
          :key="node.id"
          :item="node"
          :depth="node.depth"
          :children="node.children"
          :selected-item-id="selectedItemId"
          @toggle-status="handleToggleStatus"
          @select="$emit('select-item', $event)"
          @create-child="handleCreateChildItem"
          @delete="$emit('delete-item', $event)"
        />
      </div>

      <!-- 未选中待办项目 -->
      <div v-else class="empty-state">
        <el-empty description="请在左侧选择待办项目" />
      </div>
    </div>

    <!--
      筛选对话框：优先级 + 状态 select。
      草稿（draftFilter*）独立于生效值（filter*），「确定」应用、「取消」丢弃、「重置」清空草稿。
    -->
    <el-dialog
      v-model="filterDialogVisible"
      title="筛选"
      width="420px"
      :close-on-click-modal="false"
      append-to-body
    >
      <el-form label-width="72px" label-position="right" class="filter-form">
        <el-form-item label="优先级">
          <el-select v-model="draftFilterPriority" placeholder="选择优先级">
            <el-option label="所有" value="all" />
            <el-option label="紧急" value="urgent" />
            <el-option label="重要" value="important" />
            <el-option label="普通" value="normal" />
            <el-option label="提示" value="hint" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="draftFilterStatus" placeholder="选择状态">
            <el-option label="所有" value="all" />
            <el-option label="初始" value="init" />
            <el-option label="进行中" value="in_progress" />
            <el-option label="已完成" value="done" />
            <el-option label="已放弃" value="abandoned" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="filter-dialog-footer">
          <el-button @click="resetFilterDraft">重置</el-button>
          <el-button @click="filterDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="applyFilter">确定</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { Plus, Document, Filter } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import TodoItemRow from './TodoItemRow.vue';

export default {
  name: 'TodoListPanel',
  components: { Plus, Document, Filter, TodoItemRow },
  // select-list：顶部 list 名 / 标签视图下的 list 卡片被点击时触发，
  // 父组件切到右侧 list-detail 视图（中间 item 树保留或挂载）。
  // delete-item：行内删除按钮触发，交由父组件走确认 + IPC + 刷新流程。
  emits: ['select-item', 'toggle-status', 'select-list', 'delete-item'],
  props: {
    // 受控：当前 todo_list id（由父组件 selectedListId 驱动）
    listId: { type: Number, default: null },
    // 受控：list 名（由父组件从 allTodoLists 解析，避免本组件再持有 todoLists）
    listName: { type: String, default: '' },
    // 标签视图模式：传入 labelId 后切换到标签关联待办项目展示
    labelId: { type: Number, default: null },
    selectedItemId: { type: Number, default: null },
  },
  data() {
    return {
      itemTree: [],
      labelLists: [],
      // 筛选对话框可见性
      filterDialogVisible: false,
      // 当前生效的筛选值：'all' 表示不限制
      filterPriority: 'all',
      filterStatus: 'all',
      // 对话框草稿：编辑中尚未应用，确定时 copy 到生效值
      draftFilterPriority: 'all',
      draftFilterStatus: 'all',
    };
  },
  computed: {
    /** 任一维度非 'all' 即视为筛选激活，用于按钮强调与 title 文案 */
    isFilterActive() {
      return this.filterPriority !== 'all' || this.filterStatus !== 'all';
    },
    /** 筛选按钮的悬浮提示：激活时附加（已启用） */
    filterButtonTitle() {
      return this.isFilterActive ? '筛选（已启用）' : '筛选';
    },
    /**
     * 按当前筛选对 itemTree 递归过滤后的视图。
     *
     * 规则：节点自身匹配 或 任一后代匹配（递归）则保留，否则剔除。
     * 匹配后子树仅包含过滤后的子节点，避免显示不符合的子项。
     * 无筛选时直接返回原树引用，避免无谓深拷贝。
     */
    filteredItemTree() {
      if (!this.isFilterActive) return this.itemTree;
      return this.itemTree
        .map((node) => this.buildFilteredNode(node))
        .filter(Boolean);
    },
  },
  watch: {
    // 切换 list 时重新加载 item 树（D6 受控模式核心入口）
    listId() {
      this.loadItemTree();
    },
    labelId() {
      if (this.labelId) {
        this.loadLabelLists();
      } else {
        this.labelLists = [];
      }
    },
  },
  async mounted() {
    // 初次挂载若已有 listId（搜索跳转直达），立即加载 item 树
    if (this.listId) {
      await this.loadItemTree();
    } else if (this.labelId) {
      await this.loadLabelLists();
    }
  },
  methods: {
    /**
     * 加载当前 todo_list 的 item 树（含 depth/children）。
     *
     * 由 listId watcher、focusTarget、promptCreateItem、handleToggleStatus 调用。
     */
    async loadItemTree() {
      if (!this.listId) {
        this.itemTree = [];
        return;
      }
      try {
        this.itemTree = await window.todoApp.getTodoItemTree(this.listId);
      } catch (err) {
        ElMessage.error('加载待办条目树失败');
        console.error(err);
      }
    },
    /**
     * 聚焦目标 list + 滚动到指定 item（搜索跳转用，Phase 3）。
     *
     * 受控模式下 listId 由父组件设置并触发 watcher；此方法主要负责等待
     * item 树加载完成后的滚动与高亮，兼容旧调用约定。
     *
     * @param listId - 目标 todo_list id（应与当前 prop listId 一致）
     * @param itemId - 待滚动的 todo_item id（可选，不传则只 load item tree）
     */
    async focusTarget(listId, itemId) {
      if (!listId) return;
      // listId 与 prop 不一致时，由父组件控制；此处仅确保 item 树加载完毕
      if (this.listId !== listId) {
        // 父组件未同步，等待 nextTick 让 prop 传入
        await this.$nextTick();
      }
      await this.loadItemTree();
      await this.$nextTick();
      if (itemId) {
        this.scrollToItem(itemId);
      }
    },
    /**
     * 滚动到指定 item 并临时高亮（DOM 操作）。
     * 通过 item id 在 DOM 中查找行并滚动到可视区，附加临时 flash class。
     */
    scrollToItem(itemId) {
      // 多次 nextTick 保证 DOM 已渲染
      this.$nextTick(() => {
        const root = this.$el;
        if (!root) return;
        // 通过 data 属性定位 item 行（TodoItemRow 根节点标记 data-item-id）
        const target = root.querySelector(`[data-item-id="${itemId}"]`);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('flash-highlight');
        setTimeout(() => {
          target.classList.remove('flash-highlight');
        }, 1500);
      });
    },
    async loadLabelLists() {
      try {
        this.labelLists = await window.todoApp.listTodoListsByLabel(this.labelId);
      } catch (err) {
        ElMessage.error('加载标签待办项目失败');
        console.error(err);
      }
    },
    async handleCreateRootItem() {
      await this.promptCreateItem(null);
    },
    async handleCreateChildItem(parentId) {
      await this.promptCreateItem(parentId);
    },
    async promptCreateItem(parentId) {
      // 受控模式下 listId 由父传入；无 listId 时禁止创建（不再有内置"新建项目"）
      if (!this.listId) {
        ElMessage.warning('请先在左侧选择待办项目');
        return;
      }
      try {
        const { value } = await ElMessageBox.prompt('请输入待办条目标题', '新建待办条目', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (value && value.trim()) {
          const created = await window.todoApp.createTodoItem({
            title: value.trim(),
            todo_list_id: this.listId,
            parent_id: parentId,
          });
          await this.loadItemTree();
          // 创建后立即选中新条目：
          // - 触发父组件 handleSelectItem → rightPanelView='item-detail' 显示详情
          // - selectedItemId 变化回流为本组件 :selected-item-id，新条目在列表中高亮
          // 必须在 loadItemTree 之后 emit，否则新条目还没渲染，selectedItemId 高亮无的放矢
          this.$emit('select-item', created.id);
          ElMessage.success('待办条目已创建');
        }
      } catch (err) {
        if (err !== 'cancel') {
          ElMessage.error(err.message || '创建失败');
        }
      }
    },
    async handleToggleStatus(payload) {
      this.$emit('toggle-status', payload);
      await this.loadItemTree();
    },
    /** 打开筛选对话框：把当前生效值同步到草稿，编辑期间不影响已生效筛选 */
    openFilterDialog() {
      this.draftFilterPriority = this.filterPriority;
      this.draftFilterStatus = this.filterStatus;
      this.filterDialogVisible = true;
    },
    /** 确定：把草稿写入生效值并关闭对话框 */
    applyFilter() {
      this.filterPriority = this.draftFilterPriority;
      this.filterStatus = this.draftFilterStatus;
      this.filterDialogVisible = false;
    },
    /** 重置：仅清空草稿，需要再点「确定」才生效 */
    resetFilterDraft() {
      this.draftFilterPriority = 'all';
      this.draftFilterStatus = 'all';
    },
    /** 判断节点自身是否满足当前筛选条件 */
    matchesFilter(node) {
      if (!node) return false;
      if (this.filterPriority !== 'all' && node.priority !== this.filterPriority) return false;
      if (this.filterStatus !== 'all' && node.status !== this.filterStatus) return false;
      return true;
    },
    /**
     * 递归构造过滤后的节点副本。
     * 自身匹配或任一后代（递归过滤后）存在则返回新节点（children 为过滤后子树），否则返回 null。
     */
    buildFilteredNode(node) {
      if (!node) return null;
      const rawChildren = Array.isArray(node.children) ? node.children : [];
      const filteredChildren = rawChildren
        .map((child) => this.buildFilteredNode(child))
        .filter(Boolean);
      if (this.matchesFilter(node) || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    },
  },
};
</script>

<style scoped>
/*
 * 三段式布局（与 TodoSidebar 的 sidebar-top/sidebar-scroll 同款）：
 *   .todo-list-panel (来自父组件 TodoAppPage；flex:10, display:flex column, overflow:hidden)
 *     └─ .todo-list-panel-inner (与 .todo-list-panel 合并到同一 DOM 元素：Vue attribute inheritance)
 *          └─ .list-panel-scroll (flex:1, min-height:0, overflow-y:auto) ← 真正的滚动容器
 *
 * 之前的 bug：根元素既当外层 wrapper 又当滚动容器，导致 overflow:hidden 与 overflow-y:auto
 * 落到同一元素互相覆盖，条目多时滚动条不触发，新建项被裁切。
 */
.todo-list-panel-inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 真正的滚动容器：承担所有可滚动内容（items） */
.list-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 18px 24px;
}

/* 章节标题：editorial eyebrow */
.section-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding: 0 2px;
}

.tree-toolbar .section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-on-dark, #e4e4ed);
  letter-spacing: 0.02em;
  text-transform: none;
}

/* 右侧图标按钮组：纯图标（无文字），title 提供语义 */
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-icon-btn {
  color: var(--text-on-dark-muted, #5c5b72);
  transition: color 0.18s ease, background 0.18s ease;
}

.toolbar-icon-btn:hover {
  color: var(--accent, #6366f1);
}

/* 筛选激活：按钮 accent 强调，提示用户当前视图处于过滤状态 */
.toolbar-icon-btn.is-active {
  color: var(--accent, #6366f1);
}

/*
 * list 名作为右侧详情的入口：hover 加下划线 + 着色提示，
 * 让用户感知"点击可查看项目详情"，与右键菜单的重命名入口解耦。
 */
.list-name-link {
  cursor: pointer;
  transition: color 0.18s ease, text-decoration-color 0.18s ease;
  text-decoration: underline transparent;
}

.list-name-link:hover {
  color: var(--accent, #6366f1);
  text-decoration-color: var(--accent, #6366f1);
}

.empty-hint {
  color: var(--text-on-dark-muted, #5c5b72);
  font-size: 13px;
  font-style: italic;
  padding: 18px 4px;
  letter-spacing: 0.02em;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.empty-state :deep(.el-empty__description) {
  color: var(--text-on-dark-secondary, #8b8aa0);
  letter-spacing: 0.02em;
}

/* 标签视图区域标题：保持与列表名一致的子标题权重 */
.label-items .section-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-on-dark, #e4e4ed);
  text-transform: none;
  letter-spacing: 0.02em;
  padding: 0 2px;
  margin-bottom: 10px;
}

/* 标签视图下的待办项目卡片：点击切到右侧 list-detail */
.label-list-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.08);
  transition: all 0.18s ease;
  margin-bottom: 8px;
}

.label-list-card:hover {
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.22);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.10);
}

.label-list-card :deep(.el-icon) {
  color: var(--accent);
  flex-shrink: 0;
  margin-top: 2px;
}

.label-list-meta {
  flex: 1;
  min-width: 0;
}

.label-list-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-on-dark, #e4e4ed);
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.label-list-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-on-dark-muted, #5c5b72);
  letter-spacing: 0.01em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 筛选对话框：表单宽度收敛 + footer 三按钮右对齐（重置/取消/确定） */
.filter-form {
  padding: 4px 4px 0;
}

.filter-form :deep(.el-select) {
  width: 100%;
}

.filter-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}
</style>
