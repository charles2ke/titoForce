// Development runner: starts the API server (restarts on change) and the Vite dev server together.
// Usage: npm run dev  →  UI on http://localhost:5173 (proxied to the API on TITO_PORT, default 3000).
import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

const root = resolve(import.meta.dirname, '..');

const tasks = [
  {
    name: 'api',
    color: 36,
    cwd: resolve(root, 'apps/server'),
    args: ['--watch-path=src', '--watch-path=../../packages/shared/src', 'src/index.ts'],
  },
  {
    name: 'web',
    color: 35,
    cwd: resolve(root, 'apps/web'),
    args: [resolve(root, 'node_modules/vite/bin/vite.js')],
  },
];

const children: ChildProcess[] = [];
let stopping = false;

function forward(name: string, color: number, from: Readable, to: Writable): void {
  const prefix = process.stdout.isTTY ? `\x1b[${color}m[${name}]\x1b[0m ` : `[${name}] `;
  createInterface({ input: from }).on('line', (line) => to.write(`${prefix}${line}\n`));
}

function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
}

for (const task of tasks) {
  const child = spawn(process.execPath, task.args, { cwd: task.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  forward(task.name, task.color, child.stdout, process.stdout);
  forward(task.name, task.color, child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[${task.name}] exited (${signal ?? code}); stopping the other process.`);
      stop(code || 1);
    }
  });
  children.push(child);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
