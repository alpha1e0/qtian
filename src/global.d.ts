/**
 * Global type definitions for Qtian application
 */

/**
 * Window interface extensions
 */
declare global {
  interface Window {
    electron: {
      // Common APIs
      getVersion(): Promise<string>;
      getConfig(): Promise<any>;
      readConfig(): Promise<void>;

      // Generic IPC event listeners
      ipcRendererOn(channel: string, callback: (...args: any[]) => void): void;
      ipcRendererOff(channel: string, callback: (...args: any[]) => void): void;

      // Legacy APIs
      getServerAddr(): Promise<string>;
      getTips(arg1: any): Promise<any>;

      // 窗口展开态（macOS=全屏，Win/Linux=最大化，见 spec 003 §6）
      isFullScreen(): Promise<boolean>;
    };

    aiAssistant: any;
    api: any;
  }
}

export {};
