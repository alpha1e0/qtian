<template>
  <!--
    纯 Markdown 编辑面板：右侧列主体。
    上方极简工具栏（标题 + 保存状态 + 元数据按钮 + 保存按钮），下方 Vditor 占满。
  -->
  <div class="note-doc-editor-inner">
    <!-- 极简工具栏 -->
    <div class="editor-toolbar">
      <span class="doc-title" :title="docTitle">{{ docTitle || '未命名文档' }}</span>
      <span class="save-status" :class="`is-${saveStatus}`" aria-live="polite">
        <el-icon v-if="saveStatus === 'saving'" class="is-loading"><Loading /></el-icon>
        <el-icon v-else-if="saveStatus === 'saved'"><Check /></el-icon>
        <el-icon v-else-if="saveStatus === 'error'"><Close /></el-icon>
        <template v-if="saveStatus === 'saving'">保存中…</template>
        <template v-else-if="saveStatus === 'saved'">已保存</template>
        <template v-else-if="saveStatus === 'error'">保存失败</template>
      </span>
      <span class="word-count">{{ contentLength }} 字</span>
      <div class="toolbar-actions">
        <el-button
          text
          size="small"
          title="编辑文档信息"
          aria-label="编辑文档信息"
          @click="$emit('open-metadata', docId)"
        >
          <el-icon><InfoFilled /></el-icon>
        </el-button>
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

    <!-- Vditor 编辑器：占满剩余空间 -->
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
        <div class="replace-dialog-header">
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
        <div class="replace-dialog-footer">
          <el-button type="primary" @click="doReplace" aria-label="确认替换">确认</el-button>
          <el-button @click="cancelReplace" aria-label="取消替换">取消</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus';
import { Loading, Check, Close, Select, InfoFilled } from '@element-plus/icons-vue';
import Vditor from 'vditor';
import 'vditor/dist/index.css';

/** 自动保存间隔（毫秒） */
const AUTO_SAVE_INTERVAL = 30000;

/**
 * NoteDocEditor —— 纯 Markdown 内联编辑面板。
 *
 * 工具栏仅显示标题（只读）+ 保存状态 + 元数据入口 + 保存按钮。
 * Vditor 占满下方全部空间。元数据编辑通过弹窗（NoteMetadataDialog）完成。
 */
