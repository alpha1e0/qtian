<template>
  <div class="todo-list-panel-inner">
    <!--
      内部滚动容器：根元素 .todo-list-panel-inner 因 Vue attribute inheritance
      会与父组件传入的 .todo-list-panel 合并到同一 DOM 元素，无法既当外层 wrapper
      （需要 overflow:hidden 裁切动画）又当滚动容器（需要 overflow-y:auto）。
      这里再分一层 .list-panel-scroll 专门承担滚动，与 TodoSidebar 的 .sidebar-scroll 同款。
    -->
    <div class="list-panel-scroll">
      <!-- 正常模式：选中 list 后展示 items 树 -->
      <div v-if="listId" class="item-tree-container">
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
            <el-button-group>
              <el-button
                text
                class="toolbar-icon-btn"
                title="新建待办条目"
                @click="handleCreateRootItem"
              >
                <el-icon><Plus /></el-icon>
              </el-button>
              <el-button
                text
                class="toolbar-icon-btn"
                :class="{ 'is-active': isFilterActive }"
                :title="filterButtonTitle"
                @click="openFilterDialog"
              >
                <el-icon><Filter /></el-icon>
              </el-button>
            </el-button-group>
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
      筛选对话框：优先级（el-check-tag，配色与新建条目 priority-radio 一致）
      + 状态（el-checkbox-group）。
      草稿（draftFilter*）独立于生效值（filter*），「确定」应用、「取消」丢弃、「重置」清空草稿。
      视觉沿用 TodoCreateDialog 的 Aurora 浅色基调，保持对话框家族一致。
    -->
    <el-dialog
      v-model="filterDialogVisible"
      width="440px"
      :show-close="true"
      :close-on-click-modal="false"
      append-to-body
      class="todo-filter-dialog"
    >
      <!-- 自定义标题：图标 + 主标题 + 副标题，与 TodoCreateDialog 同结构 -->
      <template #header>
        <div class="filter-dialog-header">
          <div class="header-icon-wrap">
            <el-icon class="header-icon"><Filter /></el-icon>
          </div>
          <div class="header-text">
            <div class="header-title">筛选待办条目</div>
            <div class="header-subtitle">按优先级或状态缩小视图范围</div>
          </div>
        </div>
      </template>

      <el-form label-position="top" size="small" class="filter-form">
        <!--
          优先级：el-check-tag 多选；el-check-tag 无 v-model，靠 toggleDraftPriority
          维护 draft 数组。选中态着色与新建条目 priority-radio 完全一致
          （urgent=danger / important=warning / normal=accent / hint=muted）。
        -->
        <el-form-item label="优先级">
          <div class="priority-tag-group">
            <el-check-tag
              v-for="opt in priorityOptions"
              :key="opt.value"
              :checked="draftFilterPriority.includes(opt.value)"
              :class="`prio-tag prio-${opt.value}`"
              @change="toggleDraftPriority(opt.value)"
            >{{ opt.label }}</el-check-tag>
          </div>
        </el-form-item>

        <!--
          状态：el-checkbox-group 多选；左侧色点沿用 TodoItemRow 视觉语言，
          让 init / in_progress / done / abandoned 一眼可辨。
        -->
        <el-form-item label="状态">
          <el-checkbox-group v-model="draftFilterStatus" class="status-checkbox-group">
            <el-checkbox
              v-for="opt in statusOptions"
              :key="opt.value"
              :value="opt.value"
              :class="`status-checkbox status-${opt.value}`"
            >
              <span class="status-dot" :class="`dot-${opt.value}`" />
              <span class="status-label">{{ opt.label }}</span>
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="filter-dialog-footer">
          <el-button class="reset-btn" @click="resetFilterDraft">重置</el-button>
          <el-button @click="filterDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="applyFilter">确定</el-button>
        </div>
      </template>
    </el-dialog>

    <!--
      新建待办条目对话框（item 模式：名称 + 优先级 + 截止时间）。
      替换原 promptCreateItem 的 ElMessageBox.prompt，创建时直接携带 priority + dueAt 落库。
    -->
    <TodoCreateDialog
      v-model:visible="createDialog.visible"
      mode="item"
      @confirm="onCreateItemConfirm"
    />
  </div>
