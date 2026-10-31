// ─── Import (CSV + JSON) ─────────────────────────────────────────────────────
// Each tab imports one kind of record, from a file or by pasting onto the tab.
// CSV rows are first normalized into the same shape as JSON items, so both
// formats share one importer per record type. Column and field names are
// documented in docs/data-format.md.

// Entry point: open a file picker then route to the right parser
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

const IMPORTERS = {
    transactions: { jsonKey: 'transactions', fromCsv: transactionsFromCSV, run: importTransactions },
    paychecks: { jsonKey: 'paychecks', fromCsv: paychecksFromCSV, run: importPaychecks },
    envelopes: { jsonKey: 'envelopes', fromCsv: envelopesFromCSV, run: importEnvelopes },
    statements: { jsonKey: 'statements', fromCsv: statementsFromCSV, run: importStatements }
};

function parseImportText(ctx, text, filename) {
    const importer = IMPORTERS[ctx];
    const trimmed = text.trim();
    const isJson = filename ? filename.toLowerCase().endsWith('.json') : (trimmed.startsWith('{') || trimmed.startsWith('['));
    if (isJson) {
        let data;
        try { data = JSON.parse(trimmed); }
        catch (e) { return showMessage('Invalid JSON: ' + e.message, 'error'); }
        // Accept a full ledger export (take just the relevant part) or the part on its own
        let items = data;
        if (ctx === 'envelopes') {
            if (Array.isArray(data)) return showMessage('JSON has no envelopes object', 'error');
            if (data.envelopes) items = data.envelopes;
        } else if (!Array.isArray(data)) {
            items = data[importer.jsonKey];
            if (!Array.isArray(items)) return showMessage(`JSON has no ${importer.jsonKey} array`, 'error');
        }
        importer.run(items, 'JSON');
    } else {
        const { header, rows } = Ledger.parseCSV(trimmed);
        const items = importer.fromCsv(header, rows);
        if (items) importer.run(items, 'CSV');
    }
}

function requireColumns(header, required, label) {
    const missing = required.filter(f => !header.includes(f));
    if (missing.length) { showMessage(`${label} CSV missing columns: ${missing.join(', ')}`, 'error'); return false; }
    return true;
}

function transactionsFromCSV(header, rows) {
    if (!requireColumns(header, ['date', 'account', 'amount', 'description'], 'Transactions')) return null;
    return rows;
}

function paychecksFromCSV(header, rows) {
    if (!requireColumns(header, ['month', 'account', 'amount'], 'Paychecks')) return null;
    return rows.map(r => ({ ...r, tithingType: r.tithing_type || r.tithingtype }));
}

function envelopesFromCSV(header, rows) {
    if (!requireColumns(header, ['name'], 'Envelopes')) return null;
    const result = {};
    rows.forEach(row => {
        if (!row.name) return;
        const funding = {};
        header.forEach(col => {
            const m = col.match(/^funding_(\d+)$/);
            if (m && row[col] !== '') funding[parseInt(m[1], 10)] = parseFloat(row[col]) || 0;
        });
        result[row.name] = { color: row.color, necessary: row.necessary === 'true' || row.necessary === '1', openingBalance: row.opening_balance, funding };
    });
    return result;
}

function statementsFromCSV(header, rows) {
    if (!requireColumns(header, ['account', 'month', 'start_balance', 'end_balance', 'deposits', 'withdrawals'], 'Statements')) return null;
    return rows.map(r => ({
        account: r.account, month: r.month,
        startDate: r.start_date || r.startdate, endDate: r.end_date || r.enddate,
        startBalance: r.start_balance, endBalance: r.end_balance, deposits: r.deposits, withdrawals: r.withdrawals
    }));
}

// ── Shared helpers ────────────────────────────────────────────────────────────

// Account name for an imported item: `account` by name, or `accountId` of an existing account.
function importAccountName(item) {
    if (item.accountId) {
        const acc = ledgerData.accounts.find(a => a.id === item.accountId);
        if (acc) return acc.name;
    }
    return (item.account || '').trim();
}

function accountIdByName(name) {
    const acc = ledgerData.accounts.find(a => a.name === name);
    return acc ? acc.id : null;
}

function newItemsHtml(label, names) {
    if (!names.size) return '';
    return `<div class="confirmation-list"><div class="confirmation-list-title">${label}:</div><ul>${[...names].map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>`;
}

