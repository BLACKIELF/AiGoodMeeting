import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Bun's process-wide module mocks can leave a page bound to another suite's IPC
// implementation even after mock.module is reinstalled. Run the real settings
// integration cases in separate processes, retaining every assertion and failure.
const fixture = fileURLToPath(new URL('./settings-workspace.fixture.tsx', import.meta.url));
const frontend = fileURLToPath(new URL('../..', import.meta.url));
const cases = [
  'keeps all six settings, saved model changes, visited drafts and error recovery when switching cards',
  'legacy settings preserve controlled model values and save callbacks, resetting save status only on a changed card',
];

for (const name of cases) {
  test(name, () => {
    const result = spawnSync(process.execPath, ['test', fixture, '--test-name-pattern', name], {
      cwd: frontend,
      encoding: 'utf8',
      timeout: 15000,
    });
    const output = result.stdout + result.stderr;
    if (result.error || result.status !== 0) {
      throw new Error(`Isolated settings integration failed: ${name}\n${output}`, { cause: result.error });
    }
    expect(output).toMatch(/\b1 pass\b/);
    expect(output).toMatch(/\b0 fail\b/);
  }, 20000);
}
