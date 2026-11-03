import {createHash, randomUUID} from 'node:crypto';
import {chmodSync} from 'node:fs';
import {basename} from 'node:path';
import {upgradeWorkspace} from './forms-store.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function decodeAttachment(data) {
  if (typeof data !== 'string' || data.length > 14 * 1024 * 1024 || !/^data:[\w.+/-]*;base64,[A-Za-z0-9+/=]*$/.test(data)) throw Error('附件格式无效');
  const comma = data.indexOf(',');
  return {bytes: Buffer.from(data.slice(comma + 1), 'base64'), mediaType: data.slice(5, comma - 7)};
}

export function storeRecordAttachments(db, record) {
  const ids = new Set();
  for (let index = 0; index < record.attachments.length; index++) {
    const file = record.attachments[index];
    if (file.data !== undefined) {
      const {bytes, mediaType} = decodeAttachment(file.data);
      const blobId = hash(bytes);
      db.prepare('INSERT OR IGNORE INTO attachment_blobs(id,size,data) VALUES(?,?,?)').run(blobId, bytes.length, bytes);
      file.blobId = blobId; file.mediaType = mediaType; file.size = bytes.length;
      delete file.data;
    }
    if (typeof file.id !== 'string' || !file.id || ids.has(file.id)) file.id = 'file-' + hash(record.id + '/' + index + '/' + file.blobId).slice(0, 32);
    ids.add(file.id);
    const blob = db.prepare('SELECT size FROM attachment_blobs WHERE id=?').get(file.blobId);
    if (!blob || blob.size !== file.size) throw Error('附件内容缺失或大小不一致');
  }
}

export function hydrateRecordAttachments(db, record) {
  for (const file of record.attachments) {
    const row = db.prepare('SELECT data FROM attachment_blobs WHERE id=?').get(file.blobId);
    if (!row) throw Error('附件内容缺失');
    if (row.data.length !== file.size || hash(row.data) !== file.blobId) throw Object.assign(Error('附件内容校验失败'), {status: 500});
    file.data = 'data:' + file.mediaType + ';base64,' + Buffer.from(row.data).toString('base64');
    delete file.blobId; delete file.mediaType;
  }
  return record;
}

export function validateAttachmentSnapshot(db, value, {verifyHashes = false} = {}) {
  function validateRecord(record) {
    for (const file of record.attachments) {
      const row = db.prepare('SELECT size FROM attachment_blobs WHERE id=?').get(file.blobId);
      if (!row || row.size !== file.size) throw Error('备份中的附件引用无效');
    }
  }
  for (const record of value.cases) validateRecord(record);
  for (const row of db.prepare('SELECT result FROM requests').iterate()) {
    const result = JSON.parse(row.result);
    if (Array.isArray(result.record?.attachments)) validateRecord(result.record);
  }
  if (verifyHashes) {
    for (const row of db.prepare('SELECT id,size,data FROM attachment_blobs').iterate()) {
      if (row.data.length !== row.size || hash(row.data) !== row.id) throw Error('备份中的附件校验失败');
    }
  }
}

export function migrateAttachments(db, filename) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 2) return;
  if (![0, 1].includes(version)) throw Error('不支持的数据库版本');
  let backupFile;
  if (version === 1) {
    backupFile = filename + '.before-attachments-' + randomUUID() + '.sqlite';
    db.prepare('VACUUM INTO ?').run(backupFile);
    chmodSync(backupFile, 0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    // Another startup can have finished migration while the backup was being made.
    if (db.prepare('PRAGMA user_version').get().user_version === 2) { db.exec('COMMIT'); return; }
    db.exec('CREATE TABLE attachment_blobs (id TEXT PRIMARY KEY, size INTEGER NOT NULL, data BLOB NOT NULL)');
    const row = db.prepare('SELECT data FROM workspace WHERE id=1').get();
    const current = upgradeWorkspace(JSON.parse(row.data));
    for (const record of current.cases) storeRecordAttachments(db, record);
    db.prepare('UPDATE workspace SET data=? WHERE id=1').run(JSON.stringify(current));
    // Compact each historical retry result without loading the entire request table.
    for (const request of db.prepare('SELECT id,result FROM requests ORDER BY id').iterate()) {
      const result = JSON.parse(request.result);
      if (Array.isArray(result.record?.attachments)) {
        storeRecordAttachments(db, result.record);
        db.prepare('UPDATE requests SET result=? WHERE id=?').run(JSON.stringify(result), request.id);
      }
    }
    validateAttachmentSnapshot(db, current, {verifyHashes: true});
    db.exec('PRAGMA user_version=2');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  if (backupFile) {
    let compacted = false;
    try { db.exec('VACUUM'); compacted = true; } catch {}
    const record = {completedAt: new Date().toISOString(), sourceVersion: 1, targetVersion: 2, backupFile: basename(backupFile), compacted};
    db.prepare('INSERT INTO maintenance(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run('lastAttachmentMigration', JSON.stringify(record));
  }
  return backupFile;
}
