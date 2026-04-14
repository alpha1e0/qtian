import { registerCommonHandlers } from './common.handler';
import { registerConsoleHandlers } from './console.handler';
import { registerAiAssistantHandlers } from './ai-assistant.handler';

/**
 * Register all IPC handlers
 */
export function registerAllHandlers(): void {
  registerCommonHandlers();
  registerConsoleHandlers(); // Dev mode console forwarding
  registerAiAssistantHandlers();
}
