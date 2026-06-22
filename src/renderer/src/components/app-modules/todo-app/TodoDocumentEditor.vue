<template>
  <div class="todo-doc-editor">
    <!-- 顶部工具条：标题路径 + 字数统计 + 保存/返回 -->
    <div class="md-editor-toolbar">
      <div class="md-editor-toolbar-title">
        <el-button
          size="small"
          text
          aria-label="返回"
          class="back-btn"
          @click="handleBack"
        >
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <el-text size="small" type="info" truncated class="title-path">
          {{ titlePath || docName || '未命名文档' }}
        </el-text>
        <el-text size="small" type="info" class="word-count">{{ contentLength }} 字</el-text>
      </div>
      <div class="md-editor-toolbar-op">
        <el-button
          size="small"
          :loading="saving"
          type="primary"
          plain
          aria-label="保存文档"
          @click="handleManualSave"
        >
          <el-icon><Select /></el-icon>
          <span>保存</span>
        </el-button>
      </div>
    </div>

    <el-input
      v-model="docName"
      placeholder="文档名称"
      size="small"
      class="doc-name-input"
    />

    <div ref="editorRef" class="vditor-container" />

    <!-- 文本替换对话框 -->
    <el-dialog
      v-model="replacementVisible"
      width="350"
      draggable
      append-to-body
      @keyup.enter.stop="doReplace"
      @opened="onReplaceDialogOpened"
    >
      <template #header>
        <div class="custom-dialog-header">
          <el-text type="info" size="large">替换</el-text>
        </div>
      </template>
      <el-form :model="replacementForm">
        <el-form-item label="源" label-width="50px">
          <el-input
            ref="replaceSourceInput"
            v-model="replacementForm.source"
            autocomplete="off"
            placeholder="输入要查找的文本（支持正则）"
            aria-label="源文本"
          />
        </el-form-item>
        <el-form-item label="替换为" label-width="50px">
          <el-input
            v-model="replacementForm.dst"
            autocomplete="off"
            placeholder="输入替换后的内容"
            aria-label="目标文本"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button type="primary" @click="doReplace" aria-label="确认替换">确认</el-button>
          <el-button @click="cancelReplace" aria-label="取消替换">取消</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus';
import { ArrowLeft, Select } from '@element-plus/icons-vue';

/** 自动保存间隔（毫秒） */
const AUTO_SAVE_INTERVAL = 30000;
/** 支持的图片扩展名（小写） */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

/**
 * TodoDocumentEditor — vditor Markdown 编辑器
 *
 * 对齐参考实现 `tmp/vditor-example.vue` 的生产力功能：
 * - 顶部工具条：标题路径 + 字数统计 + 手动保存
 * - 自动保存（30s 间隔，加载中跳过）
 * - 手动保存 Ctrl+S
 * - 文本替换 Ctrl+R（支持正则）
 * - 图片样式替换（markdown img → <img> 标签）
 * - 纯文本粘贴（追加剪贴板文本）
 * - 附件上传：file.path 走主进程读文件，剪贴板走 buffer
 *
 * 协议策略：统一使用 `local-resource://`（项目复用），不引入 `local-resource-md://`。
 */