function reportErrors(format, errors) {
    if (!errors.length) return false;
    const shown = errors.slice(0, 8).join('\n') + (errors.length > 8 ? `\n…and ${errors.length - 8} more` : '');
    showMessage(`${format} errors:\n${shown}`, 'error');
    return true;
}

function newEnvelopeNames(items) {
    return new Set(items.map(x => x.envelope).filter(e => e && !ledgerData.envelopes[e]));
}

function newAccountNames(items) {
    return new Set(items.map(x => x.account).filter(a => !accountIdByName(a)));
}

// ── Transactions ──────────────────────────────────────────────────────────────

function transactionKey(t) {
    return [t.date, t.accountId, Ledger.roundCents(t.amount), (t.description || '').trim().toLowerCase()].join('|');
}

function importTransactions(items, format) {
    const parsed = [], errors = [];
    items.forEach((item, i) => {
        const where = format === 'CSV' ? `Row ${i + 2}` : `Item ${i + 1}`;
        const amount = parseFloat(item.amount);
        const month = parseInt(item.month, 10) || Ledger.monthFromDate(item.date);
        const account = importAccountName(item);
        if (!Ledger.monthFromDate(item.date)) return errors.push(`${where}: date must be YYYY-MM-DD`);
        if (isNaN(amount)) return errors.push(`${where}: invalid amount`);
        if (!(month >= 1 && month <= 12)) return errors.push(`${where}: invalid month`);
        if (!account) return errors.push(`${where}: missing account`);
        parsed.push({ date: item.date, month, account, amount, description: item.description || '', envelope: item.envelope || '' });
    });
    if (reportErrors(format, errors)) return;

    // Skip rows that are already in the ledger, e.g. when a statement is imported twice
    const existing = new Set(ledgerData.transactions.map(transactionKey));
    const fresh = parsed.filter(t => {
        const id = accountIdByName(t.account);
        return !(id && existing.has(transactionKey({ ...t, accountId: id })));
    });
    const skipped = parsed.length - fresh.length;

    const otherYear = fresh.filter(t => Ledger.yearFromDate(t.date) !== ledgerData.year).length;
    const body = newItemsHtml('New Accounts', newAccountNames(fresh)) + newItemsHtml('New Envelopes', newEnvelopeNames(fresh)) +
        (skipped ? `<p>${skipped} transaction(s) are already in the ledger and will be skipped.</p>` : '') +
        (otherYear ? `<p><strong>${otherYear}</strong> transaction(s) are dated outside ${ledgerData.year}.</p>` : '') +
        `<p>Import <strong>${fresh.length}</strong> transaction(s)?</p>`;

    showImportConfirm(`Import Transactions (${format})`, body, () => {
        ensureAccounts(newAccountNames(fresh));
        ensureEnvelopes(newEnvelopeNames(fresh));
        fresh.forEach(t => {
            ledgerData.transactions.push({ id: Ledger.newId(), date: t.date, month: t.month, accountId: accountIdByName(t.account), amount: t.amount, description: t.description, envelope: t.envelope });
        });
        markUnsaved(); updateUI();
        showMessage(`Imported ${fresh.length} transaction(s)` + (skipped ? `, skipped ${skipped} duplicate(s)` : ''));
    });
}

// ── Paychecks ─────────────────────────────────────────────────────────────────

function importPaychecks(items, format) {
    const parsed = [], errors = [];
    items.forEach((item, i) => {
        const where = format === 'CSV' ? `Row ${i + 2}` : `Item ${i + 1}`;
        const amount = parseFloat(item.amount);
        const month = parseInt(item.month, 10) || Ledger.monthFromDate(item.date);
        const account = importAccountName(item);
        const envelope = item.envelope || '';
        if (isNaN(amount) || !(month >= 1 && month <= 12)) return errors.push(`${where}: invalid amount or month`);
        if (!account) return errors.push(`${where}: missing account`);
        if (amount < 0 && !envelope) return errors.push(`${where}: deduction entry requires an envelope`);
        const gross = parseFloat(item.gross);
        parsed.push({ date: item.date || null, month, account, amount, gross: isNaN(gross) ? null : gross, tithingType: item.tithingType || 'tithing', envelope });
    });
    if (reportErrors(format, errors)) return;

    const body = newItemsHtml('New Accounts', newAccountNames(parsed)) + newItemsHtml('New Envelopes', newEnvelopeNames(parsed)) +
        `<p>Import <strong>${parsed.length}</strong> paycheck entr(ies)?</p>`;

    showImportConfirm(`Import Paycheck Entries (${format})`, body, () => {
        ensureAccounts(newAccountNames(parsed));
        ensureEnvelopes(newEnvelopeNames(parsed));
        parsed.forEach(e => addPaycheckEntry({ ...e, accountId: accountIdByName(e.account) }));
        markUnsaved(); updateUI();
        showMessage(`Imported ${parsed.length} paycheck entr(ies)`);
    });
}

