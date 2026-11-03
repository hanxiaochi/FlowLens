import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {createDraftStore} from './team-drafts.mjs';

const draft = (overrides = {}) => ({userId: 'user-a', draftId: crypto.randomUUID(), instanceId: 'instance-a', recordId: 'record-a', recordRevision: 3, version: 1, values: {issue: 'Original', items: '[{}]'}, note: 'Review note', ...overrides});

test('drafts survive reopening, retain editing baseline, and isolate accounts and tabs', async () => {
  const factory = new IDBFactory();
  let first = createDraftStore(factory);
  const second = createDraftStore(factory);
  try {
    const input = draft();
    const operation = first.save(input);
    input.values.issue = 'Changed after save started';
    const saved = await operation;
    assert.equal(saved.values.issue, 'Original');
    assert.equal(saved.recordRevision, 3);
    await second.save(draft());
    await second.save(draft({userId: 'user-b'}));
    await first.close(); first = createDraftStore(factory);
    assert.equal((await first.list('user-a')).length, 2);
    assert.equal((await first.list('user-b')).length, 1);
    assert.deepEqual(await first.list('user-c'), []);
    await first.remove('user-b', saved.draftId, saved.version);
    assert.equal((await first.list('user-a')).length, 2);
  } finally { await first.close(); await second.close(); }
});

test('older writes and cleanup cannot overwrite or remove a newer draft', async () => {
  const factory = new IDBFactory();
  const first = createDraftStore(factory), second = createDraftStore(factory);
  try {
    const input = draft();
    await first.save(input);
    await second.save({...input, version: 3, values: {issue: 'Newest'}});
    await assert.rejects(first.save({...input, version: 2}), /更新/);
    assert.equal(await first.remove(input.userId, input.draftId, 1), false);
    assert.equal((await second.list(input.userId))[0].values.issue, 'Newest');
    for (const changed of [{instanceId: 'restored'}, {recordId: 'another'}, {recordRevision: 4}]) {
      await assert.rejects(first.save({...input, version: 4, ...changed}), /环境/);
    }
    const competing = await Promise.allSettled([first.save({...input, version: 4}), second.save({...input, version: 4})]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await second.remove(input.userId, input.draftId, 4), true);
    assert.equal(await second.remove(input.userId, input.draftId, 4), true);
  } finally { await first.close(); await second.close(); }
});

test('quota failure and transaction abort preserve the last committed draft', async () => {
  const store = createDraftStore(new IDBFactory());
  const put = IDBObjectStore.prototype.put;
  try {
    const input = draft(), saved = await store.save(input);
    IDBObjectStore.prototype.put = function () { throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); };
    await assert.rejects(store.save({...input, version: 2}), error => error.name === 'QuotaExceededError');
    assert.deepEqual(await store.list(input.userId), [saved]);
    IDBObjectStore.prototype.put = function (value) {
      const request = put.call(this, value);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
    await assert.rejects(store.save({...input, version: 3}));
    assert.deepEqual(await store.list(input.userId), [saved]);
  } finally { IDBObjectStore.prototype.put = put; await store.close(); }
});

test('a failed draft-store opening can retry and malformed drafts cannot replace valid data', async () => {
  const factory = new IDBFactory();
  let blocked = true;
  const store = createDraftStore({open(...args) {
    if (blocked) throw new DOMException('Synthetic blocked storage', 'SecurityError');
    return factory.open(...args);
  }});
  try {
    await assert.rejects(store.list('user-a'));
    blocked = false;
    const input = draft(), saved = await store.save(input);
    for (const changed of [{userId: ''}, {version: NaN}, {recordRevision: 0}, {values: []}, {values: {x: 1}}, {note: null}]) {
      await assert.rejects(store.save({...input, version: 2, ...changed}));
    }
    assert.deepEqual(await store.list('user-a'), [saved]);
  } finally { await store.close(); }
});

test('failed draft deletion preserves the exact version for retry', async () => {
  const store = createDraftStore(new IDBFactory());
  const remove = IDBObjectStore.prototype.delete;
  try {
    const saved = await store.save(draft());
    IDBObjectStore.prototype.delete = function (key) {
      const request = remove.call(this, key);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
    await assert.rejects(store.remove(saved.userId, saved.draftId, saved.version));
    assert.deepEqual(await store.list(saved.userId), [saved]);
    IDBObjectStore.prototype.delete = remove;
    assert.equal(await store.remove(saved.userId, saved.draftId, saved.version), true);
  } finally { IDBObjectStore.prototype.delete = remove; await store.close(); }
});
