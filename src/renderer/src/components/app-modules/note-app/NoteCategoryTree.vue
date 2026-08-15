<template>
  <div class="note-category-tree">
    <div class="tree-header">
      <el-button
        text
        @click="handleCreateRootCategory"
        title="新建根分类"
        aria-label="新建根分类"
      >
        <el-icon><FolderAdd /></el-icon>
      </el-button>
      <el-button
        text
        @click="handleCreateDocFromHeader"
        title="新建文档"
        aria-label="新建文档"
      >
        <el-icon><DocumentAdd /></el-icon>
      </el-button>
      <el-button
        text
        @click="expandAll"
        title="全部展开"
        aria-label="全部展开"
      >
        <el-icon><Expand /></el-icon>
      </el-button>
      <el-button
        text
        @click="collapseAll"
        title="全部折叠"
        aria-label="全部折叠"
      >
        <el-icon><Fold /></el-icon>
      </el-button>
    </div>

    <el-tree
      ref="treeRef"
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
        <div
          class="tree-node"
          :class="{
            'is-doc': data.__type === 'doc',
          }"
          @contextmenu="onNodeContextMenu($event, data)"
        >
          <span
            class="node-label"
            :class="{ active: data.nodeKey === selectedNodeKey }"
            :title="node.label"
          >
            <el-icon v-if="data.__type === 'category'" class="node-icon">
              <Folder />
            </el-icon>
            <el-icon v-else class="node-icon"><Document /></el-icon>
            {{ node.label }}
            <span v-if="data.__type === 'category'" class="doc-count">{{ data.doc_count ?? 0 }}</span>
          </span>
        </div>
      </template>
    </el-tree>

    <NoteContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      @command="onContextMenuCommand"
      @close="ctxMenu.visible = false"
    />

    <NoteCreateDialog
      v-model:visible="createDialog.visible"
      :mode="createDialog.mode"
      :parent-name="createDialog.parentData?.name || ''"
      :initial-name="dialogInitialName"
      :all-labels="labels"
      :category-options="categoryOptions"
      @confirm="onCreateDialogConfirm"
    />
  </div>
</template>

<script>
import {
  Folder,
  Document,
  FolderAdd,
  DocumentAdd,
  Edit,
  Delete,
  Expand,
  Fold,
  InfoFilled,
} from '@element-plus/icons-vue';
import { markRaw } from 'vue';
import NoteContextMenu from './NoteContextMenu.vue';
import NoteCreateDialog from './NoteCreateDialog.vue';

/**
 * NoteCategoryTree —— 分类树（含 doc 叶子节点）。
 *
 * 树节点结构：
 *   - category: { __type: 'category', nodeKey: 'cat_<id>', id, name, children, doc_count }
 *   - doc:      { __type: 'doc', nodeKey: 'doc_<id>', id, name(title), category_id }
 *
 * 事件：
 *   - select({ type, id })        —— 节点点击
 *   - create-category(payload)    —— 新建分类（{ parentId?, name }）
 *   - rename-category(payload)    —— 重命名分类（{ id, name }）
 *   - delete-category(id)         —— 删除分类
 *   - create-doc(payload)         —— 新建文档（{ categoryId?, name, labelIds? }）
 *   - rename-doc(payload)         —— 重命名文档（{ id, name }）
 *   - delete-doc(id)              —— 删除文档
 */
