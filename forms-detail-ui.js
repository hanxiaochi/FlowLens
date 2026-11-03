const element = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

export function renderDetailField(parent, field, value, editable) {
  const backing = element('textarea');
  backing.hidden = true;
  backing.dataset.field = field.id;
  backing.value = value || '';
  backing.readOnly = !editable;
  let rows = value ? JSON.parse(value) : [];
  const host = element('div');
  host.className = 'detail-field';
  const totals = element('p');
  function refreshTotals() {
    backing.value = JSON.stringify(rows);
    totals.textContent = field.columns.filter(column => column.type === 'number' && column.sum).map(column => {
      const total = rows.reduce((sum, row) => sum + (Number(row[column.id]) || 0), 0);
      return `${column.label}合计 ${Number(total.toFixed(8))}${column.unit || ''}`;
    }).join(' · ');
  }
  function draw() {
    host.replaceChildren();
    rows.forEach((row, index) => {
      const card = element('fieldset');
      card.append(element('legend', `${field.label} · 第 ${index + 1} 行`));
      for (const column of field.columns) {
        const label = element('label', column.label + (column.required ? ' *' : ''));
        let input;
        if (['select', 'boolean'].includes(column.type)) {
          input = element('select');
          input.append(new Option('请选择', ''));
          const options = column.type === 'boolean' ? [['true', '是'], ['false', '否']] : column.options.map(option => [option, option]);
          for (const [key, text] of options) input.append(new Option(text, key));
        } else {
          input = element('input');
          input.type = column.type === 'date' ? 'date' : 'text';
          if (column.type === 'number') input.inputMode = 'decimal';
        }
        input.setAttribute('aria-label', `${field.label} 第${index + 1}行 ${column.label}`);
        input.value = row[column.id] ?? '';
        input.disabled = !editable;
        input.oninput = () => { row[column.id] = input.value; refreshTotals(); };
        label.append(input);
        card.append(label);
      }
      if (editable) {
        const remove = element('button', `移除第 ${index + 1} 行`);
        remove.type = 'button';
        remove.onclick = () => { rows.splice(index, 1); refreshTotals(); draw(); backing.dispatchEvent(new Event('input', {bubbles: true})); };
        card.append(remove);
      }
      host.append(card);
    });
    if (editable) {
      const add = element('button', '＋ 添加明细行');
      add.type = 'button';
      add.disabled = rows.length >= 100;
      add.onclick = () => { rows.push({}); refreshTotals(); draw(); backing.dispatchEvent(new Event('input', {bubbles: true})); };
      host.append(add);
    }
    if (!rows.length) host.append(element('p', '尚未填写明细'));
    host.append(totals);
  }
  // Preserve the original empty representation until the first edit.
  const saved = backing.value;
  refreshTotals();
  backing.value = saved;
  draw();
  parent.append(backing, host);
}

export function detailColumnsEditor(parent, initial = []) {
  const rows = [];
  const host = element('div');
  parent.append(element('p', '明细列支持文字、数字、日期和是否。数值列可显示合计。'), host);
  function appendColumn(column = {}) {
    const line = element('div');
    line.className = 'detail-column-editor';
    const name = element('input');
    name.placeholder = '列名称';
    name.setAttribute('aria-label', '明细列名称');
    name.value = column.label ?? '';
    const type = element('select');
    for (const [id, label] of [['text', '文字'], ['number', '数字'], ['date', '日期'], ['boolean', '是否']]) type.append(new Option(label, id));
    if (column.type === 'select') type.append(new Option('原单选选项', 'select'));
    type.value = column.type ?? 'text';
    const required = element('input'); required.type = 'checkbox'; required.checked = !!column.required;
    const sum = element('input'); sum.type = 'checkbox'; sum.checked = !!column.sum;
    const requiredLabel = element('label', '必填'); requiredLabel.prepend(required);
    const sumLabel = element('label', '合计'); sumLabel.prepend(sum);
    const entry = {column, name, type, required, sum};
    const remove = element('button', '移除此列');
    remove.onclick = () => { rows.splice(rows.indexOf(entry), 1); line.remove(); };
    line.append(name, type, requiredLabel, sumLabel, remove);
    rows.push(entry); host.append(line);
  }
  initial.forEach(appendColumn);
  const add = element('button', '＋ 添加明细列');
  add.onclick = () => { if (rows.length < 20) appendColumn(); };
  parent.append(add);
  return () => rows.map(({column, name, type, required, sum}) => ({...column, id: column.id ?? crypto.randomUUID(), label: name.value.trim(), type: type.value, required: required.checked, sum: type.value === 'number' && sum.checked}));
}
