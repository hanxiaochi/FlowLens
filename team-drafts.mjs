export async function draftForRecord(editor, recordId) {
  if (!editor || !recordId || editor.recordId !== recordId) return null;
  await editor.saving;
  return editor.saved;
}

// Drafts belong to one editor session. Opening another tab creates another ID.
export function createDraftStore(factory = globalThis.indexedDB, name = 'flowlens-team-drafts') {
  let connection;
  async function database() {
    if (!factory) throw Error('浏览器无法保存本机草稿，请下载草稿后检查浏览器设置。');
    if (!connection) {
      const opening = new Promise((resolve, reject) => {
        let abandoned = false;
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => {
          const drafts = request.result.createObjectStore('drafts', {keyPath: ['userId', 'draftId']});
          drafts.createIndex('userId', 'userId');
        };
        request.onsuccess = () => {
          const db = request.result;
          if (abandoned) { db.close(); return; }
          db.onversionchange = () => { db.close(); if (connection === opening) connection = null; };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { abandoned = true; reject(Error('草稿存储被旧页面占用，请关闭旧页面后重试。')); };
      });
      connection = opening;
      opening.catch(() => { if (connection === opening) connection = null; });
    }
    return connection;
  }

  async function transaction(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode);
      let result, failure;
      const fail = error => { failure = error; tx.abort(); };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? tx.error ?? Error('草稿保存事务已取消'));
      try { operation(tx.objectStore('drafts'), value => { result = value; }, fail); }
      catch (error) { fail(error); }
    });
  }

  return {
    async save(input) {
      const draft = structuredClone(input);
      for (const key of ['userId', 'draftId', 'instanceId', 'recordId']) {
        if (typeof draft[key] !== 'string' || !draft[key]) throw Error('草稿缺少账号、环境或单据标识。');
      }
      if (!Number.isSafeInteger(draft.version) || draft.version < 1 || !Number.isSafeInteger(draft.recordRevision) || draft.recordRevision < 0) throw Error('草稿版本无效。');
      if (!draft.values || typeof draft.values !== 'object' || Array.isArray(draft.values) || Object.values(draft.values).some(value => typeof value !== 'string') || typeof draft.note !== 'string') throw Error('草稿填写内容无效。');
      try {
        return await transaction('readwrite', (store, done, fail) => {
          const read = store.get([draft.userId, draft.draftId]);
          read.onsuccess = () => {
            const previous = read.result;
            if (previous && (previous.instanceId !== draft.instanceId || previous.recordId !== draft.recordId || previous.recordRevision !== draft.recordRevision)) {
              fail(Error('草稿对应的单据或环境发生变化，请保留原草稿后重新打开单据。')); return;
            }
            if (previous && previous.version >= draft.version) {
              fail(Error('已有更新的本机草稿，请重新读取并核对。')); return;
            }
            const saved = {...draft, createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString()};
            try { store.put(saved); done(saved); }
            catch (error) { fail(error); }
          };
        });
      } catch (error) {
        if (error.name === 'QuotaExceededError') throw Object.assign(Error('本机草稿空间不足，请立即下载当前草稿。'), {name: error.name});
        throw error;
      }
    },
    list(userId) {
      return transaction('readonly', (store, done) => {
        const read = store.index('userId').getAll(userId);
        read.onsuccess = () => done(read.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      });
    },
    // A completed submission can only clean up the exact draft it included.
    remove(userId, draftId, version) {
      return transaction('readwrite', (store, done, fail) => {
        const read = store.get([userId, draftId]);
        read.onsuccess = () => {
          if (!read.result) { done(true); return; }
          if (read.result.version !== version) { done(false); return; }
          try { store.delete([userId, draftId]); done(true); }
          catch (error) { fail(error); }
        };
      });
    },
    async close() { if (connection) { (await connection).close(); connection = null; } }
  };
}
