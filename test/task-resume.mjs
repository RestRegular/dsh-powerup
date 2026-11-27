import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  DEFAULT_RESUME_PROMPT,
  TASK_RESUME_FILE,
  cleanText,
  collectRunningTasks,
  createResumeRecord,
  mergeResumeQueue,
  readResumeQueue,
  replayPendingResumes,
  stopUnfinishedTasks,
} from '../lib/task-resume.js';

// --- cleanText -------------------------------------------------------------
assert.equal(cleanText('  a\n b\t c  '), 'a b c');
assert.equal(cleanText(null), '');
assert.equal(cleanText('x'.repeat(500), 10), 'x'.repeat(10));

// --- collectRunningTasks ---------------------------------------------------
const fakeAgents = {
  list() {
    return [
      { id: 's1', status: 'running', session: { titleText: 'My task', title: () => 'legacy' } },
      { id: 's2', status: 'idle', session: { title: () => 'Idle' } },
      { id: 's3', status: 'running', session: {} },
    ];
  },
};
const fakeJobs = {
  list() {
    return [
      { id: 'j1', status: 'running', title: 'build' },
      { id: 'j2', status: 'failed', title: 'old' },
    ];
  },
};
const fakeSessionTitle = {
  get(session) {
    return session?.titleText ? { title: session.titleText } : undefined;
  },
};
const tasks = collectRunningTasks({ agents: fakeAgents, jobs: fakeJobs, sessionTitle: fakeSessionTitle });
assert.deepEqual(tasks.map((task) => task.id), ['s1', 's3', 'j1']);
assert.equal(tasks[0].title, 'My task');
assert.equal(tasks[1].title, 'session');
assert.equal(tasks[2].kind, 'job');
assert.deepEqual(collectRunningTasks({}), []);
assert.deepEqual(collectRunningTasks({ agents: { list() { throw new Error('boom'); } } }), []);

// --- createResumeRecord / queue -------------------------------------------
const record = createResumeRecord({ sessionId: 's1', title: 'My task', forcedAt: 123 }, () => 'uuid-1');
assert.equal(record.sessionId, 's1');
assert.equal(record.requestId, 'uuid-1');
assert.equal(record.prompt, DEFAULT_RESUME_PROMPT);
assert.equal(record.createdAt, 123);
assert.throws(() => createResumeRecord({}, () => 'x'), /sessionId/u);
assert.equal(createResumeRecord({ sessionId: 's1', prompt: '' }, () => 'x').prompt, DEFAULT_RESUME_PROMPT);
const merged = mergeResumeQueue([record], [
  record,
  createResumeRecord({ sessionId: 's2' }, () => 'uuid-2'),
]);
assert.deepEqual(merged.map((item) => item.sessionId), ['s1', 's2']);

// --- readResumeQueue -------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'powerup-task-'));
const file = join(dir, TASK_RESUME_FILE);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify([record]), 'utf8');
assert.deepEqual(readResumeQueue(file, readFileSync).map((item) => item.sessionId), ['s1']);
assert.deepEqual(readResumeQueue(join(dir, 'missing.json'), readFileSync), []);
writeFileSync(file, '{not json', 'utf8');
assert.deepEqual(readResumeQueue(file, readFileSync), []);

// --- stopUnfinishedTasks ---------------------------------------------------
const cancels = [];
const kills = [];
const stopServices = {
  agents: {
    list() {
      return [
        { id: 's1', status: 'running', cancel: (cause, opts) => cancels.push([cause, opts]) },
        { id: 's2', status: 'idle', cancel: () => cancels.push(['unexpected']) },
      ];
    },
  },
  jobs: {
    list() {
      return [{ id: 'j1', status: 'running', sessionId: 's1' }];
    },
    kill: (id, owner, reason) => kills.push([id, owner, reason]),
  },
};
const stopped = stopUnfinishedTasks(stopServices, 'forced close');
assert.deepEqual(stopped.cancelledAgents, ['s1']);
assert.deepEqual(stopped.killedJobs, ['j1']);
assert.equal(cancels.length, 1);
assert.deepEqual(cancels[0][0], { kind: 'user', reason: 'forced close' });
assert.equal(cancels[0][1].keepInbox, false);
assert.equal(kills[0][1], 's1');

// --- replayPendingResumes --------------------------------------------------
writeFileSync(file, JSON.stringify([
  createResumeRecord({ sessionId: 's1', prompt: '继续' }, () => 'r1'),
  createResumeRecord({ sessionId: 's2', prompt: '继续' }, () => 'r2'),
]), 'utf8');
const prompts = [];
const controller = {
  async prompt(request, signal) {
    prompts.push(request);
    if (request.sessionId === 's2') throw new Error('rejected');
    assert.ok(signal);
    return { accepted: true };
  },
};
const replay = await replayPendingResumes({
  filePath: file,
  sessionController: controller,
  readFile: readFileSync,
  writeFile: writeFileSync,
  mkdir: mkdirSync,
  dirname,
  randomUUID: () => 'new-id',
});
assert.deepEqual(replay.delivered, ['s1']);
assert.deepEqual(replay.failed.map((item) => item.sessionId), ['s2']);
assert.equal(replay.remaining, 1);
assert.equal(prompts.length, 2);
assert.equal(prompts[0].mode, 'queue');
assert.equal(prompts[0].content[0].text, '继续');
assert.equal(prompts[0].requestId, 'new-id');
assert.deepEqual(readResumeQueue(file, readFileSync).map((item) => item.sessionId), ['s2']);

// Controller missing: queue untouched, nothing delivered.
const replay2 = await replayPendingResumes({
  filePath: file,
  sessionController: null,
  readFile: readFileSync,
  writeFile: writeFileSync,
  mkdir: mkdirSync,
  dirname,
  randomUUID: () => 'new-id',
});
assert.deepEqual(replay2.delivered, []);
assert.equal(replay2.remaining, 1);

console.log('task-resume: ok');
