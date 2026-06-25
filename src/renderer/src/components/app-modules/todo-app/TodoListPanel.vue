<template>
  <div class="todo-list-panel-inner">
    <!--
      内部滚动容器：根元素 .todo-list-panel-inner 因 Vue attribute inheritance
      会与父组件传入的 .todo-list-panel 合并到同一 DOM 元素，无法既当外层 wrapper
      （需要 overflow:hidden 裁切动画）又当滚动容器（需要 overflow-y:auto）。
      这里再分一层 .list-panel-scroll 专门承担滚动，与 TodoSidebar 的 .sidebar-scroll 同款。
    -->
    <div class="list-panel-scroll">
      <!-- 标签视图模式：显示标签关联的 item 列表 -->
      <div v-if="labelId" class="label-items">
        <div class="section-title">标签关联待办条目</div>
        <div v-if="labelItems.length === 0" class="empty-hint">该标签暂无关联待办条目</div>
        <TodoItemRow
          v-for="item in labelItems"
          :key="item.id"
          :item="item"
          :depth="0"
          :selected-item-id="selectedItemId"
          @toggle-status="handleToggleStatus"
          @select="$emit('select-item', $event)"
        />
      </div>

      <!-- 正常模式：选中 list 后展示 items 树 -->
      <div v-else-if="listId" class="item-tree-container">
        <div class="tree-toolbar">
          <span class="section-title">{{ listName }}</span>
          <el-button size="small" text @click="$emit('open-list-docs', listId)">
            <el-icon><Document /></el-icon> 项目文档
          </el-button>
          <el-button size="small" text @click="handleCreateRootItem">
            <el-icon><Plus /></el-icon> 新建待办条目
          </el-button>
        </div>
        <div v-if="itemTree.length === 0" class="empty-hint">暂无待办条目，点击"新建待办条目"开始</div>
        <TodoItemRow
          v-for="node in itemTree"
          :key="node.id"
          :item="node"
          :depth="node.depth"
          :children="node.children"
          :selected-item-id="selectedItemId"
          @toggle-status="handleToggleStatus"
          @select="$emit('select-item', $event)"
          @create-child="handleCreateChildItem"
        />
      </div>

      <!-- 未选中待办项目 -->
      <div v-else class="empty-state">
        <el-empty description="请在左侧选择待办项目" />
      </div>
    </div>
  </div>
</template>

<script>
import { Plus, Document } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import TodoItemRow from './TodoItemRow.vue';

export default {
  name: 'TodoListPanel',
  components: { Plus, Document, TodoItemRow },
  props: {
    // 受控：当前 todo_list id（由父组件 selectedListId 驱动）
    listId: { type: Number, default: null },
    // 受控：list 名（由父组件从 allTodoLists 解析，避免本组件再持有 todoLists）
    listName: { type: String, default: '' },
    // 标签视图模式：传入 labelId 后切换到标签关联条目展示
    labelId: { type: Number, default: null },
    selectedItemId: { type: Number, default: null },
  },
  data() {
    return {
      itemTree: [],
      labelItems: [],
    };
  },
  watch: {
    // 切换 list 时重新加载 item 树（D6 受控模式核心入口）
    listId() {
      this.loadItemTree();
    },
    labelId() {
      if (this.labelId) {
        this.loadLabelItems();
      } else {
        this.labelItems = [];
      }
    },
  },
  async mounted() {
    // 初次挂载若已有 listId（搜索跳转直达），立即加载 item 树
    if (this.listId) {
      await this.loadItemTree();
    } else if (this.labelId) {
      await this.loadLabelItems();
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
    async loadLabelItems() {
      try {
        this.labelItems = await window.todoApp.listTodoItemsByLabel(this.labelId);
      } catch (err) {
        ElMessage.error('加载标签待办条目失败');
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
</style>
