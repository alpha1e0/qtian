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
      node-key="id"
      :props="treeProps"
      :expand-on-click-node="false"
      default-expand-all
      :highlight-current="true"
      :current-node-key="selectedId"
      @node-click="handleNodeClick"
    >
      <template #default="{ node, data }">
        <div class="tree-node">
          <span class="node-label" :class="{ active: data.id === selectedId }">{{ node.label }}</span>
          <span class="node-actions">
            <el-button size="small" text @click.stop="handleCreateChild(data)">
              <el-icon><Plus /></el-icon>
            </el-button>
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
import { Plus, Edit, Delete } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';

export default {
  name: 'TodoCategoryTree',
  components: { Plus, Edit, Delete },
  props: {
    treeData: { type: Array, default: () => [] },
    selectedId: { type: Number, default: null },
  },
  data() {
    return {
      treeProps: { label: 'name', children: 'children' },
    };
  },
  methods: {
    handleNodeClick(data) {
      this.$emit('select', data.id);
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
    async handleRename(data) {
      try {
        const { value } = await ElMessageBox.prompt('请输入新名称', '重命名分类', {
          confirmButtonText: '保存',
          cancelButtonText: '取消',
          inputValue: data.name,
        });
        if (value && value.trim()) {
          this.$emit('rename', { id: data.id, name: value.trim() });
        }
      } catch {
        // cancel
      }
    },
    handleDelete(data) {
      this.$emit('delete', data.id);
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
  padding: 4px 8px;
  margin-bottom: 4px;
}

.header-title {
  font-size: 12px;
  color: var(--text-on-dark-secondary, #aaa);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tree-node {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 4px;
}

.node-label {
  font-size: 13px;
}

.node-label.active {
  color: var(--el-color-primary, #409eff);
  font-weight: 500;
}

.node-actions {
  display: none;
  gap: 2px;
}

:deep(.el-tree-node__content:hover) .node-actions {
  display: flex;
}
</style>
