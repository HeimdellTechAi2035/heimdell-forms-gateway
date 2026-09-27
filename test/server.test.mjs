import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 3199;
const child = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
  child.stdout.on('data', (chunk) => {
    if (chunk.toString().includes('forms_gateway_started')) {
      clearTimeout(timer);
      resolve();
    }
  });
  child.once('exit', (code) => reject(new Error(`server exited early: ${code}`)));
});

test.after(() => child.kill('SIGTERM'));

test('health endpoint is status-only', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('unknown routes are rejected', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/missing`);
  assert.equal(response.status, 404);
});

test('form posts from unapproved origins are rejected before delivery', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/greenfix/quote-request`, {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'form-name': 'quote-request',
      full_name: 'Test User',
    }),
    redirect: 'manual',
  });
  assert.equal(response.status, 403);
});
