import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {createRecoveryStore} from './team-recovery.mjs';

const request = (overrides = {}) => ({type: 'save', recordId: 'record-a', operationId: crypto.randomUUID(), expectedUserId: 'user-a', expectedInstanceId: 'instance-a', values: {issue: 'Original'}, ...overrides});

test('recovery keeps original requests across reopening and isolates accounts', async () => {
  const factory = new IDBFactory();
  let store = createRecoveryStore(factory);
  try {
    const input = request();
    const entry = await store.stage('user-a', 'instance-a', input, 'Fictional record');
    input.values.issue = 'Later edit';
    assert.equal(entry.request.values.issue, 'Original');
    await store.close(); store = createRecoveryStore(factory);
    assert.deepEqual(await store.list('user-a'), [entry]);
    assert.deepEqual(await store.list('user-b'), []);
    await store.remove('user-b', entry.operationId);
    assert.equal((await store.list('user-a')).length, 1);
    await store.remove('user-a', entry.operationId);
    await store.remove('user-a', entry.operationId);
    assert.deepEqual(await store.list('user-a'), []);
  } finally { await store.close(); }
});

test('concurrent tabs cannot overwrite an unresolved operation on the same business', async () => {
  const factory = new IDBFactory();
  const first = createRecoveryStore(factory), second = createRecoveryStore(factory);
  try {
    const results = await Promise.allSettled([first.stage('user-a', 'instance-a', request()), second.stage('user-a', 'instance-a', request())]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.match(results.find(item => item.status === 'rejected').reason.message, /已有相同业务/);
    assert.equal((await second.list('user-a')).length, 1);
    await second.stage('user-a', 'instance-a', request({recordId: 'record-b'}));
    await first.stage('user-b', 'instance-a', request({expectedUserId: 'user-b'}));
    assert.equal((await first.list('user-a')).length, 2);
    assert.equal((await first.list('user-b')).length, 1);
  } finally { await first.close(); await second.close(); }
});

test('storage failure leaves the request and existing recovery records intact', async () => {
  const store = createRecoveryStore(new IDBFactory());
  const add = IDBObjectStore.prototype.add;
  try {
    const initial = await store.stage('user-a', 'instance-a', request());
    const input = request({recordId: 'record-b'}), before = structuredClone(input);
    IDBObjectStore.prototype.add = function () { throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); };
    await assert.rejects(store.stage('user-a', 'instance-a', input), error => error.name === 'QuotaExceededError');
    assert.deepEqual(input, before);
    assert.deepEqual(await store.list('user-a'), [initial]);
    await assert.rejects(store.stage('user-b', 'instance-a', input), /当前账号/);
  } finally { IDBObjectStore.prototype.add = add; await store.close(); }
});

test('a successful add followed by transaction abort is never acknowledged as staged', async () => {
  const store = createRecoveryStore(new IDBFactory());
  const add = IDBObjectStore.prototype.add;
  try {
    IDBObjectStore.prototype.add = function (value) {
      const operation = add.call(this, value);
      operation.addEventListener('success', () => this.transaction.abort());
      return operation;
    };
    await assert.rejects(store.stage('user-a', 'instance-a', request()));
    assert.deepEqual(await store.list('user-a'), []);
  } finally { IDBObjectStore.prototype.add = add; await store.close(); }
});

test('a failed database open can be retried without reloading the page', async () => {
  const factory = new IDBFactory();
  let unavailable = true;
  const store = createRecoveryStore({open(...args) {
    if (unavailable) throw new DOMException('Synthetic blocked storage', 'SecurityError');
    return factory.open(...args);
  }});
  try {
    await assert.rejects(store.list('user-a'), error => error.name === 'SecurityError');
    unavailable = false;
    await store.stage('user-a', 'instance-a', request());
    assert.equal((await store.list('user-a')).length, 1);
  } finally { await store.close(); }
});

test('failed cleanup retains a large attachment request for another confirmation attempt', async () => {
  const store = createRecoveryStore(new IDBFactory());
  const remove = IDBObjectStore.prototype.delete;
  try {
    const input = request({type: 'attachment', attachment: {name: 'fictional.bin', data: 'data:application/octet-stream;base64,' + Buffer.alloc(8 * 1024 * 1024, 1).toString('base64')}});
    const entry = await store.stage('user-a', 'instance-a', input);
    IDBObjectStore.prototype.delete = function (key) {
      const operation = remove.call(this, key);
      operation.addEventListener('success', () => this.transaction.abort());
      return operation;
    };
    await assert.rejects(store.remove('user-a', entry.operationId));
    assert.equal((await store.list('user-a'))[0].request.attachment.data, input.attachment.data);
    IDBObjectStore.prototype.delete = remove;
    await store.remove('user-a', entry.operationId);
    assert.deepEqual(await store.list('user-a'), []);
  } finally { IDBObjectStore.prototype.delete = remove; await store.close(); }
});
