function importFor(ctx) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try { parseImportText(ctx, ev.target.result, file.name); }
            catch (err) { showMessage('Error parsing file: ' + err.message, 'error'); }
        };
        reader.readAsText(file);
    };
    input.click();
}

function parseImportText(ctx, text, filename) {
    const trimmed = text.trim();
    const isJson = filename ? filename.toLowerCase().endsWith('.json') : (trimmed.startsWith('{') || trimmed.startsWith('['));
    if (isJson) {
        parseImportJSON(ctx, trimmed);
    } else {
        const { header, rows } = parseCSVRows(trimmed);
        parseCSVFor(ctx, header, rows);
    }
}

// ── JSON import ───────────────────────────────────────────────────────────────
// Accepts full ledger export OR arrays of the relevant entity type.
// Only imports data matching the current ctx tab — discards the rest.
function parseImportJSON(ctx, text) {
    let data;
    try { data = JSON.parse(text); }
    catch(e) { return showMessage('Invalid JSON: ' + e.message, 'error'); }

    // If it looks like a full ledger export, extract just the relevant array/object
    let extracted;
    if (ctx === 'transactions') {
        extracted = Array.isArray(data) ? data : (data.transactions || null);
        if (!extracted) return showMessage('JSON has no transactions array', 'error');
        parseTransactionsJSON(extracted);
    } else if (ctx === 'paychecks') {
        extracted = Array.isArray(data) ? data : (data.paychecks || null);
        if (!extracted) return showMessage('JSON has no paychecks array', 'error');
        parsePaychecksJSON(extracted);
    } else if (ctx === 'envelopes') {
        extracted = Array.isArray(data) ? null : (data.envelopes || (typeof data === 'object' && !Array.isArray(data) ? data : null));
        if (!extracted) return showMessage('JSON has no envelopes object', 'error');
        parseEnvelopesJSON(extracted);
    } else if (ctx === 'statements') {
        extracted = Array.isArray(data) ? data : (data.statements || null);
        if (!extracted) return showMessage('JSON has no statements array', 'error');
        parseStatementsJSON(extracted);
    }
}

