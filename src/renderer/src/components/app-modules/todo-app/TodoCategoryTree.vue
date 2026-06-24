<template>
  <div class="todo-category-tree">
    <div class="tree-header">
      <span class="header-title">分类</span>
      <el-button size="small" text @click="handleCreateRoot">
        <el-icon><Plus /></el-icon>
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
    >
      <template #default="{ node, data }">
        <div class="tree-node" :class="{ 'is-list': data.__type === 'list' }">
          <!-- 空分类占位箭头（D3）：el-tree 默认对无 children 的节点不渲染展开图标，
               category 节点即使无子项也应显示占位，保持"目录"语义一致性。
               用透明三角图标占位，避免点击时切换不可见的展开态。 -->
          <span
            v-if="data.__type === 'category' && isEmptyCategory(data)"
            class="cat-leaf-arrow"
            aria-hidden="true"
          ></span>

          <span
            class="node-label"
            :class="{ active: data.nodeKey === selectedNodeKey }"
            :title="node.label"
          >
            <el-icon v-if="data.__type === 'category'" class="node-icon"><Folder /></el-icon>
            <el-icon v-else class="node-icon"><Document /></el-icon>
            {{ node.label }}
          </span>

          <span class="node-actions">
            <!-- category 节点：＋拆成下拉菜单（新建子分类 / 新建待办项目） -->
            <el-dropdown
              v-if="data.__type === 'category'"
              trigger="click"
              @command="onCreateCommand($event, data)"
              @click.stop
            >
              <el-button size="small" text @click.stop>
                <el-icon><Plus /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="sub-category">新建子分类</el-dropdown-item>
                  <el-dropdown-item command="list">新建待办项目</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-button size="small" text @click.stop="handleRename(data)">
              <el-icon><Edit /></el-icon>
            </el-button>
            <el-button size="small" text @click.stop="handleDelete(data)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </span>
        </div>
      </template>
    </el-tree>
  </div>
</template>

<script>
import { Plus, Edit, Delete, Folder, Document } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';

export default {
  name: 'TodoCategoryTree',
  components: { Plus, Edit, Delete, Folder, Document },
  props: {
    // 统一树（category + todo_list 叶子），由父组件 mergedTree 提供
    treeData: { type: Array, default: () => [] },
    // 复合 nodeKey（`cat_<id>` / `list_<id>`），用于 el-tree current-node-key
    selectedNodeKey: { type: String, default: null },
  },
  data() {
    return {
      treeProps: { label: 'name', children: 'children' },
    };
  },
  methods: {
    /**
     * 是否为「无子分类且无待办项目」的空 category。
     * 注：todo_list 在 mergedTree 中作为 category.children 叶子节点存在，
     * 所以 children 为空即代表该 category 下无可见子项。
     */
    isEmptyCategory(data) {
      return !Array.isArray(data.children) || data.children.length === 0;
    },
    /**
     * 节点点击分流（D5）。
     * 不区分 expand 触发（expand-on-click-node=false，点文字不会展开），
     * 只把 {type, id} 交给父组件决定视图切换。
     */
    handleNodeClick(data) {
      this.$emit('select', { type: data.__type, id: data.id });
    },
    /**
     * category ＋下拉命令路由（D4）。
     * @param cmd - 'sub-category' | 'list'
     */
    onCreateCommand(cmd, data) {
      if (cmd === 'list') {
        this.handleCreateList(data);
      } else {
        this.handleCreateChild(data);
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
  font-size: 10px;
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

.tree-node {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 6px;
}

/* list 叶子节点稍微收敛字重，与 category 视觉区分 */
.tree-node.is-list .node-label {
  font-weight: 400;
}

/* 空分类占位箭头：与 el-tree 三角同尺寸的透明占位，保持缩进对齐 */
.cat-leaf-arrow {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: inline-block;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-label.active {
  color: var(--accent-text);
  font-weight: 600;
}

.node-actions {
  display: none;
  gap: 2px;
}

:deep(.el-tree-node__content:hover) .node-actions {
  display: flex;
}

/* 树节点操作按钮：去除默认蓝色 hover */
.node-actions :deep(.el-button:hover) {
  color: var(--accent-text);
}
</style>
