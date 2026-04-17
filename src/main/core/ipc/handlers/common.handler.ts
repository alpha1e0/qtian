import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../channels';
import { config, wpath } from '@/core/common/context';
import { VERSION } from '@/core/common/constants';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('IPC:Common');

/**
 * Register common IPC handlers
 */
export function registerCommonHandlers(): void {
  // Get application version
  ipcMain.handle(IPC_CHANNELS.GET_VERSION, async () => {
    logger.debug('Get application version');
    return VERSION;
  });

  // Get current config
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, async () => {
    logger.debug('Get current config');
    return {
      aiAssistant: {
        defaultAgent: config.aiAssistant.defaultAgent,
        defaultLlmConfig: config.aiAssistant.defaultLlmConfig,
      },
    };
  });

  // Read config from file
  ipcMain.handle(IPC_CHANNELS.READ_CONFIG, async () => {
    logger.debug('Read config from file');
    const fs = await import('fs/promises');
    // Use unified config path from wpath: {workspace}/qtian.json
    const configPath = wpath.configPath;

    try {
      const data = await fs.readFile(configPath, 'utf-8');
      logger.info('Config file read successfully');
      return JSON.parse(data);
    } catch (err) {
      logger.error('Failed to read config file', err);
      // Error will be handled by caller
      throw new Error('Failed to read config file');
    }
  });
}