export default {
  name: 'NoteCategoryTree',
  components: {
    Folder,
    Document,
    Expand,
    Fold,
    NoteContextMenu,
    NoteCreateDialog,
  },
  props: {
    treeData: { type: Array, default: () => [] },
    selectedNodeKey: { type: String, default: null },
    labels: { type: Array, default: () => [] },
    /** 分类下拉选项（供 NoteCreateDialog doc 模式选择分类） */
    categoryOptions: { type: Array, default: () => [] },
  },
  emits: [
    'select', 'create-category', 'rename-category', 'delete-category',
    'create-doc', 'rename-doc', 'delete-doc', 'edit-metadata-doc',
  ],
  data() {
    return {
      treeProps: { label: 'name', children: 'children' },
      ctxMenu: {
        visible: false,
        x: 0,
        y: 0,
        items: [],
        targetData: null,
      },
      icons: {
        folderAdd: markRaw(FolderAdd),
        documentAdd: markRaw(DocumentAdd),
        edit: markRaw(Edit),
        delete: markRaw(Delete),
        info: markRaw(InfoFilled),
      },
      createDialog: {
        visible: false,
        mode: 'root-category',
        parentData: null,
      },
    };
  },
  computed: {
    dialogInitialName() {
      const { mode, parentData } = this.createDialog;
      if ((mode === 'rename-category' || mode === 'rename-doc') && parentData) {
        return parentData.name || '';
      }
      return '';
    },
  },
  methods: {
    handleNodeClick(data) {
      this.$emit('select', { type: data.__type, id: data.id });
    },
    onNodeContextMenu(event, data) {
      // el-tree node-contextmenu 已处理，此处是 DOM contextmenu fallback
    },
    onTreeContextMenu(event, data) {
      if (!data) return;
      // 虚拟"无分类"节点（id=0，category_id=null 的文档聚合）禁用右键菜单：
      // 不 preventDefault、不弹空菜单，直接 return 让浏览器默认 contextmenu 触发，
      // 避免对不可操作的虚拟节点执行删除/重命名等导致后端 FK 约束报错。
      if (data.__type === 'category' && data.id === 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.ctxMenu.x = event.clientX;
      this.ctxMenu.y = event.clientY;
      this.ctxMenu.targetData = data;
      this.ctxMenu.items = this.buildMenuItems(data);
      this.ctxMenu.visible = true;
    },
    buildMenuItems(data) {
      // 虚拟"无分类"节点不应暴露任何操作项
      if (data.__type === 'category' && data.id === 0) return [];
      if (data.__type === 'category') {
        return [
          { command: 'create-sub-category', label: '新建子分类', icon: this.icons.folderAdd },
          { command: 'create-doc', label: '新建文档', icon: this.icons.documentAdd },
          { command: 'rename', label: '重命名分类', icon: this.icons.edit, divided: true },
          { command: 'delete', label: '删除分类', icon: this.icons.delete },
        ];
      }
      // doc 节点
      return [
        { command: 'rename', label: '重命名文档', icon: this.icons.edit },
        { command: 'edit-metadata', label: '编辑元数据', icon: this.icons.info },
        { command: 'delete', label: '删除文档', icon: this.icons.delete, divided: true },
      ];
    },
    onContextMenuCommand({ command }) {
      const data = this.ctxMenu.targetData;
      this.ctxMenu.visible = false;
      if (!data) return;

      switch (command) {
        case 'create-sub-category':
          this.openCreateDialog('child-category', data);
          break;
        case 'create-doc':
          this.openCreateDialog('doc', data);
          break;
        case 'rename':
          if (data.__type === 'category') {
            this.openCreateDialog('rename-category', data);
          } else {
            this.openCreateDialog('rename-doc', data);
          }
          break;
        case 'edit-metadata':
          this.$emit('edit-metadata-doc', data.id);
          break;
        case 'delete':
          if (data.__type === 'category') {
            this.$emit('delete-category', data.id);
          } else {
            this.$emit('delete-doc', data.id);
          }
          break;
      }
    },
    openCreateDialog(mode, parentData = null) {
      this.createDialog.mode = mode;
      this.createDialog.parentData = parentData;
      this.createDialog.visible = true;
    },
    handleCreateRootCategory() {
      this.openCreateDialog('root-category');
    },
    handleCreateDocFromHeader() {
      this.openCreateDialog('doc');
    },
    onCreateDialogConfirm(payload) {
      const { mode, parentData } = this.createDialog;
      switch (mode) {
        case 'root-category':
          this.$emit('create-category', { parentId: null, name: payload.name });
          break;
        case 'child-category':
          this.$emit('create-category', { parentId: parentData?.id ?? null, name: payload.name });
          break;
        case 'doc': {
          const categoryId = parentData?.__type === 'category' ? parentData.id : payload.categoryId ?? null;
          this.$emit('create-doc', {
            categoryId,
            name: payload.name,
            labelIds: payload.labelIds || [],
          });
          break;
        }
        case 'rename-category':
          this.$emit('rename-category', { id: parentData.id, name: payload.name });
          break;
        case 'rename-doc':
          this.$emit('rename-doc', { id: parentData.id, name: payload.name });
          break;
      }
    },
    expandAll() {
      const treeRef = this.$refs.treeRef;
      if (!treeRef) return;
      const traverse = (nodes) => {
        for (const n of nodes) {
          treeRef.store.nodesMap[n.nodeKey]?.expand();
          if (n.children?.length) traverse(n.children);
        }
      };
      traverse(this.treeData);
    },
    collapseAll() {
      const treeRef = this.$refs.treeRef;
      if (!treeRef) return;
      const traverse = (nodes) => {
        for (const n of nodes) {
          treeRef.store.nodesMap[n.nodeKey]?.collapse();
          if (n.children?.length) traverse(n.children);
        }
      };
      traverse(this.treeData);
    },
  },
};
</script>

<style scoped>
.note-category-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.tree-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(99, 102, 241, 0.08);
  flex-shrink: 0;
}

.tree-header :deep(.el-button) {
  padding: 4px 6px;
  color: var(--text-on-dark-secondary, #5f5e6e);
}

.tree-header :deep(.el-button:hover) {
  color: var(--accent, #6366f1);
  background: rgba(99, 102, 241, 0.08);
}

.note-category-tree :deep(.el-tree) {
  flex: 1;
  overflow-y: auto;
  background: transparent;
  --el-tree-node-hover-bg-color: rgba(99, 102, 241, 0.06);
}

.note-category-tree :deep(.el-tree-node__content) {
  height: 30px;
  padding-left: 0 !important;
}

.note-category-tree :deep(.el-tree-node__content:hover) {
  background: rgba(99, 102, 241, 0.04);
}

.tree-node {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  padding-right: 8px;
}

.node-label {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-on-dark, #1f1e2e);
  letter-spacing: 0.01em;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
  overflow: hidden;
}

.node-label .node-icon {
  font-size: 14px;
  flex-shrink: 0;
  color: var(--text-on-dark-muted, #908e9f);
}

.node-label.active {
  font-weight: 600;
  color: var(--accent, #6366f1);
  background: rgba(99, 102, 241, 0.10);
}

.tree-node.is-doc .node-label .node-icon {
  color: var(--accent-text, #4f46e5);
}

.doc-count {
  flex-shrink: 0;
  margin-left: 4px;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-on-dark-muted, #908e9f);
  background: rgba(99, 102, 241, 0.08);
  border-radius: 999px;
  line-height: 16px;
}

.node-label.active .doc-count {
  background: rgba(99, 102, 241, 0.20);
  color: var(--accent, #6366f1);
}
</style>
