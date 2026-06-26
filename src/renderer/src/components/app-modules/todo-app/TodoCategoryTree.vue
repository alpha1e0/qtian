<template>
  <div class="todo-category-tree">
    <div class="tree-header">
      <span class="header-title">分类</span>
      <el-button text @click="handleCreateRoot" title="新建根分类">
        <el-icon><FolderAdd /></el-icon>
      </el-button>
    </div>

    <el-tree
      :data="treeData"
      node-key="nodeKey"
      :props="treeProps"
      :expand-on-click-node="false"
      default-expand-all
      :highlight-current="true"
      :current-node-key="selectedNodeKey"
      @node-click="handleNodeClick"
      @node-contextmenu="onTreeContextMenu"
    >
      <template #default="{ node, data }">
        <!-- 右键菜单改用自封装 TodoContextMenu 跟随鼠标（el-dropdown 锚到触发元素，无法跟鼠标）。
             node-contextmenu 直接提供 data，无需在 DOM 上挂 data-node-key 再上溯查找，
             且命中范围覆盖整行（含 expand-icon 列、content padding）。 -->
        <div class="tree-node" :class="{ 'is-list': data.__type === 'list' }">
          <!-- 空分类占位箭头（D3）：el-tree 默认对无 children 的节点不渲染展开图标，
               category 节点即使无子项也应显示占位，保持"目录"语义一致性。
               用可见的 CaretRight 与 el-tree 默认 caret 同尺寸（24x24），避免标签错位。 -->
          <el-icon
            v-if="data.__type === 'category' && isEmptyCategory(data)"
            class="cat-leaf-arrow"
            aria-hidden="true"
          >
            <CaretRight />
          </el-icon>

          <span
            class="node-label"
            :class="{ active: data.nodeKey === selectedNodeKey }"
            :title="node.label"
          >
            <el-icon v-if="data.__type === 'category'" class="node-icon"><Folder /></el-icon>
            <el-icon v-else class="node-icon"><Document /></el-icon>
            {{ node.label }}
          </span>
        </div>
      </template>
    </el-tree>

    <!-- 右键菜单：fixed 定位跟随鼠标，命令路由走 onContextCommand -->
    <TodoContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      @command="onContextMenuCommand"
      @close="ctxMenu.visible = false"
    />
  </div>
</template>

<script>
import {
  Plus,
  Folder,
  Document,
  CaretRight,
  ArrowRight,
  FolderAdd,
  DocumentAdd,
  Edit,
  Delete,
  Upload,
  Download,
} from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import { markRaw } from 'vue';
import TodoContextMenu from './TodoContextMenu.vue';