export default {
  name: 'NoteDocEditor',
  components: { Loading, Check, Close, Select, InfoFilled },
  emits: ['updated', 'open-metadata'],
  props: {
    docId: { type: Number, required: true },
  },
  data() {
    return {
      vditor: null,
      docTitle: '',
      currentContent: '',
      saving: false,
      saveStatus: 'idle',
      saveTimer: null,
      contentLength: 0,
      autoSaveTimerId: null,
      isLoadingDoc: false,
      /** 标记 loadDoc 是否已完成，用于 watch docId 时判断 */
      initialized: false,
      /** 文本替换对话框 */
      replacementVisible: false,
      replacementForm: { source: '', dst: '' },
    };
  },
  watch: {
    docId() {
      this.loadDoc();
    },
  },
  mounted() {
    document.addEventListener('keydown', this.handleKeyDown);
    this.loadDoc();
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.handleKeyDown);
    this.stopAutoSave();
    this.destroyEditor();
    if (this.saveTimer) clearTimeout(this.saveTimer);
  },
  methods: {
    // ====================================================================
    // 文档加载
    // ====================================================================
    async loadDoc() {
      if (!this.docId) {
        this.docTitle = '';
        this.currentContent = '';
        return;
      }
      this.isLoadingDoc = true;
      try {
        const doc = await window.noteApp.getDoc(this.docId);
        if (!doc) {
          this.docTitle = '';
          this.currentContent = '';
          return;
        }
        this.docTitle = doc.title || '';
        this.currentContent = doc.content || '';

        // 先销毁旧编辑器（切换文档时），再等 DOM 更新后初始化新编辑器
        this.destroyEditor();
        await this.$nextTick();
        await this.initEditor();
        this.startAutoSave();
      } catch (err) {
        console.error('load doc failed', err);
        ElMessage.error('加载文档失败');
      } finally {
        this.isLoadingDoc = false;
        this.initialized = true;
      }
    },

    // ====================================================================
    // Vditor 生命周期
    // ====================================================================
    async initEditor() {
      if (this.vditor) return;
      const container = this.$refs.editorRef;
      if (!container || !container.isConnected) {
        console.warn('NoteDocEditor: editorRef unavailable, skip init');
        return;
      }
      this.vditor = new Vditor(container, {
        minHeight: 200,
        height: '100%',
        mode: 'ir',
        placeholder: '在此输入 Markdown...',
        value: this.currentContent,
        lang: 'zh_CN',
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
          'quote', 'line', 'code', 'inline-code', '|',
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
          accept: 'image/*',
          max: 8 * 1024 * 1024,
          fieldName: 'file',
          handler: (files) => this.handleUpload(files),
        },
        after: () => {
          if (this.vditor) {
            this.vditor.setValue(this.currentContent || '');
          }
        },
      });
    },
    destroyEditor() {
      if (this.vditor) {
        try {
          if (this.vditor.element && this.vditor.element.isConnected) {
            this.vditor.destroy();
          }
        } catch (err) {
          console.warn('vditor destroy failed', err);
        }
        this.vditor = null;
      }
    },

    // ====================================================================
    // 自动保存
    // ====================================================================
    startAutoSave() {
      this.stopAutoSave();
      this.autoSaveTimerId = setInterval(() => this.autoSaveContent(), AUTO_SAVE_INTERVAL);
    },
    stopAutoSave() {
      if (this.autoSaveTimerId) {
        clearInterval(this.autoSaveTimerId);
        this.autoSaveTimerId = null;
      }
    },
    async autoSaveContent() {
      if (!this.docId || this.isLoadingDoc || this.saving) return;
      try {
        await this.persistContent();
      } catch (err) {
        console.error('auto save content failed:', err);
      }
    },

    // ====================================================================
    // 手动保存
    // ====================================================================
    async handleManualSave() {
      if (this.saving) return;
      this.saving = true;
      try {
        await this.persistContent();
        ElMessage.success('文档已保存');
        this.$emit('updated');
      } catch (err) {
        ElMessage.error(err?.message || '保存失败');
      } finally {
        this.saving = false;
      }
    },
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

    // ====================================================================
    // 持久化
    // ====================================================================
    async persistContent() {
      if (!this.vditor) return;
      const content = this.vditor.getValue();
      this.setSaving();
      try {
        await window.noteApp.updateDoc(this.docId, { content });
        this.setSaved();
      } catch (err) {
        this.setError();
        throw err;
      }
    },

    // ====================================================================
    // 图片上传
    // ====================================================================
    async handleUpload(files) {
      if (!files || files.length === 0 || !this.vditor) return null;
      let hasError = false;
      for (const file of files) {
        try {
          let url;
          if (file.path) {
            url = await window.noteApp.saveAttachmentFromPath(file.path);
          } else {
            const buf = await file.arrayBuffer();
            const ext = this.getExtension(file.name);
            url = await window.noteApp.saveAttachment(
              Array.from(new Uint8Array(buf)),
              ext,
            );
          }
          const md = `![${file.name}](${url})\n`;
          this.vditor.insertValue(md);
        } catch (err) {
          hasError = true;
          ElMessage.error(`上传失败: ${file.name}`);
          console.error(err);
        }
      }
      return hasError ? '部分文件上传失败' : null;
    },

    // ====================================================================
    // 工具方法
    // ====================================================================
    setSaving() {
      this.saveStatus = 'saving';
    },
    setSaved() {
      this.saveStatus = 'saved';
      this.scheduleIdle();
    },
    setError() {
      this.saveStatus = 'error';
      this.scheduleIdle();
    },
    scheduleIdle() {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveStatus = 'idle';
      }, 2000);
    },
    getExtension(filename) {
      const idx = filename.lastIndexOf('.');
      return idx >= 0 ? filename.slice(idx) : '';
    },

    // ====================================================================
    // 文本替换（支持正则）
    // ====================================================================
    doReplace() {
      if (!this.vditor) return;
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

    // ====================================================================
    // 图片样式替换：markdown ![]() → <img> 标签
    // ====================================================================
    doReplaceImg() {
      if (!this.vditor) return;
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

    // ====================================================================
    // 纯文本粘贴：从剪贴板读取并追加到末尾
    // ====================================================================
    async rawPaste() {
      if (!this.vditor) return;
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
    /**
     * 外部刷新标题（元数据弹窗保存后调用）。
     */
    refreshTitle() {
      if (!this.docId) return;
      window.noteApp.getDoc(this.docId).then((doc) => {
        if (doc) this.docTitle = doc.title || '';
      }).catch(() => {});
    },
  },
};
</script>

<style scoped>
.note-doc-editor-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--surface-card, #ffffff);
}

/* ===== 极简工具栏 ===== */
.editor-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  border-bottom: 1px solid rgba(99, 102, 241, 0.10);
  background: rgba(243, 241, 236, 0.55);
}

.doc-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-on-dark, #1f1e2e);
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-status {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.save-status.is-saving { color: var(--text-on-dark-muted, #908e9f); }
.save-status.is-saved { color: #10b981; }
.save-status.is-error { color: var(--color-danger, #ef4444); }

.word-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-on-dark-muted, #908e9f);
  font-feature-settings: 'tnum';
}

.toolbar-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ===== Vditor 容器：占满剩余空间 ===== */
.vditor-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--surface-card, #ffffff);
}

/* ===== 文本替换对话框 ===== */
.replace-dialog-header {
  margin: 3px 8px 10px 10px;
}

.replace-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}
</style>

<style>
/* Vditor 全局样式覆盖（note-app 编辑器） */
.note-doc-editor-inner .vditor {
  border: none !important;
  border-radius: 0 !important;
}

.note-doc-editor-inner .vditor-toolbar {
  background: rgba(243, 241, 236, 0.6) !important;
  border-bottom: 1px solid rgba(99, 102, 241, 0.08) !important;
}

.note-label-popper {
  z-index: 3000 !important;
}
</style>
