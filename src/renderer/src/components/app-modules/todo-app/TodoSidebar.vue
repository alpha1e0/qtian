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
          :labels="labels"
          @select="$emit('tree-select', $event)"
          @create="$emit('create-category', $event)"
          @rename="$emit('rename-category', $event)"
          @delete="$emit('delete-category', $event)"
          @create-list="$emit('create-list', $event)"
          @rename-list="$emit('rename-list', $event)"
          @delete-list="$emit('delete-list', $event)"
          @import-list="$emit('import-list', $event)"
          @export-list="$emit('export-list', $event)"
        />

        <!--
          标签 tab：分栏视图。
          - 默认（未选中标签）：仅显示标签云。
          - 选中标签后：上下分栏，上段恒为标签云（可继续切换标签），下段为该标签关联的
            待办项目列表，溢出时仅下段内部滚动，标签云始终可见。
          两段均位于 .sidebar-scroll 内，外层不再滚动，避免与内段滚动冲突。
        -->
        <div v-else class="label-split" :class="{ 'has-selection': !!selectedLabelId }">
          <div class="label-cloud-pane">
            <TodoLabelCloud
              :labels="labels"
              :selected-id="selectedLabelId"
              @select-label="$emit('select-label', $event)"
            />
          </div>

          <!-- 下段：选中标签后的关联项目列表（未选标签时不渲染，保持云区独占） -->
          <div v-if="selectedLabelId" class="label-lists-pane">
            <div class="label-lists-scroll">
              <div v-if="labelLists.length === 0" class="label-lists-empty">
                该标签暂无关联待办项目
              </div>
              <div
                v-for="list in labelLists"
                :key="list.id"
                class="label-list-item"
                :title="`查看「${list.name}」`"
                @click="$emit('select-list', list.id)"
                @contextmenu="onLabelListContextMenu($event, list)"
              >
                <el-icon><Document /></el-icon>
                <div class="label-list-meta">
                  <div class="label-list-name">{{ list.name }}</div>
                  <div v-if="list.description" class="label-list-desc">{{ list.description }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
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

    <!--
      标签下待办项目右键菜单：复用 TodoContextMenu（与分类 tab 的 todo_list 节点菜单一致）。
      命令经 emit 上抛到 TodoAppPage，复用既有 rename-list / delete-list / export-list handler。
    -->
    <TodoContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      @command="onContextMenuCommand"
      @close="ctxMenu.visible = false"
    />

    <!--
      重命名待办项目对话框：与 TodoCategoryTree.handleRename 共用同一个 TodoCreateDialog
      （mode="rename-list"），保持标签 tab 与分类 tab 的重命名体验完全一致。
    -->
    <TodoCreateDialog
      v-model:visible="renameDialog.visible"
      mode="rename-list"
      :initial-name="renameDialog.targetList?.name || ''"
      @confirm="onRenameDialogConfirm"
    />
  </div>
</template>

<script>
import TodoCategoryTree from './TodoCategoryTree.vue';
import TodoLabelCloud from './TodoLabelCloud.vue';
import TodoContextMenu from './TodoContextMenu.vue';
import TodoCreateDialog from './TodoCreateDialog.vue';
import { Delete, Document, Edit, Download, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { markRaw } from 'vue';

export default {
  name: 'TodoSidebar',
  components: { TodoCategoryTree, TodoLabelCloud, TodoContextMenu, TodoCreateDialog, Delete, Document },
  // 标签下项目列表的右键命令复用父组件既有 handler：
  //   rename-list / delete-list / export-list（与分类 tab 中 todo_list 节点同款）
  emits: [
    'tree-select',
    'create-category', 'rename-category', 'delete-category',
    'create-list', 'rename-list', 'delete-list',
    'import-list', 'export-list',
    'select-label', 'select-list', 'open-trash',
  ],
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
      // 标签下关联待办项目列表（仅 selectedLabelId 命中时加载）
      labelLists: [],
      // 右键菜单状态：visible + 鼠标坐标 + 当前命中项目 + 菜单项
      ctxMenu: {
        visible: false,
        x: 0,
        y: 0,
        targetList: null,
        items: [],
      },
      icons: {
        edit: markRaw(Edit),
        delete: markRaw(Delete),
        download: markRaw(Download),
        upload: markRaw(Upload),
      },
      // 重命名待办项目对话框：visible + 当前命中的 list（其 name 用于预填、id 用于 emit）
      renameDialog: {
        visible: false,
        targetList: null,
      },
    };
  },
  watch: {
    // 切换/清空选中标签时同步刷新关联项目列表
    selectedLabelId(val) {
      if (val) {
        this.loadLabelLists(val);
      } else {
        this.labelLists = [];
      }
    },
  },
  methods: {
    /**
     * 加载选中标签关联的待办项目列表。
     * 仅在标签 tab 且 selectedLabelId 命中时调用，结果驱动下段卡片渲染。
     * @param {number} labelId - 当前选中标签 id
     */
    async loadLabelLists(labelId) {
      try {
        this.labelLists = await window.todoApp.listTodoListsByLabel(labelId);
      } catch (err) {
        ElMessage.error('加载标签待办项目失败');
        console.error(err);
        this.labelLists = [];
      }
    },
    /**
     * 刷新当前选中标签的关联项目列表（外部数据变更后调用，如重命名/删除后）。
     * 无选中标签时直接跳过。
     */
    refreshLabelLists() {
      if (this.selectedLabelId) {
        return this.loadLabelLists(this.selectedLabelId);
      }
      this.labelLists = [];
      return Promise.resolve();
    },
    /**
     * 标签下待办项目卡片右键：阻止浏览器默认菜单，记录鼠标坐标 + 命中项目，
     * 构造与分类 tab 中 todo_list 节点一致的菜单项后打开 TodoContextMenu。
     */
    onLabelListContextMenu(event, list) {
      if (!list) return;
      event.preventDefault();
      event.stopPropagation();
      this.ctxMenu.x = event.clientX;
      this.ctxMenu.y = event.clientY;
      this.ctxMenu.targetList = list;
      this.ctxMenu.items = [
        { command: 'export-list', label: '导出待办项目', icon: this.icons.download },
        { command: 'rename-list', label: '重命名待办项目', icon: this.icons.edit, divided: true },
        { command: 'delete-list', label: '删除待办项目', icon: this.icons.delete },
      ];
      this.ctxMenu.visible = true;
    },
    /**
     * 右键菜单命令路由：与分类 tab 中 todo_list 节点命令一致，复用父组件 handler。
     * 重命名走统一 TodoCreateDialog（与 TodoCategoryTree.handleRename 行为对齐），
     * 其余事件直接透传。
     */
    async onContextMenuCommand({ command }) {
      const list = this.ctxMenu.targetList;
      this.ctxMenu.visible = false;
      if (!list) return;
      switch (command) {
        case 'export-list':
          this.$emit('export-list', { listId: list.id, name: list.name });
          break;
        case 'rename-list':
          this.promptRenameList(list);
          break;
        case 'delete-list':
          this.$emit('delete-list', list.id);
          break;
        default:
          break;
      }
    },
    /**
     * 打开"重命名待办项目"对话框（mode="rename-list"）。
     * 与 TodoCategoryTree.handleRename 的 list 分支行为对齐：targetList.name 预填原名称、
     * 对话框内全选便于覆盖或局部修改；用户点"保存"后 onRenameDialogConfirm emit 给父组件。
     */
    promptRenameList(list) {
      this.renameDialog = { visible: true, targetList: list };
    },
    /**
     * TodoCreateDialog confirm 回调：emit rename-list 给父组件走 IPC + 刷新。
     *
     * @param payload - { name }，name 已由对话框 trim
     */
    onRenameDialogConfirm({ name }) {
      const list = this.renameDialog.targetList;
      if (!list) return;
      this.$emit('rename-list', { id: list.id, name });
    },
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

/*
 * 标签 tab 分栏布局（设计文档 §9.4）：
 *   未选中标签 → 仅 .label-cloud-pane（独占滚动区高度）
 *   选中标签   → 上下分栏：
 *     .label-cloud-pane     (flex-shrink:0) 标签云始终可见，内容多时内部可滚
 *     .label-lists-pane     (flex:1, min-height:0) 关联项目，溢出仅此段滚
 * 整体位于 .sidebar-scroll（外层滚动）内，分栏优先用尽侧栏高度；
 * 当只有云时，云区独占可视空间。
 */
.label-split {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

/*
 * 标签云段：
 *   未选中标签 → flex:1 独占整个滚动区。
 *   选中标签   → 自然高度（flex:0 0 auto），上限 50%；云内容不足时
 *                剩余空间全部留给 .label-lists-pane（flex:1）。
 *                overflow-y:auto 仅在云内容突破 50% 时出现滚动条。
 */
.label-cloud-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.label-split.has-selection .label-cloud-pane {
  flex: 0 0 auto;
  max-height: 50%;
}

/* 关联项目段：选中标签后出现，独占剩余高度并内部滚动 */
.label-lists-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(99, 102, 241, 0.10);
}

.label-lists-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 4px;
}

.label-lists-empty {
  color: var(--text-on-dark-muted, #5c5b72);
  font-size: 12px;
  font-style: italic;
  padding: 14px 8px;
  letter-spacing: 0.02em;
}

/* 单个关联项目卡片：与中间面板 list 卡片视觉同款，便于跨面板识别 */
.label-list-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.08);
  transition: all 0.18s ease;
  margin-bottom: 6px;
  color: var(--text-on-dark, #e4e4ed);
}

.label-list-item:hover {
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.22);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.10);
}

.label-list-item :deep(.el-icon) {
  /* 与分类 tab 中 todo_list 叶子节点的 .node-icon 颜色一致，便于跨面板识别同一对象 */
  color: var(--text-on-dark-muted, #8b8aa0);
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
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-on-dark-muted, #5c5b72);
  letter-spacing: 0.01em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