export default {
  name: 'TodoCategoryTree',
  components: { Plus, Folder, Document, CaretRight, ArrowRight, TodoContextMenu },
  props: {
    // 统一树（category + todo_list 叶子），由父组件 mergedTree 提供
    treeData: { type: Array, default: () => [] },
    // 复合 nodeKey（`cat_<id>` / `list_<id>`），用于 el-tree current-node-key
    selectedNodeKey: { type: String, default: null },
  },
  data() {
    return {
      treeProps: { label: 'name', children: 'children' },
      // 右键菜单状态：visible + 鼠标坐标 + 当前命中的节点 data + 渲染项
      ctxMenu: {
        visible: false,
        x: 0,
        y: 0,
        items: [],
        // 命中节点 data，供 command 路由时取 id/__type
        targetData: null,
      },
      // 图标组件：用 markRaw 避免被 Vue 做成响应式代理
      icons: {
        folderAdd: markRaw(FolderAdd),
        documentAdd: markRaw(DocumentAdd),
        edit: markRaw(Edit),
        delete: markRaw(Delete),
        upload: markRaw(Upload),
        download: markRaw(Download),
      },
    };
  },
  methods: {
    /**
     * 节点左键点击：emit select 事件，由父组件（TodoSidebar → TodoAppPage）
     * 驱动右侧详情视图切换。不在子组件内直接操作 store/IPC，保持职责单一。
     */
    handleNodeClick(data) {
      this.$emit('select', { type: data.__type, id: data.id });
    },
    /**
     * 是否为「无子分类且无待办项目」的空 category。
     * 注：todo_list 在 mergedTree 中作为 category.children 叶子节点存在，
     * 所以 children 为空即代表该 category 下无可见子项。
     */
    isEmptyCategory(data) {
      return !Array.isArray(data.children) || data.children.length === 0;
    },
    /**
     * el-tree 节点右键：阻止浏览器默认菜单，记录鼠标坐标 + 命中节点 data，
     * 构造对应菜单项并打开 TodoContextMenu。
     *
     * 使用 el-tree 内置的 node-contextmenu 事件：回调签名 (event, data, node)，
     * 直接拿到节点 data，免去 DOM 上溯查找；命中范围覆盖 .el-tree-node__content
     * 整行（含 expand-icon 列、content padding）。
     */
    onTreeContextMenu(event, data) {
      // data 为 null/undefined 时（理论上不会，但防御）直接放行浏览器默认菜单
      if (!data) return;

      event.preventDefault();
      // 阻止冒泡：否则 document 上的 contextmenu 监听器（TodoContextMenu 关闭用）
      // 会在本 handler 之后触发，把刚 open 的新菜单立刻关闭。
      event.stopPropagation();
      this.ctxMenu.x = event.clientX;
      this.ctxMenu.y = event.clientY;
      this.ctxMenu.targetData = data;
      this.ctxMenu.items = this.buildMenuItems(data);
      this.ctxMenu.visible = true;
    },
    /**
     * 按 data.__type 构造菜单项（command/label/icon/divided）。
     * 顺序与原 el-dropdown-menu 保持一致。
     */
    buildMenuItems(data) {
      if (data.__type === 'category') {
        return [
          { command: 'create-sub-category', label: '新建子分类', icon: this.icons.folderAdd },
          { command: 'create-list', label: '新建待办项目', icon: this.icons.documentAdd },
          { command: 'import-list', label: '导入待办项目', icon: this.icons.upload },
          { command: 'rename', label: '重命名分类', icon: this.icons.edit, divided: true },
          { command: 'delete', label: '删除分类', icon: this.icons.delete },
        ];
      }
      return [
        { command: 'export-list', label: '导出待办项目', icon: this.icons.download },
        { command: 'rename', label: '重命名待办项目', icon: this.icons.edit, divided: true },
        { command: 'delete', label: '删除待办项目', icon: this.icons.delete },
      ];
    },
    /**
     * TodoContextMenu command 回调：按 command 分流，targetData 即右键命中节点。
     */
    onContextMenuCommand({ command }) {
      const data = this.ctxMenu.targetData;
      // 命令执行前先关闭菜单（用户已点 item，菜单组件本身也会 emit close，
      // 这里显式置 false 保证状态干净，避免数据已变但菜单还残留）
      this.ctxMenu.visible = false;
      switch (command) {
        case 'create-sub-category':
          this.handleCreateChild(data);
          break;
        case 'create-list':
          this.handleCreateList(data);
          break;
        case 'import-list':
          this.$emit('import-list', { categoryId: data.id });
          break;
        case 'export-list':
          this.$emit('export-list', { listId: data.id, name: data.name });
          break;
        case 'rename':
          this.handleRename(data);
          break;
        case 'delete':
          this.handleDelete(data);
          break;
        default:
          break;
      }
    },
    async handleCreateRoot() {
      try {
        const { value } = await ElMessageBox.prompt('请输入分类名称', '新建根分类', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (value && value.trim()) {
          this.$emit('create', { name: value.trim(), parentId: null });
        }
      } catch {
        // cancel
      }
    },
    async handleCreateChild(data) {
      try {
        const { value } = await ElMessageBox.prompt('请输入分类名称', `在"${data.name}"下新建`, {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (value && value.trim()) {
          this.$emit('create', { name: value.trim(), parentId: data.id });
        }
      } catch {
        // cancel
      }
    },
    /**
     * 在 category 下新建待办项目（D4）。
     * 仅 emit 事件，prompt 与 IPC 由父组件统一处理（避免子组件持有 IPC 逻辑）。
     */
    async handleCreateList(data) {
      try {
        const { value } = await ElMessageBox.prompt('请输入待办项目名称', '新建待办项目', {
          confirmButtonText: '创建',
          cancelButtonText: '取消',
        });
        if (value && value.trim()) {
          this.$emit('create-list', { categoryId: data.id, name: value.trim() });
        }
      } catch {
        // cancel
      }
    },
    /**
     * 重命名：按节点类型分流到 category / list 事件。
     */
    async handleRename(data) {
      try {
        const title = data.__type === 'list' ? '重命名待办项目' : '重命名分类';
        const { value } = await ElMessageBox.prompt('请输入新名称', title, {
          confirmButtonText: '保存',
          cancelButtonText: '取消',
          inputValue: data.name,
        });
        if (value && value.trim()) {
          if (data.__type === 'list') {
            this.$emit('rename-list', { id: data.id, name: value.trim() });
          } else {
            this.$emit('rename', { id: data.id, name: value.trim() });
          }
        }
      } catch {
        // cancel
      }
    },
    /**
     * 删除：按节点类型分流。list 删除前由父组件弹二次确认。
     */
    handleDelete(data) {
      if (data.__type === 'list') {
        this.$emit('delete-list', data.id);
      } else {
        this.$emit('delete', data.id);
      }
    },
  },
};
</script>

<style scoped>
.todo-category-tree {
  user-select: none;
}

.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 6px;
  margin-bottom: 6px;
  position: relative;
}

.tree-header::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(99, 102, 241, 0.24),
    transparent
  );
}

