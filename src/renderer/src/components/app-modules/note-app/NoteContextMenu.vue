<template>
  <!--
    自封装右键菜单：fixed 定位跟随鼠标 (clientX, clientY)。
    Teleport 到 body 避免祖先 transform / overflow 干扰 fixed 定位。
    视口边界翻转：右/下放不下时翻到左/上。
    点外面 / ESC / 滚动 / 再次右键 → 关闭。
  -->
  <Teleport to="body">
    <ul
      v-if="visible"
      ref="menuRef"
      class="el-dropdown-menu note-ctx-menu"
      :style="menuStyle"
      role="menu"
      @click.stop
      @contextmenu.prevent.stop="onReContext"
    >
      <template v-for="(item, idx) in items" :key="item.command + '-' + idx">
        <li v-if="item.divided" class="el-dropdown-menu__item--divided el-popper-divider" />
        <li
          class="el-dropdown-menu__item note-ctx-item"
          :class="{ 'is-disabled': item.disabled }"
          role="menuitem"
          @click="onItemClick(item)"
        >
          <el-icon v-if="item.icon" class="note-ctx-icon">
            <component :is="item.icon" />
          </el-icon>
          <span>{{ item.label }}</span>
        </li>
      </template>
    </ul>
  </Teleport>
</template>

<script>
import { markRaw } from 'vue';

/**
 * 通用右键菜单（跟鼠标）。
 * items 结构：{ command, label, icon?, disabled?, divided? }
 */
export default {
  name: 'NoteContextMenu',
  props: {
    visible: { type: Boolean, default: false },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    items: { type: Array, default: () => [] },
  },
  emits: ['command', 'close'],
  data() {
    return {
      renderX: 0,
      renderY: 0,
    };
  },
  computed: {
    menuStyle() {
      return {
        left: `${this.renderX}px`,
        top: `${this.renderY}px`,
      };
    },
  },
  watch: {
    visible(v) {
      if (v) {
        this.renderX = this.x;
        this.renderY = this.y;
        this.$nextTick(() => {
          this.adjustForViewport();
          this.attachListeners();
        });
      } else {
        this.detachListeners();
      }
    },
  },
  beforeUnmount() {
    this.detachListeners();
  },
  methods: {
    adjustForViewport() {
      const el = this.$refs.menuRef;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = this.x;
      let y = this.y;
      if (x + rect.width > vw - 4) {
        x = Math.max(4, this.x - rect.width);
      }
      if (y + rect.height > vh - 4) {
        y = Math.max(4, this.y - rect.height);
      }
      this.renderX = x;
      this.renderY = y;
    },
    onItemClick(item) {
      if (item.disabled) return;
      this.$emit('command', { command: item.command, icon: markRaw(item.icon) });
      this.$emit('close');
    },
    onReContext() {
      this.$emit('close');
    },
    onDocClick() {
      this.$emit('close');
    },
    onEsc() {
      this.$emit('close');
    },
    onScroll() {
      this.$emit('close');
    },
    attachListeners() {
      document.addEventListener('click', this.onDocClick);
      document.addEventListener('contextmenu', this.onDocClick);
      document.addEventListener('keydown', this.onEsc);
      window.addEventListener('scroll', this.onScroll, true);
      window.addEventListener('resize', this.onScroll, true);
    },
    detachListeners() {
      document.removeEventListener('click', this.onDocClick);
      document.removeEventListener('contextmenu', this.onDocClick);
      document.removeEventListener('keydown', this.onEsc);
      window.removeEventListener('scroll', this.onScroll, true);
      window.removeEventListener('resize', this.onScroll, true);
    },
  },
};
</script>

<style scoped>
.note-ctx-menu {
  position: fixed;
  z-index: 3000;
  min-width: 180px;
  padding: 6px 0;
  margin: 0;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  list-style: none;
  user-select: none;
}

.note-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-size: 13px;
  color: var(--el-text-color-primary, #303133);
  cursor: pointer;
  transition: background 0.15s ease;
}

.note-ctx-item:hover {
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-color-primary, #409eff);
}

.note-ctx-item.is-disabled {
  color: var(--el-text-color-disabled, #c0c4cc);
  cursor: not-allowed;
}

.note-ctx-item.is-disabled:hover {
  background: transparent;
  color: var(--el-text-color-disabled, #c0c4cc);
}

.note-ctx-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.note-ctx-menu .el-popper-divider {
  height: 1px;
  margin: 4px 0;
  padding: 0;
  background: var(--el-border-color-lighter, #ebeef5);
}
</style>