// ── Envelopes ─────────────────────────────────────────────────────────────────

function importEnvelopes(envelopesObj, format) {
    const toAdd = [], toUpdate = [];
    Object.entries(envelopesObj).forEach(([name, env]) => {
        if (!name || name === Ledger.TRANSFER_ENVELOPE || !env || typeof env !== 'object') return;
        const e = { name, color: safeColor(env.color), funding: env.funding || {}, necessary: !!env.necessary, openingBalance: parseFloat(env.openingBalance) || 0 };
        (ledgerData.envelopes[name] ? toUpdate : toAdd).push(e);
    });

    const parts = [];
    if (toAdd.length) parts.push(`Add <strong>${toAdd.length}</strong> new envelope(s): ${toAdd.map(e => escapeHtml(e.name)).join(', ')}`);
    if (toUpdate.length) parts.push(`Update <strong>${toUpdate.length}</strong> existing envelope(s): ${toUpdate.map(e => escapeHtml(e.name)).join(', ')}`);
    if (!parts.length) return showMessage(`No valid envelope data found in ${format}`, 'error');

    showImportConfirm(`Import Envelopes (${format})`, '<p>' + parts.join('<br>') + '</p>', () => {
        toAdd.forEach(e => { ledgerData.envelopes[e.name] = { color: e.color, funding: { ...e.funding }, necessary: e.necessary, openingBalance: e.openingBalance }; });
        toUpdate.forEach(e => {
            const env = ledgerData.envelopes[e.name];
            env.color = e.color;
            env.necessary = e.necessary;
            env.openingBalance = e.openingBalance;
            Object.assign(env.funding, e.funding);
        });
        markUnsaved(); updateUI();
        showMessage(`Processed ${toAdd.length + toUpdate.length} envelope(s) (${toAdd.length} added, ${toUpdate.length} updated)`);
    });
}

// ── Statements ────────────────────────────────────────────────────────────────

function importStatements(items, format) {
    const parsed = [], errors = [];
    items.forEach((item, i) => {
        const where = format === 'CSV' ? `Row ${i + 2}` : `Item ${i + 1}`;
        const month = parseInt(item.month, 10);
        const account = importAccountName(item);
        if (!(month >= 1 && month <= 12)) return errors.push(`${where}: invalid month`);
        if (!account) return errors.push(`${where}: missing account`);
        parsed.push({
            account, month, startDate: item.startDate || '', endDate: item.endDate || '',
            startBalance: parseFloat(item.startBalance) || 0, endBalance: parseFloat(item.endBalance) || 0,
            deposits: parseFloat(item.deposits) || 0, withdrawals: parseFloat(item.withdrawals) || 0
        });
    });
    if (reportErrors(format, errors)) return;

    const existing = s => {
        const id = accountIdByName(s.account);
        return id ? Ledger.findStatement(ledgerData, id, s.month) : null;
    };
    const updates = parsed.filter(existing).length;
    const parts = [newItemsHtml('New Accounts (will be created)', newAccountNames(parsed))];
    if (parsed.length - updates) parts.push(`<p>Add <strong>${parsed.length - updates}</strong> new statement(s)</p>`);
    if (updates) parts.push(`<p>Update <strong>${updates}</strong> existing statement(s)</p>`);
    if (!parsed.length) return showMessage('No valid statement data found', 'error');

    showImportConfirm(`Import Statements (${format})`, parts.join(''), () => {
        ensureAccounts(newAccountNames(parsed));
        parsed.forEach(s => {
            const { account, ...fields } = s;
            const record = { ...fields, accountId: accountIdByName(account) };
            const ex = existing(s);
            if (ex) Object.assign(ex, record);
            else ledgerData.statements.push({ id: Ledger.newId(), ...record });
        });
        markUnsaved(); updateUI();
        showMessage(`Processed ${parsed.length} statement(s) (${parsed.length - updates} added, ${updates} updated)`);
    });
}