function parseTransactionsJSON(items) {
    const newTransactions = [], newAccounts = new Set(), newEnvelopes = new Set();
    items.forEach((item, i) => {
        if (!item.date || item.amount === undefined) return;
        // Resolve account: prefer accountId, fall back to account name field
        let accName = item.account || '';
        if (item.accountId) {
            const acc = ledgerData.accounts.find(a => a.id === item.accountId);
            if (acc) accName = acc.name; else if (!accName) accName = 'Unknown';
        }
        if (accName && !ledgerData.accounts.find(a => a.name === accName)) newAccounts.add(accName);
        const envelope = item.envelope || '';
        if (envelope && !ledgerData.envelopes[envelope]) newEnvelopes.add(envelope);
        const month = item.month || (new Date(item.date + 'T00:00:00').getMonth() + 1);
        newTransactions.push({ date: item.date, month, account: accName, amount: parseFloat(item.amount), description: item.description || '', envelope });
    });
    const newItems = [];
    if (newAccounts.size) newItems.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Accounts:</div><ul>${[...newAccounts].map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`);
    if (newEnvelopes.size) newItems.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Envelopes:</div><ul>${[...newEnvelopes].map(e=>`<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`);
    const body = (newItems.length ? '<p>The JSON contains the following new items:</p>' + newItems.join('') : '') + `<p>Import <strong>${newTransactions.length}</strong> transaction(s)?</p>`;
    showImportConfirm('Import Transactions (JSON)', body, () => {
        [...newAccounts].forEach(name => ledgerData.accounts.push({ id: Date.now().toString() + Math.random(), name, initialBalance: 0 }));
        [...newEnvelopes].forEach(name => { if (!ledgerData.envelopes[name]) ledgerData.envelopes[name] = { color: '#2D5F3F', funding: {} }; });
        newTransactions.forEach(t => {
            const acc = ledgerData.accounts.find(a => a.name === t.account);
            if (acc) ledgerData.transactions.push({ id: Date.now().toString() + Math.random(), date: t.date, month: t.month, accountId: acc.id, amount: t.amount, description: t.description, envelope: t.envelope });
        });
        markUnsaved(); updateUI();
        showMessage(`Imported ${newTransactions.length} transaction(s)`);
    });
}

function parsePaychecksJSON(items) {
    const newEntries = [], newAccounts = new Set(), newEnvelopes = new Set(), errors = [];
    items.forEach((item, i) => {
        if (item.amount === undefined || !item.month) { errors.push(`Item ${i+1}: missing amount or month`); return; }
        let accName = item.account || '';
        if (item.accountId) { const acc = ledgerData.accounts.find(a => a.id === item.accountId); if (acc) accName = acc.name; }
        if (accName && !ledgerData.accounts.find(a => a.name === accName)) newAccounts.add(accName);
        const envelope = item.envelope || '';
        const amount = parseFloat(item.amount);
        if (amount < 0 && !envelope) { errors.push(`Item ${i+1}: deduction requires envelope`); return; }
        if (envelope && !ledgerData.envelopes[envelope]) newEnvelopes.add(envelope);
        newEntries.push({ month: item.month, date: item.date || null, account: accName, amount, gross: item.gross ? parseFloat(item.gross) : null, tithingType: item.tithingType || 'tithing', envelope });
    });
    if (errors.length) return showMessage('JSON errors:\n' + errors.join('\n'), 'error');
    const newItems = [];
    if (newAccounts.size) newItems.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Accounts:</div><ul>${[...newAccounts].map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`);
    if (newEnvelopes.size) newItems.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Envelopes:</div><ul>${[...newEnvelopes].map(e=>`<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`);
    const body = (newItems.length ? '<p>The JSON contains the following new items:</p>' + newItems.join('') : '') + `<p>Import <strong>${newEntries.length}</strong> paycheck entr(ies)?</p>`;
    showImportConfirm('Import Paycheck Entries (JSON)', body, () => {
        [...newAccounts].forEach(name => ledgerData.accounts.push({ id: Date.now().toString() + Math.random(), name, initialBalance: 0 }));
        [...newEnvelopes].forEach(name => { if (!ledgerData.envelopes[name]) ledgerData.envelopes[name] = { color: '#2D5F3F', funding: {} }; });
        if (!ledgerData.paychecks) ledgerData.paychecks = [];
        newEntries.forEach(e => {
            const acc = ledgerData.accounts.find(a => a.name === e.account);
            if (!acc) return;
            const newId = Date.now().toString() + Math.random();
            const year = new Date().getFullYear();
            const dateStr = e.date || `${year}-${String(e.month).padStart(2,'0')}-01`;
            if (e.amount < 0) {
                const txId = paycheckCreateLinkedTransaction(newId, e.month, acc.id, e.amount, e.envelope, dateStr);
                ledgerData.paychecks.push({ id: newId, date: dateStr, month: e.month, accountId: acc.id, amount: e.amount, envelope: e.envelope, linkedTransactionId: txId });
            } else {
                ledgerData.paychecks.push({ id: newId, date: dateStr, month: e.month, accountId: acc.id, amount: e.amount, gross: e.gross, tithingType: e.tithingType });
            }
        });
        markUnsaved(); updateUI();
        showMessage(`Imported ${newEntries.length} paycheck entr(ies)`);
    });
}

function parseEnvelopesJSON(envelopesObj) {
    const toAdd = [], toUpdate = [];
    Object.entries(envelopesObj).forEach(([name, env]) => {
        if (!name || name === 'Transfer') return;
        const color = env.color || '#2D5F3F';
        const funding = env.funding || {};
        const necessary = !!env.necessary;
        if (ledgerData.envelopes[name]) toUpdate.push({ name, color, funding, necessary });
        else toAdd.push({ name, color, funding, necessary });
    });
    const parts = [];
    if (toAdd.length) parts.push(`Add <strong>${toAdd.length}</strong> new envelope(s): ${toAdd.map(e=>escapeHtml(e.name)).join(', ')}`);
    if (toUpdate.length) parts.push(`Update <strong>${toUpdate.length}</strong> existing envelope(s): ${toUpdate.map(e=>escapeHtml(e.name)).join(', ')}`);
    if (!parts.length) return showMessage('No valid envelope data found in JSON', 'error');
    showImportConfirm('Import Envelopes (JSON)', '<p>' + parts.join('<br>') + '</p>', () => {
        toAdd.forEach(e => { ledgerData.envelopes[e.name] = { color: e.color, funding: e.funding, necessary: e.necessary }; });
        toUpdate.forEach(e => { ledgerData.envelopes[e.name].color = e.color; ledgerData.envelopes[e.name].necessary = e.necessary; Object.assign(ledgerData.envelopes[e.name].funding || (ledgerData.envelopes[e.name].funding = {}), e.funding); });
        markUnsaved(); updateUI();
        showMessage(`Processed ${toAdd.length + toUpdate.length} envelope(s) (${toAdd.length} added, ${toUpdate.length} updated)`);
    });
}

function parseStatementsJSON(items) {
    const toAdd = [], toUpdate = [], newAccounts = new Set(), errors = [];
    items.forEach((item, i) => {
        const month = parseInt(item.month);
        if (isNaN(month) || month < 1 || month > 12) { errors.push(`Item ${i+1}: invalid month`); return; }
        let accName = item.account || '';
        if (item.accountId) { const acc = ledgerData.accounts.find(a => a.id === item.accountId); if (acc) accName = acc.name; }
        if (!ledgerData.accounts.find(a => a.name === accName)) newAccounts.add(accName);
        const acc = ledgerData.accounts.find(a => a.name === accName);
        const s = { accountName: accName, accountId: acc ? acc.id : null, month, startDate: item.startDate || '', endDate: item.endDate || '', startBalance: parseFloat(item.startBalance) || 0, endBalance: parseFloat(item.endBalance) || 0, deposits: parseFloat(item.deposits) || 0, withdrawals: parseFloat(item.withdrawals) || 0 };
        const existing = acc ? (ledgerData.statements || []).find(x => x.accountId === acc.id && x.month === month) : null;
        if (existing) toUpdate.push({ ...s, existingId: existing.id });
        else toAdd.push(s);
    });
    if (errors.length) return showMessage('JSON errors:\n' + errors.join('\n'), 'error');
    const parts = [];
    if (newAccounts.size) parts.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Accounts (will be created):</div><ul>${[...newAccounts].map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`);
    if (toAdd.length) parts.push(`<p>Add <strong>${toAdd.length}</strong> new statement(s)</p>`);
    if (toUpdate.length) parts.push(`<p>Update <strong>${toUpdate.length}</strong> existing statement(s)</p>`);
    if (!parts.length) return showMessage('No valid statement data found', 'error');
    showImportConfirm('Import Statements (JSON)', parts.join(''), () => {
        [...newAccounts].forEach(name => ledgerData.accounts.push({ id: Date.now().toString() + Math.random(), name, initialBalance: 0 }));
        if (!ledgerData.statements) ledgerData.statements = [];
        [...toAdd, ...toUpdate].forEach(s => {
            const acc = ledgerData.accounts.find(a => a.name === s.accountName);
            if (!acc) return;
            if (s.existingId) { const ex = ledgerData.statements.find(x => x.id === s.existingId); if (ex) Object.assign(ex, { accountId: acc.id, month: s.month, startDate: s.startDate, endDate: s.endDate, startBalance: s.startBalance, endBalance: s.endBalance, deposits: s.deposits, withdrawals: s.withdrawals }); }
            else ledgerData.statements.push({ id: Date.now().toString() + Math.random(), accountId: acc.id, month: s.month, startDate: s.startDate, endDate: s.endDate, startBalance: s.startBalance, endBalance: s.endBalance, deposits: s.deposits, withdrawals: s.withdrawals });
        });
        markUnsaved(); updateUI();
        showMessage(`Processed ${toAdd.length + toUpdate.length} statement(s) (${toAdd.length} added, ${toUpdate.length} updated)`);
    });
}

function parseCSVRows(text) {
    // Returns { header: string[], rows: object[] }
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV file is empty or has no data rows');
    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].match(/("(?:[^"]|"")*"|[^,]*)/g)
            .map(v => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
        if (values.every(v => v === '')) continue;
        const row = {};
        header.forEach((col, idx) => { row[col] = (values[idx] || '').trim(); });
        rows.push(row);
    }
    return { header, rows };
}

function parseCSVFor(ctx, header, rows) {
    if (ctx === 'transactions') parseTransactionsCSV(header, rows);
    else if (ctx === 'paychecks') parsePaychecksCSV(header, rows);
    else if (ctx === 'envelopes') parseEnvelopesCSV(header, rows);
    else if (ctx === 'statements') parseStatementsCSV(header, rows);
}

// ── Transactions CSV ──────────────────────────────────────────────────────────
function parseTransactionsCSV(header, rows) {
    const required = ['date', 'account', 'amount', 'description'];
    const missing = required.filter(f => !header.includes(f));
    if (missing.length) return showMessage('Transactions CSV missing columns: ' + missing.join(', '), 'error');

    const newTransactions = [], newAccounts = new Set(), newEnvelopes = new Set();
    rows.forEach(row => {
        const account = row.account;
        const envelope = row.envelope || '';
        const month = row.month ? parseInt(row.month) : new Date(row.date + 'T00:00:00').getMonth() + 1;
        if (!ledgerData.accounts.find(a => a.name === account)) newAccounts.add(account);
        if (envelope && !ledgerData.envelopes[envelope]) newEnvelopes.add(envelope);
        newTransactions.push({ date: row.date, month, account, amount: parseFloat(row.amount), description: row.description, envelope });
    });

    const newItems = [];
    if (newAccounts.size) newItems.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Accounts:</div><ul>${[...newAccounts].map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`);
    if (newEnvelopes.size) newItems.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Envelopes:</div><ul>${[...newEnvelopes].map(e=>`<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`);

    const body = (newItems.length ? '<p>The CSV contains the following new items:</p>' + newItems.join('') : '') +
        `<p>Import <strong>${newTransactions.length}</strong> transaction(s)?</p>`;

    showImportConfirm('Import Transactions', body, () => {
        [...newAccounts].forEach(name => ledgerData.accounts.push({ id: Date.now().toString() + Math.random(), name, initialBalance: 0 }));
        [...newEnvelopes].forEach(name => { if (!ledgerData.envelopes[name]) ledgerData.envelopes[name] = { color: '#2D5F3F', funding: {} }; });
        newTransactions.forEach(t => {
            const acc = ledgerData.accounts.find(a => a.name === t.account);
            if (acc) ledgerData.transactions.push({ id: Date.now().toString() + Math.random(), date: t.date, month: t.month, accountId: acc.id, amount: t.amount, description: t.description, envelope: t.envelope });
        });
        markUnsaved(); updateUI();
        showMessage(`Imported ${newTransactions.length} transaction(s)`);
    });
}

// ── Paychecks CSV ─────────────────────────────────────────────────────────────
// Required: month, account, amount  Optional: date, gross, tithing_type, envelope
function parsePaychecksCSV(header, rows) {
    const required = ['month', 'account', 'amount'];
    const missing = required.filter(f => !header.includes(f));
    if (missing.length) return showMessage('Paychecks CSV missing columns: ' + missing.join(', '), 'error');

    const newEntries = [], newAccounts = new Set(), newEnvelopes = new Set(), errors = [];
    rows.forEach((row, i) => {
        const account = row.account;
        const amount = parseFloat(row.amount);
        const month = parseInt(row.month);
        if (isNaN(amount) || isNaN(month)) { errors.push(`Row ${i+2}: invalid amount or month`); return; }
        if (!ledgerData.accounts.find(a => a.name === account)) newAccounts.add(account);
        const envelope = row.envelope || '';
        if (amount < 0 && !envelope) { errors.push(`Row ${i+2}: deduction entry requires an envelope`); return; }
        if (envelope && !ledgerData.envelopes[envelope]) newEnvelopes.add(envelope);
        const year = new Date().getFullYear();
        const date = row.date || `${year}-${String(month).padStart(2,'0')}-01`;
        newEntries.push({ month, date, account, amount, gross: row.gross ? parseFloat(row.gross) : null, tithingType: row.tithing_type || row.tithingtype || 'tithing', envelope });
    });

    if (errors.length) return showMessage('CSV errors:\n' + errors.join('\n'), 'error');

    const newItems = [];
    if (newAccounts.size) newItems.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Accounts:</div><ul>${[...newAccounts].map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`);
    if (newEnvelopes.size) newItems.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Envelopes:</div><ul>${[...newEnvelopes].map(e=>`<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`);

    const body = (newItems.length ? '<p>The CSV contains the following new items:</p>' + newItems.join('') : '') +
        `<p>Import <strong>${newEntries.length}</strong> paycheck entr(ies)?</p>`;

    showImportConfirm('Import Paycheck Entries', body, () => {
        [...newAccounts].forEach(name => ledgerData.accounts.push({ id: Date.now().toString() + Math.random(), name, initialBalance: 0 }));
        [...newEnvelopes].forEach(name => { if (!ledgerData.envelopes[name]) ledgerData.envelopes[name] = { color: '#2D5F3F', funding: {} }; });
        newEntries.forEach(e => {
            const acc = ledgerData.accounts.find(a => a.name === e.account);
            if (!acc) return;
            if (!ledgerData.paychecks) ledgerData.paychecks = [];
            const newId = Date.now().toString() + Math.random();
            if (e.amount < 0) {
                const txId = paycheckCreateLinkedTransaction(newId, e.month, acc.id, e.amount, e.envelope, e.date);
                ledgerData.paychecks.push({ id: newId, date: e.date, month: e.month, accountId: acc.id, amount: e.amount, envelope: e.envelope, linkedTransactionId: txId });
            } else {
                ledgerData.paychecks.push({ id: newId, date: e.date, month: e.month, accountId: acc.id, amount: e.amount, gross: e.gross, tithingType: e.tithingType });
            }
        });
        markUnsaved(); updateUI();
        showMessage(`Imported ${newEntries.length} paycheck entr(ies)`);
    });
}

// ── Envelopes CSV ─────────────────────────────────────────────────────────────
// Required: name  Optional: color, necessary, funding_<month>
function parseEnvelopesCSV(header, rows) {
    if (!header.includes('name')) return showMessage('Envelopes CSV missing required column: name', 'error');

    const toAdd = [], toUpdate = [];
    rows.forEach(row => {
        const name = row.name;
        if (!name) return;
        const color = row.color || '#2D5F3F';
        const necessary = row.necessary === 'true' || row.necessary === '1';
        const funding = {};
        header.forEach(col => {
            const m = col.match(/^funding_(\d+)$/);
            if (m && row[col] !== '' && row[col] !== undefined) {
                funding[parseInt(m[1])] = parseFloat(row[col]) || 0;
            }
        });
        if (ledgerData.envelopes[name]) toUpdate.push({ name, color, funding, necessary });
        else toAdd.push({ name, color, funding, necessary });
    });

    const parts = [];
    if (toAdd.length) parts.push(`Add <strong>${toAdd.length}</strong> new envelope(s): ${toAdd.map(e=>escapeHtml(e.name)).join(', ')}`);
    if (toUpdate.length) parts.push(`Update <strong>${toUpdate.length}</strong> existing envelope(s): ${toUpdate.map(e=>escapeHtml(e.name)).join(', ')}`);
    if (!parts.length) return showMessage('No valid envelope rows found in CSV', 'error');

    showImportConfirm('Import Envelopes', '<p>' + parts.join('<br>') + '</p>', () => {
        toAdd.forEach(e => { ledgerData.envelopes[e.name] = { color: e.color, funding: e.funding, necessary: e.necessary }; });
        toUpdate.forEach(e => {
            ledgerData.envelopes[e.name].color = e.color;
            ledgerData.envelopes[e.name].necessary = e.necessary;
            if (!ledgerData.envelopes[e.name].funding) ledgerData.envelopes[e.name].funding = {};
            Object.assign(ledgerData.envelopes[e.name].funding, e.funding);
        });
        markUnsaved(); updateUI();
        showMessage(`Processed ${toAdd.length + toUpdate.length} envelope(s) (${toAdd.length} added, ${toUpdate.length} updated)`);
    });
}

// ── Statements CSV ────────────────────────────────────────────────────────────
function parseStatementsCSV(header, rows) {
    const required = ['account', 'month', 'start_balance', 'end_balance', 'deposits', 'withdrawals'];
    const missing = required.filter(f => !header.includes(f));
    if (missing.length) return showMessage('Statements CSV missing columns: ' + missing.join(', '), 'error');

    const toAdd = [], toUpdate = [], newAccounts = new Set(), errors = [];
    rows.forEach((row, i) => {
        const accountName = row.account;
        const month = parseInt(row.month);
        if (isNaN(month) || month < 1 || month > 12) { errors.push(`Row ${i+2}: invalid month`); return; }
        const acc = ledgerData.accounts.find(a => a.name === accountName);
        if (!acc) { newAccounts.add(accountName); }
        const s = { accountName, accountId: acc ? acc.id : null, month, startDate: row.start_date || row.startdate || '', endDate: row.end_date || row.enddate || '', startBalance: parseFloat(row.start_balance) || 0, endBalance: parseFloat(row.end_balance) || 0, deposits: parseFloat(row.deposits) || 0, withdrawals: parseFloat(row.withdrawals) || 0 };
        const existing = acc ? (ledgerData.statements || []).find(x => x.accountId === acc.id && x.month === month) : null;
        if (existing) toUpdate.push({ ...s, existingId: existing.id });
        else toAdd.push(s);
    });

    if (errors.length) return showMessage('CSV errors:\n' + errors.join('\n'), 'error');

    const parts = [];
    if (newAccounts.size) parts.push(`<div class="confirmation-list"><div class="confirmation-list-title">New Accounts (will be created):</div><ul>${[...newAccounts].map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`);
    if (toAdd.length) parts.push(`<p>Add <strong>${toAdd.length}</strong> new statement(s)</p>`);
    if (toUpdate.length) parts.push(`<p>Update <strong>${toUpdate.length}</strong> existing statement(s)</p>`);
    if (!parts.length) return showMessage('No valid statement rows found', 'error');

    showImportConfirm('Import Statements', parts.join(''), () => {
        [...newAccounts].forEach(name => ledgerData.accounts.push({ id: Date.now().toString() + Math.random(), name, initialBalance: 0 }));
        if (!ledgerData.statements) ledgerData.statements = [];
        [...toAdd, ...toUpdate].forEach(s => {
            const acc = ledgerData.accounts.find(a => a.name === s.accountName);
            if (!acc) return;
            if (s.existingId) { const existing = ledgerData.statements.find(x => x.id === s.existingId); if (existing) Object.assign(existing, { accountId: acc.id, month: s.month, startDate: s.startDate, endDate: s.endDate, startBalance: s.startBalance, endBalance: s.endBalance, deposits: s.deposits, withdrawals: s.withdrawals }); }
            else ledgerData.statements.push({ id: Date.now().toString() + Math.random(), accountId: acc.id, month: s.month, startDate: s.startDate, endDate: s.endDate, startBalance: s.startBalance, endBalance: s.endBalance, deposits: s.deposits, withdrawals: s.withdrawals });
        });
        markUnsaved(); updateUI();
        showMessage(`Processed ${toAdd.length + toUpdate.length} statement(s) (${toAdd.length} added, ${toUpdate.length} updated)`);
    });
}
