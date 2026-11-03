export function createRecoveryStore(factory = globalThis.indexedDB, name = 'flowlens-team-recovery') {
  let connection;
  async function database() {
    if (!factory) throw Error('浏览器无法使用恢复存储，请先下载草稿并检查浏览器设置。');
    if (!connection) {
      const opening = new Promise((resolve, reject) => {
        let abandoned = false;
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => {
          const records = request.result.createObjectStore('requests', {keyPath: ['userId', 'operationId']});
          records.createIndex('userId', 'userId');
          records.createIndex('scope', 'scope', {unique: true});
        };
        request.onsuccess = () => {
          const db = request.result;
          if (abandoned) { db.close(); return; }
          db.onversionchange = () => { db.close(); if (connection === opening) connection = null; };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { abandoned = true; reject(Error('恢复存储被其他页面占用，请关闭旧页面后重试。')); };
      });
      connection = opening;
      opening.catch(() => { if (connection === opening) connection = null; });
    }
    return connection;
  }
  async function transact(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('requests', mode);
      const request = operation(transaction.objectStore('requests'));
      let failure;
      request.onerror = () => { failure = request.error; };
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(failure ?? transaction.error ?? Error('恢复存储事务已取消'));
    });
  }
  return {
    async stage(userId, instanceId, request, description = '') {
      if (!userId || !instanceId || request.expectedUserId !== userId || request.expectedInstanceId !== instanceId || typeof request.operationId !== 'string') throw Error('恢复请求缺少当前账号或服务环境。');
      const target = request.type === 'create'
        ? ['create', request.projectId, request.templateId, request.sourceId ?? '', request.relationId ?? '']
        : ['record', request.recordId];
      if (target.some(value => typeof value !== 'string')) throw Error('恢复请求缺少业务编号。');
      const entry = {userId, instanceId, operationId: request.operationId, scope: [userId, instanceId, ...target], request: structuredClone(request), description, createdAt: new Date().toISOString()};
      try { await transact('readwrite', records => records.add(entry)); }
      catch (error) {
        if (error.name === 'ConstraintError') throw Error('本机已有相同业务的待确认操作，请先从恢复入口处理。');
        if (error.name === 'QuotaExceededError') throw Object.assign(Error('本机恢复存储空间不足，请先下载草稿并检查浏览器存储。'), {name: error.name});
        throw error;
      }
      return entry;
    },
    async list(userId) {
      const entries = await transact('readonly', records => records.index('userId').getAll(userId));
      return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    remove: (userId, operationId) => transact('readwrite', records => records.delete([userId, operationId])),
    async close() { if (connection) { (await connection).close(); connection = null; } }
  };
}
