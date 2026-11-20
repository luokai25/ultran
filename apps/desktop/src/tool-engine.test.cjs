const test = require('node:test');
const assert = require('node:assert/strict');
const { createToolEngine } = require('./tool-engine.cjs');

function engine({ approved = false, platform = 'win32' } = {}) {
  const prompts = [], launches = [];
  const instance = createToolEngine({
    platform,
    confirm: async request => { prompts.push(request); return approved; },
    launch: async executable => { launches.push(executable); return { pid: 4321, spawned: true }; },
  });
  return { instance, prompts, launches };
}

test('unknown tools fail closed without prompting or execution', async () => {
  const e = engine({ approved: true });
  await assert.rejects(e.instance.execute('shell.exec', { command: 'whoami' }), /not registered/);
  assert.equal(e.prompts.length, 0);
  assert.equal(e.launches.length, 0);
});

test('rejects extra arguments and unknown application identifiers', async () => {
  const e = engine({ approved: true });
  await assert.rejects(e.instance.execute('windows.launch_app', { appId: 'notepad', command: 'calc' }), /Invalid tool arguments/);
  await assert.rejects(e.instance.execute('windows.launch_app', { appId: 'powershell' }), /approved launcher list/);
  assert.equal(e.prompts.length, 0);
  assert.equal(e.launches.length, 0);
});

test('denial never launches the application', async () => {
  const e = engine();
  const result = await e.instance.execute('windows.launch_app', { appId: 'calculator' });
  assert.deepEqual(result, { approved: false, executed: false, reason: 'denied' });
  assert.equal(e.prompts.length, 1);
  assert.equal(e.launches.length, 0);
});

test('approval launches only the fixed executable with no user-controlled command', async () => {
  const e = engine({ approved: true });
  const result = await e.instance.execute('windows.launch_app', { appId: 'notepad' });
  assert.equal(result.executed, true);
  assert.equal(result.verified, true);
  assert.equal(result.pid, 4321);
  assert.deepEqual(e.launches, ['notepad.exe']);
  assert.equal(e.prompts[0].tool, 'windows.launch_app');
});

test('tool is unavailable on non-Windows platforms', async () => {
  const e = engine({ approved: true, platform: 'linux' });
  await assert.rejects(e.instance.execute('windows.launch_app', { appId: 'notepad' }), /Windows only/);
  assert.equal(e.prompts.length, 0);
  assert.equal(e.launches.length, 0);
});