</template>

<script>
import { Plus, Filter } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import TodoItemRow from './TodoItemRow.vue';
import TodoCreateDialog from './TodoCreateDialog.vue';

export default {
  name: 'TodoListPanel',
  components: { Plus, Filter, TodoItemRow, TodoCreateDialog },
  // select-list：顶部 list 名被点击时触发，
  // 父组件切到右侧 list-detail 视图（中间 item 树保留或挂载）。
  // delete-item：行内删除按钮触发，交由父组件走确认 + IPC + 刷新流程。
  emits: ['select-item', 'toggle-status', 'select-list', 'delete-item'],
  props: {
    // 受控：当前 todo_list id（由父组件 selectedListId 驱动）
    listId: { type: Number, default: null },
    // 受控：list 名（由父组件从 allTodoLists 解析，避免本组件再持有 todoLists）
    listName: { type: String, default: '' },
    selectedItemId: { type: Number, default: null },
  },
  data() {
    return {
      itemTree: [],
      // 筛选对话框可见性
      filterDialogVisible: false,
      // 当前生效的筛选值：数组（多选取并集），空数组 = 不限制（"所有"）
      // 默认：优先级全选（= 不限制优先级）、状态仅 init + in_progress
      // （隐藏已完成 / 已放弃，聚焦"待处理"视图）。用户可经筛选对话框调整。
      filterPriority: ['urgent', 'important', 'normal', 'hint'],
      filterStatus: ['init', 'in_progress'],
      // 对话框草稿：编辑中尚未应用，确定时 copy 到生效值
      draftFilterPriority: [],
      draftFilterStatus: [],
      // 优先级 / 状态下拉选项：集中维护，避免模板里硬编码 4 份 el-option
      priorityOptions: [
        { label: '紧急', value: 'urgent' },
        { label: '重要', value: 'important' },
        { label: '普通', value: 'normal' },
        { label: '提示', value: 'hint' },
      ],
      statusOptions: [
        { label: '初始', value: 'init' },
        { label: '进行中', value: 'in_progress' },
        { label: '已完成', value: 'done' },
        { label: '已放弃', value: 'abandoned' },
      ],
      // 新建待办条目对话框：visible + 当前 parent_id（顶层条目为 null）
      createDialog: {
        visible: false,
        parentId: null,
      },
    };
  },
  computed: {
    /** 任一维度数组非空即视为筛选激活，用于按钮强调与 title 文案 */
    isFilterActive() {
      return this.filterPriority.length > 0 || this.filterStatus.length > 0;
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
     * 无筛选时（两个维度数组均为空）直接返回原树引用，避免无谓深拷贝。
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
  },
  async mounted() {
    // 初次挂载若已有 listId（搜索跳转直达），立即加载 item 树
    if (this.listId) {
      await this.loadItemTree();
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
    async handleCreateRootItem() {
      await this.promptCreateItem(null);
    },
    async handleCreateChildItem(parentId) {
      await this.promptCreateItem(parentId);
    },
    /**
     * 打开"新建待办条目"对话框（item 模式：名称 + 优先级 + 截止时间）。
     * 替换原 ElMessageBox.prompt：创建时即可设定优先级/截止时间，
     * 不必创建后到 TodoItemDetail 二次编辑。
     *
     * @param parentId - 父条目 id；顶层条目传 null
     */
    promptCreateItem(parentId) {
      // 受控模式下 listId 由父传入；无 listId 时禁止创建
      if (!this.listId) {
        ElMessage.warning('请先在左侧选择待办项目');
        return;
      }
      this.createDialog = { visible: true, parentId };
    },
    /**
     * TodoCreateDialog confirm 回调：携带 priority + dueAt 调 createTodoItem，
     * 刷新 item 树并选中新条目（与原 promptCreateItem 落地逻辑一致）。
     *
     * @param payload - { name, priority, dueAt }，dueAt 为 value-format="x" 的字符串时间戳或 null
     */
    async onCreateItemConfirm({ name, priority, dueAt }) {
      try {
        const created = await window.todoApp.createTodoItem({
          title: name,
          todo_list_id: this.listId,
          parent_id: this.createDialog.parentId,
          priority,
          due_at: dueAt ? parseInt(dueAt, 10) : null,
        });
        await this.loadItemTree();
        // 创建后立即选中新条目：
        // - 触发父组件 handleSelectItem → rightPanelView='item-detail' 显示详情
        // - selectedItemId 变化回流为本组件 :selected-item-id，新条目在列表中高亮
        // 必须在 loadItemTree 之后 emit，否则新条目还没渲染，selectedItemId 高亮无的放矢
        this.$emit('select-item', created.id);
        ElMessage.success('待办条目已创建');
      } catch (err) {
        ElMessage.error(err?.message || '创建失败');
      }
    },
    async handleToggleStatus(payload) {
      this.$emit('toggle-status', payload);
      await this.loadItemTree();
    },
    /** 打开筛选对话框：把当前生效值浅拷贝到草稿，避免编辑草稿时共享数组引用污染生效值 */
    openFilterDialog() {
      this.draftFilterPriority = [...this.filterPriority];
      this.draftFilterStatus = [...this.filterStatus];
      this.filterDialogVisible = true;
    },
    /**
     * 优先级 check-tag 多选切换。
     * el-check-tag 没有 v-model，靠 :checked 绑定 + @change 手动维护 draft 数组。
     *
     * @param value - 优先级 key（urgent/important/normal/hint）
     */
    toggleDraftPriority(value) {
      if (this.draftFilterPriority.includes(value)) {
        this.draftFilterPriority = this.draftFilterPriority.filter((v) => v !== value);
      } else {
        this.draftFilterPriority = [...this.draftFilterPriority, value];
      }
    },
    /** 确定：把草稿浅拷贝写入生效值并关闭对话框 */
    applyFilter() {
      this.filterPriority = [...this.draftFilterPriority];
      this.filterStatus = [...this.draftFilterStatus];
      this.filterDialogVisible = false;
    },
    /** 重置：仅清空草稿为空数组（=所有），需要再点「确定」才生效 */
    resetFilterDraft() {
      this.draftFilterPriority = [];
      this.draftFilterStatus = [];
    },
    /**
     * 判断节点自身是否满足当前筛选条件。
     * 多选取并集：维度数组非空时，节点字段命中数组任一值即匹配。
     */
    matchesFilter(node) {
      if (!node) return false;
      if (this.filterPriority.length > 0 && !this.filterPriority.includes(node.priority)) return false;
      if (this.filterStatus.length > 0 && !this.filterStatus.includes(node.status)) return false;
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
  font-size: 19px;
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
  font-size: 15px;
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

.toolbar-actions :deep(.el-button) {
  padding: 8px;
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

/*
 * 筛选对话框的 footer 按钮容器布局（仍由本组件 data-v 命中；
 * 完整对话框样式见文件末尾非 scoped 块的 .todo-filter-dialog 命名空间）。
 */
.filter-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}
</style>

<!--
  筛选对话框样式：非 scoped（el-dialog 启用 append-to-body 后容器被 teleport 到
  document.body，.el-dialog__header / .el-check-tag / .el-checkbox__inner 等 Element Plus
  内部生成的元素拿不到本组件的 data-v 属性，scoped 选择器无法命中）。
  所有规则以 .todo-filter-dialog 命名空间前缀，避免污染其他组件；视觉语言完整复用
  TodoCreateDialog 的 Aurora 浅色基调，让两个对话框观感统一。
-->
<style>
/*
 * 对话框容器：白底 + indigo 细描边 + 柔和投影，与 TodoCreateDialog 完全一致。
 * 不再使用深色 / 毛玻璃（app 整体是浅色 Aurora 基调）。
 */
.todo-filter-dialog.el-dialog {
  background: #ffffff;
  border: 1px solid rgba(99, 102, 241, 0.14);
  border-radius: 14px;
  box-shadow:
    0 20px 50px rgba(99, 102, 241, 0.12),
    0 6px 16px rgba(31, 30, 46, 0.06);
  overflow: hidden;
}

/* 遮罩层：柔和暖灰 + 轻度模糊（与 TodoCreateDialog 一致） */
.el-overlay:has(.todo-filter-dialog) {
  background: rgba(31, 30, 46, 0.28);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

/* 入场动画：scale + fade + 上滑，与 TodoCreateDialog 同语言 */
.todo-filter-dialog {
  animation: filter-dialog-enter 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes filter-dialog-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .todo-filter-dialog {
    animation: none;
  }
}

/* ===== 标题区 ===== */
.todo-filter-dialog .el-dialog__header {
  margin: 0;
  padding: 18px 20px 12px;
  position: relative;
}

/* 标题区底部渐隐细线（与详情面板章节分隔同语言） */
.todo-filter-dialog .el-dialog__header::after {
  content: '';
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(99, 102, 241, 0.32),
    rgba(99, 102, 241, 0.02)
  );
}

.todo-filter-dialog .filter-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 图标圆角容器：indigo accent 浅底 + 深色主色图标 */
.todo-filter-dialog .header-icon-wrap {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: linear-gradient(
    135deg,
    rgba(99, 102, 241, 0.14),
    rgba(139, 92, 246, 0.08)
  );
  border: 1px solid rgba(99, 102, 241, 0.20);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.10);
}

.todo-filter-dialog .header-icon {
  font-size: 18px;
  color: var(--accent-text, #4f46e5);
}

.todo-filter-dialog .header-text {
  flex: 1;
  min-width: 0;
}

.todo-filter-dialog .header-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-on-dark, #1f1e2e);
  letter-spacing: 0.02em;
  line-height: 1.3;
}

.todo-filter-dialog .header-subtitle {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-on-dark-secondary, #5f5e6f);
  letter-spacing: 0.04em;
}

/* 右上角关闭按钮 */
.todo-filter-dialog .el-dialog__headerbtn {
  top: 16px;
  right: 16px;
  width: 28px;
  height: 28px;
}

.todo-filter-dialog .el-dialog__headerbtn .el-dialog__close {
  color: var(--text-on-dark-muted, #908e9f);
  font-size: 16px;
  transition: color 0.18s ease;
}

.todo-filter-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: var(--text-on-dark, #1f1e2e);
}

/* ===== 表单主体 ===== */
.todo-filter-dialog .el-dialog__body {
  padding: 18px 20px 8px;
  color: var(--text-on-dark, #1f1e2e);
}

.todo-filter-dialog .el-form-item {
  margin-bottom: 16px;
}

.todo-filter-dialog .el-form-item:last-child {
  margin-bottom: 4px;
}

/* eyebrow 章节标题（与 TodoCreateDialog 一致） */
.todo-filter-dialog .el-form-item__label {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #908e9f);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  padding-bottom: 6px;
  line-height: 1.6;
}

/*
 * 优先级 check-tag 组：未选中 indigo 中性底，选中态按优先级着色，
 * 配色与 TodoCreateDialog priority-radio 完全一致（urgent=danger / important=warning /
 * normal=accent / hint=muted），用户在两个对话框看到同一套优先级视觉语言。
 */
.todo-filter-dialog .priority-tag-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.todo-filter-dialog .el-check-tag {
  border-radius: 8px;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  border: 1px solid rgba(99, 102, 241, 0.16);
  background: rgba(99, 102, 241, 0.04);
  color: var(--text-on-dark-secondary, #5f5e6f);
  transition: all 0.18s ease;
  cursor: pointer;
}

.todo-filter-dialog .el-check-tag:hover {
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.28);
  color: var(--text-on-dark, #1f1e2e);
}

/* 选中态：分别按紧急 / 重要 / 普通 / 提示语义着色（与新建条目 priority-radio 同源） */
.todo-filter-dialog .prio-tag.prio-urgent.is-checked {
  background: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
  color: #fff;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.28);
}
.todo-filter-dialog .prio-tag.prio-important.is-checked {
  background: var(--color-warning, #f59e0b);
  border-color: var(--color-warning, #f59e0b);
  color: #fff;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.28);
}
.todo-filter-dialog .prio-tag.prio-normal.is-checked {
  background: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
  color: #fff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.28);
}
.todo-filter-dialog .prio-tag.prio-hint.is-checked {
  background: var(--text-on-dark-muted, #908e9f);
  border-color: var(--text-on-dark-muted, #908e9f);
  color: #fff;
  box-shadow: 0 4px 12px rgba(144, 142, 159, 0.22);
}

/* 选中后 hover 保持语义色，仅做微抬升 + 亮度，避免颜色闪烁 */
.todo-filter-dialog .prio-tag.is-checked:hover {
  transform: translateY(-1px);
  filter: brightness(1.06);
}

/*
 * 状态 checkbox 组：竖向列表，每行带状态色点（沿用 TodoItemRow 视觉语言）。
 * checkbox 选中色统一为 indigo accent，色点承担语义区分，避免颜色过载。
 */
.todo-filter-dialog .status-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.todo-filter-dialog .status-checkbox {
  display: flex;
  align-items: center;
  height: auto;
  margin-right: 0;
  padding: 6px 8px;
  border-radius: 8px;
  transition: background 0.18s ease;
}

.todo-filter-dialog .status-checkbox:hover {
  background: rgba(99, 102, 241, 0.04);
}

.todo-filter-dialog .status-checkbox .el-checkbox__label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-on-dark, #1f1e2e);
  letter-spacing: 0.02em;
}

/* 状态色点：8px 圆 + 白色描边圈，在 hover 浅底上仍清晰可见 */
.todo-filter-dialog .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);
}

.todo-filter-dialog .dot-init { background: var(--text-on-dark-muted, #908e9f); }
.todo-filter-dialog .dot-in_progress { background: var(--accent, #6366f1); }
.todo-filter-dialog .dot-done { background: var(--color-success, #10b981); }
.todo-filter-dialog .dot-abandoned { background: #c8c6d4; }

.todo-filter-dialog .status-checkbox .el-checkbox__input.is-checked .el-checkbox__inner {
  background-color: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
}

.todo-filter-dialog .status-checkbox .el-checkbox__input.is-checked + .el-checkbox__label {
  color: var(--text-on-dark, #1f1e2e);
}

/* ===== footer ===== */
.todo-filter-dialog .el-dialog__footer {
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(99, 102, 241, 0.10);
}

.todo-filter-dialog .filter-dialog-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  width: 100%;
}

/*
 * 重置按钮：弱化为 ghost 文本按钮，靠左独立分组（语义=清空所有筛选，
 * 与右侧"取消/确定"分离，避免误点）。hover 转 danger 红调，提示其"清空"语义。
 */
.todo-filter-dialog .filter-dialog-footer .reset-btn {
  margin-right: auto;
  background: transparent;
  border-color: transparent;
  color: var(--text-on-dark-muted, #908e9f);
  letter-spacing: 0.04em;
}

.todo-filter-dialog .filter-dialog-footer .reset-btn:hover {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.20);
  color: var(--color-danger, #ef4444);
}

/* 取消按钮：indigo 浅底 + 描边 */
.todo-filter-dialog .filter-dialog-footer .el-button:not(.el-button--primary):not(.reset-btn) {
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.24);
  color: var(--text-on-dark-secondary, #5f5e6f);
  letter-spacing: 0.04em;
}

.todo-filter-dialog .filter-dialog-footer .el-button:not(.el-button--primary):not(.reset-btn):hover {
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.40);
  color: var(--text-on-dark, #1f1e2e);
}

/* 主按钮（确定）：indigo accent 渐变 + 白字（与 TodoCreateDialog 主按钮同款） */
.todo-filter-dialog .filter-dialog-footer .el-button--primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.06em;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.28);
  transition: all 0.18s ease;
}

.todo-filter-dialog .filter-dialog-footer .el-button--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.38);
}
</style>