export default {
  name: 'TodoDocumentEditor',
  components: { ArrowLeft, Select },
  props: {
    docId: { type: Number, default: null },
    itemId: { type: Number, default: null },
    categoryId: { type: Number, default: null },
    /** 顶部展示的标题路径（例如 "待办条目标题 / 文档名"），由父组件拼装 */
    titlePath: { type: String, default: '' },
  },
  emits: ['saved', 'back'],
  data() {
    return {
      vditor: null,
      docName: '',
      currentContent: '',
      saving: false,
      loaded: false,
      contentLength: 0,
      autoSaveTimerId: null,
      isLoadingDoc: false,
      replacementVisible: false,
      replacementForm: { source: '', dst: '' },
    };
  },
  async mounted() {
    await this.loadDocument();
    await this.initEditor();
    document.addEventListener('keydown', this.handleKeyDown);
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.handleKeyDown);
    this.stopAutoSave();
    if (this.vditor) {
      this.vditor.destroy();
      this.vditor = null;
    }
  },
  methods: {
    /** 加载已有文档内容；新建时给默认值 */
    async loadDocument() {
      if (this.docId) {
        this.isLoadingDoc = true;
        try {
          const doc = await window.todoApp.getDocument(this.docId);
          if (doc) {
            this.docName = doc.name;
            this.currentContent = doc.content || '';
          }
        } catch (err) {
          ElMessage.error('加载文档失败');
          console.error(err);
        } finally {
          this.isLoadingDoc = false;
        }
      } else {
        this.docName = '新文档';
        this.currentContent = '';
      }
    },
    /** 初始化 vditor 实例 */
    async initEditor() {
      const VditorModule = await import('vditor');
      const Vditor = VditorModule.default;

      this.vditor = new Vditor(this.$refs.editorRef, {
        minHeight: 400,
        height: 'calc(100vh - 180px)',
        mode: 'ir',
        placeholder: '在此输入 Markdown...',
        value: this.currentContent,
        // CDN 本地化：开发态 Vite dev server 可解析；生产打包需 Phase 6 复制 dist 到 resources
        cdn: 'node_modules/vditor/dist',
        cache: { enable: false },
        counter: {
          enable: true,
          after: (length) => {
            this.contentLength = length;
          },
        },
        toolbar: [
          'edit-mode', '|',
          'headings', 'bold', 'italic', 'strike', 'link', '|',
          'emoji', 'check', 'table', 'list', 'ordered-list', 'outdent', 'indent', '|',
          'quote', 'line', 'code', 'inline-code', 'insert-before', '|',
          'undo', 'redo',
          {
            name: 'text-replace',
            tipPosition: 's',
            tip: '文本替换 (Ctrl+R)',
            className: 'text-replace-btn',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M1 8a7 7 0 1 0 14 0A7 7 0 0 0 1 8Zm15 0A8 8 0 1 1 0 8a8 8 0 0 1 16 0ZM5.5 4.002h3.11c1.71 0 2.741.973 2.741 2.46 0 1.138-.667 1.94-1.495 2.24L11.5 12H9.98L8.52 8.924H6.836V12H5.5V4.002Zm1.335 1.09v2.777h1.549c.995 0 1.573-.463 1.573-1.36 0-.913-.596-1.417-1.537-1.417H6.835Z"/></svg>',
            click: () => { this.replacementVisible = true; },
          },
          {
            name: 'img-replace',
            tipPosition: 's',
            tip: '图片样式替换',
            className: 'img-replace-btn',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8.235 1.559a.5.5 0 0 0-.47 0l-7.5 4a.5.5 0 0 0 0 .882L3.188 8 .264 9.559a.5.5 0 0 0 0 .882l7.5 4a.5.5 0 0 0 .47 0l7.5-4a.5.5 0 0 0 0-.882L12.813 8l2.922-1.559a.5.5 0 0 0 0-.882l-7.5-4zM8 9.433 1.562 6 8 2.567 14.438 6 8 9.433z"/></svg>',
            click: () => this.doReplaceImg(),
          },
          {
            name: 'raw-paste',
            tipPosition: 's',
            tip: '纯文本粘贴',
            className: 'raw-paste-btn',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M0 1.5V13a1 1 0 0 0 1 1V1.5a.5.5 0 0 1 .5-.5H14a1 1 0 0 0-1-1H1.5A1.5 1.5 0 0 0 0 1.5z"/><path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v11A1.5 1.5 0 0 0 3.5 16h6.086a1.5 1.5 0 0 0 1.06-.44l4.915-4.914A1.5 1.5 0 0 0 16 9.586V3.5A1.5 1.5 0 0 0 14.5 2h-11zm6 8.5a1 1 0 0 1 1-1h4.396a.25.25 0 0 1 .177.427l-5.146 5.146a.25.25 0 0 1-.427-.177V10.5z"/></svg>',
            click: () => this.rawPaste(),
          },
          { name: 'more', toolbar: ['export', 'outline', 'preview', 'help'] },
        ],
        upload: {
          accept: 'image/*,.mp3,.wav',
          max: 8 * 1024 * 1024,
          fieldName: 'file',
          handler: (files) => this.handleUpload(files),
        },
        after: () => {
          // 同步初始内容到编辑器，避免 value 未生效
          this.vditor.setValue(this.currentContent || '');
          this.loaded = true;
          this.startAutoSave();
        },
      });
    },
    /** 启动自动保存定时器（防重） */
    startAutoSave() {
      this.stopAutoSave();
      this.autoSaveTimerId = setInterval(() => this.autoSaveDocument(), AUTO_SAVE_INTERVAL);
    },
    stopAutoSave() {
      if (this.autoSaveTimerId) {
        clearInterval(this.autoSaveTimerId);
        this.autoSaveTimerId = null;
      }
    },
    /** 自动保存：加载中或无 docId 时跳过 */
    async autoSaveDocument() {
      if (!this.docId || this.isLoadingDoc || this.saving) return;
      try {
        await this.persistDocument(true);
      } catch (err) {
        console.error('auto save failed:', err);
      }
    },
    /** 手动保存（按钮或 Ctrl+S）：含 UI 反馈 */
    async handleManualSave() {
      if (this.saving) return;
      if (!this.docName || !this.docName.trim()) {
        ElMessage.warning('请输入文档名称');
        return;
      }
      this.saving = true;
      try {
        await this.persistDocument(false);
        ElMessage.success('文档已保存');
        this.$emit('saved');
      } catch (err) {
        ElMessage.error(err.message || '保存失败');
      } finally {
        this.saving = false;
      }
    },
    /**
     * 持久化文档到主进程。
     * - 新建（无 docId）：创建后回填 docId 不在组件内做（父组件通过 saved 事件重新打开）
     * - 已存在：仅更新 name + content
     * @param isAuto - 自动保存为 true，跳过空内容保存并吞掉异常
     */
    async persistDocument(isAuto) {
      const content = this.vditor ? this.vditor.getValue() : this.currentContent;
      // 空内容不持久化，避免覆盖历史
      if (!content || !content.trim()) {
        return;
      }
      const payload = {
        id: this.docId || undefined,
        name: this.docName.trim(),
        content,
        todo_item_id: this.itemId ?? null,
        todo_category_id: this.categoryId ?? null,
      };
      await window.todoApp.saveDocument(payload);
      if (isAuto) {
        // 自动保存静默通知父组件可刷新标题
        this.$emit('saved');
      }
    },
    /**
     * 附件上传 handler：
     * - file.path 存在（用户选择文件）→ 走 saveAttachmentFromPath，主进程读盘，避免 IPC buffer 序列化
     * - 否则（剪贴板粘贴）→ 渲染进程读取 arrayBuffer 后走 saveAttachment
     * 返回 null 表示全部成功，非空字符串作为 vditor 错误提示。
     */
    async handleUpload(files) {
      if (!files || files.length === 0) return null;
      let hasError = false;
      for (const file of files) {
        try {
          let url;
          if (file.path) {
            url = await window.todoApp.saveAttachmentFromPath(file.path);
          } else {
            const buf = await file.arrayBuffer();
            const ext = this.getExtension(file.name);
            url = await window.todoApp.saveAttachment(
              Array.from(new Uint8Array(buf)),
              ext,
            );
          }
          const ext = this.getExtension(file.name);
          const md = this.isImageExt(ext)
            ? `![${file.name}](${url})\n`
            : `[${file.name}](${url})\n`;
          this.vditor.insertValue(md);
        } catch (err) {
          hasError = true;
          ElMessage.error(`上传失败: ${file.name}`);
          console.error(err);
        }
      }
      return hasError ? '部分文件上传失败' : null;
    },
    /** 文本替换：支持正则，提示替换次数 */
    doReplace() {
      if (!this.replacementForm.source) {
        ElMessage.error('替换内容不能为空');
        this.replacementVisible = false;
        return;
      }
      let count = 0;
      let regex;
      try {
        regex = new RegExp(this.replacementForm.source, 'g');
      } catch (err) {
        ElMessage.error('正则表达式无效');
        return;
      }
      const original = this.vditor.getValue();
      const next = original.replace(regex, () => {
        count++;
        return this.replacementForm.dst;
      });
      if (count > 0) {
        this.vditor.setValue(next);
        ElMessage.success(`替换成功 ${count} 处`);
      } else {
        ElMessage.info(`未找到 ${this.replacementForm.source}`);
      }
      this.cancelReplace();
    },
    cancelReplace() {
      this.replacementForm.source = '';
      this.replacementForm.dst = '';
      this.replacementVisible = false;
    },
    onReplaceDialogOpened() {
      this.$nextTick(() => {
        this.$refs.replaceSourceInput?.focus?.();
      });
    },
    /** 图片样式替换：将 markdown ![]() 转为 <img height=400> 标签 */
    doReplaceImg() {
      const original = this.vditor.getValue();
      let count = 0;
      const regex = /!\[(.*?)\]\((.*?)\)/g;
      const next = original.replace(regex, (_m, p1, p2) => {
        count++;
        return `<img src='${p2}' height='400' alt='${p1}'/>`;
      });
      if (count > 0) {
        this.vditor.setValue(next);
        ElMessage.success(`成功替换 ${count} 处`);
      } else {
        ElMessage.info('未找到可替换内容');
      }
    },
    /** 纯文本粘贴：从剪贴板读取文本并追加到当前内容末尾 */
    async rawPaste() {
      try {
        const text = await navigator.clipboard.readText();
        const original = this.vditor.getValue();
        this.vditor.setValue(original + text);
        ElMessage.success('已粘贴纯文本');
      } catch (err) {
        ElMessage.error('剪贴板读取失败');
        console.error(err);
      }
    },
    handleBack() {
      this.$emit('back');
    },
    /** 全局键盘快捷键：Ctrl+S 保存，Ctrl+R 替换 */
    handleKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        this.handleManualSave();
      } else if (key === 'r') {
        event.preventDefault();
        this.replacementVisible = true;
      }
    },
    getExtension(filename) {
      const idx = filename.lastIndexOf('.');
      return idx >= 0 ? filename.slice(idx) : '';
    },
    isImageExt(ext) {
      return IMAGE_EXTENSIONS.includes(ext.toLowerCase());
    },
  },
};
</script>

<style scoped>
.todo-doc-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 8px 12px;
  box-sizing: border-box;
}

.md-editor-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  gap: 8px;
}

.md-editor-toolbar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.title-path {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.word-count {
  flex-shrink: 0;
  opacity: 0.7;
}

.back-btn {
  flex-shrink: 0;
}

.md-editor-toolbar-op {
  flex-shrink: 0;
}

.doc-name-input {
  flex-shrink: 0;
}

.vditor-container {
  flex: 1;
  min-height: 320px;
  border: 1px solid var(--border-medium);
  border-radius: 4px;
  overflow: hidden;
  background: var(--surface-card);
}

.custom-dialog-header {
  margin: 3px 8px 10px 10px;
}
</style>