.header-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-on-dark-muted, #5c5b72);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

/* Element Plus 树节点底层排版微调 */
.todo-category-tree :deep(.el-tree) {
  background: transparent;
  --el-tree-node-hover-bg-color: transparent;
  --el-tree-text-color: var(--text-on-dark, #e4e4ed);
}

/* 隐藏 el-tree 对叶子节点的内置空占位（.is-leaf 仍占 ~12px padding），
   由项目自定义 .cat-leaf-arrow 统一负责空分类的箭头占位。
   这样空/非空分类 .tree-node 之前的宽度都是 24px，标签起点一致，无突变。 */
.todo-category-tree :deep(.el-tree-node__expand-icon.is-leaf) {
  display: none;
}

.todo-category-tree :deep(.el-tree-node__expand-icon) {
  padding: 3px;
}

.todo-category-tree :deep(.el-tree-node__content) {
  height: 30px;
  padding-right: 4px;
  border-radius: 8px;
  margin-bottom: 2px;
  transition: background 0.18s ease;
}

.todo-category-tree :deep(.el-tree-node__content:hover) {
  background: rgba(99, 102, 241, 0.06);
}

.todo-category-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: linear-gradient(
    90deg,
    rgba(99, 102, 241, 0.14) 0%,
    rgba(99, 102, 241, 0.04) 100%
  );
  box-shadow: inset 2px 0 0 var(--accent);
}

/* el-tree-node__content 的直接子元素需 flex:1 填满行宽，
   保证 hover/选中态背景区域正确（移除 el-dropdown 后由 .tree-node 直接承担）。 */
.todo-category-tree :deep(.el-tree-node__content > .tree-node) {
  flex: 1;
  min-width: 0;
}

.tree-node {
  flex: 1;
  display: flex;
  align-items: center;
  /* 不用 space-between：空分类会渲染 .cat-leaf-arrow 占位，
     两个可见元素会被推到两端，导致空分类（如新建的二级分类）标签右对齐。
     改用 flex-start + label flex:1，让箭头/标签恒靠左。 */
  justify-content: flex-start;
  /* 不在 .tree-node 上设 padding-left：空分类的 .cat-leaf-arrow 需紧贴
     .tree-node 起点，与非空分类 el-tree caret（在 .tree-node 之外）位置对齐。
     folder 与 caret 之间的 6px 间距改由 .node-label 的 padding-left 提供。 */
}

/* list 叶子节点稍微收敛字重，与 category 视觉区分 */
.tree-node.is-list .node-label {
  font-weight: 400;
}

/* 空分类占位箭头：与 el-tree 默认 .el-tree-node__expand-icon 同尺寸（24x24），
   保证空分类/非空分类的标签起点都对齐（30px）。
   注：el-tree 默认 caret = font-size 12px + padding 6px。 */
.cat-leaf-arrow {
  flex-shrink: 0;
  font-size: 12px;
  padding: 3px;
  box-sizing: content-box;
  color: var(--text-on-dark-muted, #8b8aa0);
}

.node-icon {
  margin-right: 4px;
  font-size: 14px;
  color: var(--text-on-dark-muted, #8b8aa0);
}

.node-label {
  font-size: 13px;
  color: var(--text-on-dark, #e4e4ed);
  letter-spacing: 0.01em;
  display: inline-flex;
  align-items: center;
  /* 弹性占满剩余空间，保证操作按钮始终靠右、标签始终紧跟箭头/图标 */
  flex: 1;
  min-width: 0;
  /* caret/箭头 与 folder 图标之间的 6px 间距由此提供：
     让 .cat-leaf-arrow 与 el-tree caret 处于同一基准线，
     folder 起点位置在空/非空分类下完全一致。 */
  padding-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-label.active {
  color: var(--accent-text);
  font-weight: 600;
}
</style>
