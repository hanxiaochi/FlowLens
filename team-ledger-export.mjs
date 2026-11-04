import {zipSync} from './team-vendor/fflate.mjs';

const limit = (message) => { throw Object.assign(Error(message), {status: 413}); };
export const ledgerLimits = {bytes: 64 * 1024 * 1024, cells: 500000, sheets: 200, rows: 100000};
const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]));
// OOXML escapes preserve control characters and literal escape-looking text.
function cellText(value) {
  let text = String(value ?? '');
  if (text.length > 32767) limit('单元格超过 Excel 32767 字符上限，请使用项目资料包交接');
  if (!text.isWellFormed()) throw Error('内容含无效 Unicode 字符，请修正后导出台账');
  text = text.replace(/_x[0-9a-f]{4}_/gi, match => '_x005F_' + match.slice(1));
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, char => '_x' + char.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase() + '_');
  return xml(text).replace(/\r/g, '&#13;');
}
function columnName(index) {
  let result = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

export function buildProjectLedger(workspace, projectId) {
  const project = workspace.projects.find(item => item.id === projectId);
  if (!project) throw Error('项目不存在');
  const records = workspace.cases.filter(record => record.projectId === projectId);
  const ids = new Set(records.map(record => record.id));
  const groups = new Map();
  for (const record of records) {
    if (record.relatedId && !ids.has(record.relatedId)) throw Error('单据关联超出当前项目，无法导出台账');
    const template = record.template;
    const key = JSON.stringify([template.id, template.version, template.title, template.fields]);
    if (!groups.has(key)) groups.set(key, {template, records: []});
    groups.get(key).records.push(record);
  }
  const files = Object.create(null), sheets = [];
  let byteCount = 0, cellCount = 0;
  function add(path, content) {
    const bytes = Buffer.from(content);
    byteCount += bytes.length;
    if (byteCount > ledgerLimits.bytes) limit('台账超过 64 MiB 导出上限，请使用项目资料包或数据库备份交接');
    files[path] = bytes;
  }
  function sheet(name, rows, guideSheet = false) {
    if (sheets.length >= ledgerLimits.sheets) limit('台账超过 200 张工作表，请按项目分开交接');
    const number = sheets.length + 1;
    const chunks = [];
    let rowNumber = 0, width = 0, sheetBytes = 0;
    for (const row of rows) {
      rowNumber++;
      if (rowNumber > ledgerLimits.rows || row.length > 16384) limit('台账行列超过导出上限');
      cellCount += row.length;
      if (cellCount > ledgerLimits.cells) limit('台账超过 50 万单元格，请使用项目资料包交接');
      width = Math.max(width, row.length);
      const lines = Math.max(1, ...row.map((value, index) => String(value ?? '').split(/\r\n|\r|\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].reduce((n, char) => n + (char.codePointAt(0) > 255 ? 2 : 1), 0) / (guideSheet && index === 1 ? 90 : 25))), 0)));
      const height = Math.min(409, Math.max(30, lines * 15 + 8));
      const content = '<row r="' + rowNumber + '" ht="' + height + '" customHeight="1">' + row.map((value, column) => '<c r="' + columnName(column) + rowNumber + '" s="' + (rowNumber === 1 ? 1 : rowNumber % 2 ? 3 : 2) + '" t="inlineStr"><is><t xml:space="preserve">' + cellText(value) + '</t></is></c>').join('') + '</row>';
      sheetBytes += Buffer.byteLength(content);
      if (byteCount + sheetBytes > ledgerLimits.bytes) limit('台账超过 64 MiB 导出上限，请使用项目资料包交接');
      chunks.push(content);
    }
    const end = columnName(Math.max(0, width - 1)) + Math.max(1, rowNumber);
    let safeName = name.replace(/[\x00-\x1f\ufffe\uffff\[\]:*?/\\]/g, '-').slice(0, 31).replace(/'+$/, '');
    if (!safeName.isWellFormed()) safeName = safeName.slice(0, -1);
    sheets.push({name: safeName, number});
    add('xl/worksheets/sheet' + number + '.xml', declaration + '<worksheet xmlns="' + namespace + '"><dimension ref="A1:' + end + '"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>' + (guideSheet ? '<col min="1" max="1" width="25" customWidth="1"/><col min="2" max="2" width="95" customWidth="1"/>' : '<col min="1" max="' + Math.max(1, width) + '" width="28" customWidth="1"/>') + '</cols><sheetData>' + chunks.join('') + '</sheetData><autoFilter ref="A1:' + end + '"/></worksheet>');
  }
  const guide = [['项目台账', '内容'], ['项目', project.name], ['项目编号', project.id], ['导出时间 UTC', new Date().toISOString()], ['工作区修订', workspace.storageRevision ?? ''], ['单据数量', records.length], ['范围', '当前项目全部已保存单据，含草稿和已归档业务；不含本机未保存内容、账号凭据及附件二进制。'], ['使用说明', '所有单元格按文本保存，长编号和前导零不转换成数字；填写内容不作为公式执行。计算统计前请自行确认并转换需要计算的列。'], ['历史表式', '按单据保存的表式编号、版本和字段结构分组；同一版本有不同字段结构时分别列出。'], ['重复明细', '主表显示明细行数，明细表带所属单据编号、字段编号和行序号。'], ['用途', '本文件用于核对和交接，不能导回恢复系统。完整资料和附件请另行下载项目资料包。']];
  const grouped = [...groups.values()];
  for (const [index, group] of grouped.entries()) guide.push(['T' + String(index + 1).padStart(3, '0'), group.template.title + ' · 版本 ' + group.template.version + ' · ' + group.records.length + ' 份']);
  guide.push(['长文本', '超长内容可能超过 Excel 行高显示范围，请在单元格编辑栏查看完整原值。']);
  sheet('使用说明', guide, true);
  for (const [index, group] of grouped.entries()) {
    const {template, records: members} = group;
    const prefix = String(index + 1).padStart(3, '0');
    const fields = template.fields;
    const details = fields.filter(field => field.type === 'table');
    const parsed = new Map();
    for (const record of members) for (const field of details) {
      const value = Object.hasOwn(record.values, field.id) ? record.values[field.id] : '';
      const rows = value?.trim() ? JSON.parse(value) : [];
      if (!Array.isArray(rows)) throw Error('明细格式无效，无法导出台账');
      parsed.set(record.id + ':' + field.id, rows);
    }
    const metadata = record => [record.id, record.title, record.template.id, record.template.version, record.revision, record.status === 'complete' ? '已归档' : record.status === 'draft' ? '草稿' : '办理中', record.status === 'draft' ? '待填写' : record.status === 'complete' ? '已归档' : record.template.workflow[record.step]?.label ?? '', record.relatedId ?? '', record.createdAt ?? '', record.createdBy?.name ?? ''];
    sheet('T' + prefix + ' ' + template.title, (function* () {
      yield ['单据编号', '状态', '办理阶段', ...fields.map(field => field.label + ' [' + field.id + ']'), '单据名称', '表式编号', '表式版本', '单据修订', '上游单据编号', '创建时间 UTC', '创建人'];
      for (const record of members) {
        const meta = metadata(record);
        yield [meta[0], meta[5], meta[6], ...fields.map(field => field.type === 'table' ? parsed.get(record.id + ':' + field.id).length + ' 行，见明细表' : Object.hasOwn(record.values, field.id) ? record.values[field.id] : ''), ...meta.slice(1, 5), ...meta.slice(7)];
      }
    })());
    for (const [detailIndex, field] of details.entries()) sheet('D' + prefix + '_' + (detailIndex + 1) + ' ' + field.label, (function* () {
      yield ['所属单据编号', '明细字段编号', '行序号', ...field.columns.map(column => column.label + ' [' + column.id + ']')];
      for (const record of members) for (const [rowIndex, row] of parsed.get(record.id + ':' + field.id).entries()) yield [record.id, field.id, rowIndex + 1, ...field.columns.map(column => Object.hasOwn(row, column.id) ? row[column.id] : '')];
    })());
  }
  const relations = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const officeRelations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  add('_rels/.rels', declaration + '<Relationships xmlns="' + relations + '"><Relationship Id="rId1" Type="' + officeRelations + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add('xl/workbook.xml', declaration + '<workbook xmlns="' + namespace + '" xmlns:r="' + officeRelations + '"><sheets>' + sheets.map(({name, number}) => '<sheet name="' + xml(name) + '" sheetId="' + number + '" r:id="rId' + number + '"/>').join('') + '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', declaration + '<Relationships xmlns="' + relations + '">' + sheets.map(({number}) => '<Relationship Id="rId' + number + '" Type="' + officeRelations + '/worksheet" Target="worksheets/sheet' + number + '.xml"/>').join('') + '<Relationship Id="styles" Type="' + officeRelations + '/styles" Target="styles.xml"/></Relationships>');
  add('xl/styles.xml', declaration + '<styleSheet xmlns="' + namespace + '"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF514268"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F0F6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="49" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  add('[Content_Types].xml', declaration + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map(({number}) => '<Override PartName="/xl/worksheets/sheet' + number + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
  return zipSync(files, {level: 0});
}
