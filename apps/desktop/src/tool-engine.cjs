const APP_TARGETS = Object.freeze({
  files: Object.freeze({ executable: 'explorer.exe', label: 'File Explorer' }),
  notepad: Object.freeze({ executable: 'notepad.exe', label: 'Notepad' }),
  calculator: Object.freeze({ executable: 'calc.exe', label: 'Calculator' }),
  'task-manager': Object.freeze({ executable: 'taskmgr.exe', label: 'Task Manager' }),
});

function createToolEngine({ confirm, launch, platform = process.platform }) {
  if (typeof confirm !== 'function' || typeof launch !== 'function') {
    throw new TypeError('Tool engine requires confirmation and execution adapters.');
  }

  async function execute(toolName, rawArgs) {
    if (toolName !== 'windows.launch_app') throw new Error('Tool is not registered or permitted.');
    if (platform !== 'win32') throw new Error('This tool is available on Windows only.');
    if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs) || Object.keys(rawArgs).some(key => key !== 'appId')) {
      throw new Error('Invalid tool arguments.');
    }
    const app = APP_TARGETS[rawArgs.appId];
    if (!app) throw new Error('Application is not in the approved launcher list.');
    const approved = await confirm({
      tool: toolName,
      title: 'Ultran permission request',
      message: 'Allow Ultran to launch ' + app.label + '?',
      detail: 'This action starts a Windows application. No other commands or arguments will be executed.',
    });
    if (approved !== true) return { approved: false, executed: false, reason: 'denied' };
    await launch(app.executable);
    return { approved: true, executed: true, tool: toolName, appId: rawArgs.appId };
  }

  return Object.freeze({ execute });
}

module.exports = { createToolEngine, APP_TARGETS };
