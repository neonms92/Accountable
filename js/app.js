// ─── Application State ───────────────────────────────────────────────────────
// Script load order (see index.html): ledger.js first, this file last; it calls init().
let ledgerData = Ledger.emptyLedger();
let selectedMonth = new Date().getMonth() + 1;
let envelopeModalColor = Ledger.DEFAULT_COLOR;
let sortState = { table: null, column: null, direction: 'asc' };
// Generic multiselect state: keyed by context ('transactions' | 'paychecks')
let selectedItems = { transactions: new Set(), paychecks: new Set() };
let lastSelectedIndex = { transactions: -1, paychecks: -1 };
let pendingAction = null;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function init() {
    populateMonthSelector();
    syncPeriodControls();
    setTodayDate();
    setupKeyboardShortcuts();
    setupFormListeners();
    updateUI();
    driveInit();
}

// Default date for new entries: today if it falls in the ledger's year, otherwise
// the first of the selected month in that year.
function defaultEntryDate() {
    const today = new Date();
    if (today.getFullYear() === ledgerData.year) return today.toISOString().split('T')[0];
    return Ledger.defaultDate(ledgerData.year, selectedMonth);
}

function setTodayDate() {
    const date = defaultEntryDate();
    const month = String(Ledger.monthFromDate(date));
    document.getElementById('transactionDate').value = date;
    document.getElementById('transferDate').value = date;
    document.getElementById('paycheckDate').value = date;
    document.getElementById('transactionMonth').value = month;
    document.getElementById('transferMonth').value = month;
}

function populateMonthSelector() {
    const select = document.getElementById('monthSelect');
    MONTH_NAMES.forEach((month, i) => {
        const opt = document.createElement('option');
        opt.value = (i + 1).toString();
        opt.textContent = month;
        select.appendChild(opt);
    });
}

function syncPeriodControls() {
    document.getElementById('monthSelect').value = String(selectedMonth);
    document.getElementById('yearInput').value = ledgerData.year;
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' && e.shiftKey) {
            e.preventDefault();
            const ctx = getActiveSelectionContext();
            if (ctx) moveSelection(ctx, -1);
        } else if (e.key === 'ArrowDown' && e.shiftKey) {
            e.preventDefault();
            const ctx = getActiveSelectionContext();
            if (ctx) moveSelection(ctx, 1);
        }
    });

    document.addEventListener('paste', (e) => {
        // Only handle paste when no modal is open and an importable tab is active
        if (isAnyModalOpen()) return;
        const ctx = getActiveImportTab();
        if (!ctx) return;
        // Ignore paste inside input/textarea elements
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text || !text.trim()) return;
        try {
            parseImportText(ctx, text, null);
        } catch (err) {
            showMessage('Paste import error: ' + err.message, 'error');
        }
    });
}

function setupFormListeners() {
    // Picking a date fills in its month; the month can still be changed afterwards
    // for entries that belong to a different statement period.
    [['transactionDate', 'transactionMonth'], ['transferDate', 'transferMonth'],
     ['paycheckDate', 'paycheckMonth'], ['statementEndDate', 'statementMonth']].forEach(([dateId, monthId]) => {
        document.getElementById(dateId).addEventListener('change', (e) => {
            const m = Ledger.monthFromDate(e.target.value);
            if (m) document.getElementById(monthId).value = String(m);
        });
    });
    ['statementStartBalance', 'statementEndBalance', 'statementDeposits', 'statementWithdrawals'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateStatementSanityCheck);
    });
}

function getActiveSelectionContext() {
    if (document.getElementById('transactionsTab').classList.contains('active')) return 'transactions';
    if (document.getElementById('paychecksTab').classList.contains('active')) return 'paychecks';
    return null;
}

function moveSelection(ctx, direction) {
    const bodyId = ctx === 'transactions' ? 'transactionsBody' : 'paychecksBody';
    const rows = Array.from(document.querySelectorAll(`#${bodyId} tr`));
    if (rows.length === 0 || lastSelectedIndex[ctx] === -1) return;
    const newIndex = Math.max(0, Math.min(rows.length - 1, lastSelectedIndex[ctx] + direction));
    const row = rows[newIndex];
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) {
        checkbox.checked = true;
        selectedItems[ctx].add(checkbox.dataset.id);
        lastSelectedIndex[ctx] = newIndex;
        updateSelectionUI(ctx);
    }
}

function selectEnvelopeModalColor(color) {
    envelopeModalColor = color;
    document.getElementById('envelopeModalColorPreview').style.background = color;
    document.getElementById('envelopeModalColorHex').value = color;
    document.querySelectorAll('#envelopeModal .color-preset').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.color.toLowerCase() === color.toLowerCase());
    });
}

function showMessage(msg, type = 'success') {
    const div = document.createElement('div');
    div.className = type === 'success' ? 'floating-message success' : 'floating-message error';
    div.textContent = msg;
    div.onclick = () => div.remove();
    document.getElementById('messageContainer').appendChild(div);
    setTimeout(() => div.remove(), 5000);
}

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(name + 'Tab').classList.add('active');
}

function onMonthChange() {
    selectedMonth = parseInt(document.getElementById('monthSelect').value, 10);
    setTodayDate();
    updateUI();
}

function onYearChange() {
    const year = parseInt(document.getElementById('yearInput').value, 10);
    if (!(year >= 1900 && year <= 2999)) {
        document.getElementById('yearInput').value = ledgerData.year;
        return showMessage('Please enter a valid year', 'error');
    }
    if (year === ledgerData.year) return;
    ledgerData.year = year;
    setTodayDate();
    markUnsaved();
    updateUI();
}

// ─── Loading and saving ──────────────────────────────────────────────────────

// Single entry point for every load (local file or Google Drive), so older files
// are always migrated the same way.
function loadLedger(raw, fileName) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    ledgerData = Ledger.migrate(parsed);
    ledgerData.fileName = fileName;
    selectedItems = { transactions: new Set(), paychecks: new Set() };
    lastSelectedIndex = { transactions: -1, paychecks: -1 };
    selectDefaultMonth();
    syncPeriodControls();
    setTodayDate();
    markSaved();
    updateUI();
}

function openFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                loadLedger(event.target.result, file.name);
                closeFileMenuModal();
                showMessage('File loaded successfully!');
            } catch (err) {
                showMessage('Error loading file: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// Select the month of the most recent dated entry; with no entries, the current
// month if the ledger is for this year, otherwise January.
function selectDefaultMonth() {
    const dates = [...ledgerData.transactions, ...ledgerData.paychecks]
        .filter(x => Ledger.yearFromDate(x.date) === ledgerData.year && x.month)
        .map(x => x.date);
    if (dates.length) {
        const latest = dates.reduce((a, b) => (b > a ? b : a));
        selectedMonth = Ledger.monthFromDate(latest);
    } else {
        const now = new Date();
        selectedMonth = now.getFullYear() === ledgerData.year ? now.getMonth() + 1 : 1;
    }
}

function saveFile() {
    const dataStr = JSON.stringify(ledgerData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ledgerData.fileName || `budget-ledger-${ledgerData.year}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    markSaved();
    showMessage('File saved successfully!');
}

let hasUnsavedChanges = false;

function markUnsaved() {
    hasUnsavedChanges = true;
    updateUnsavedIndicator();
}

function markSaved() {
    hasUnsavedChanges = false;
    updateUnsavedIndicator();
}

function updateUnsavedIndicator() {
    const indicator = document.getElementById('unsavedIndicator');
    if (indicator) {
        indicator.style.display = hasUnsavedChanges ? 'inline' : 'none';
    }
}

window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// ─── Unified Import (CSV + JSON) ──────────────────────────────────────────────

// Returns the currently active importable tab name, or null
function getActiveImportTab() {
    const tabs = ['transactions', 'paychecks', 'envelopes', 'statements'];
    for (const t of tabs) {
        if (document.getElementById(t + 'Tab').classList.contains('active')) return t;
    }
    return null;
}

// Returns true if any modal is currently open
function isAnyModalOpen() {
    return Array.from(document.querySelectorAll('.modal')).some(m => m.classList.contains('active'));
}

// ── Shared confirm helper ─────────────────────────────────────────────────────
function showConfirm(action, title, bodyHtml, buttonText, danger = true) {
    pendingAction = action;
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalBody').innerHTML = bodyHtml;
    document.getElementById('confirmActionBtn').textContent = buttonText;
    document.getElementById('confirmActionBtn').className = danger ? 'danger' : '';
    document.getElementById('confirmModal').classList.add('active');
}

function showImportConfirm(title, bodyHtml, onConfirm) {
    showConfirm({ type: 'importGeneric', onConfirm }, title, bodyHtml, 'Confirm Import', false);
}

function confirmDeleteAccount() {
    const id = document.getElementById('accountId').value;
    if (!id) return;
    showConfirm({ type: 'deleteAccount', id }, 'Delete Account',
        '<p>Are you sure you want to delete this account? All of its transactions, paycheck entries and statements will also be deleted.</p>',
        'Delete Account');
}

function confirmDeleteTransaction() {
    const id = document.getElementById('transactionId').value;
    if (!id) return;
    showConfirm({ type: 'deleteTransaction', id }, 'Delete Transaction',
        '<p>Are you sure you want to delete this transaction?</p>', 'Delete Transaction');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
    document.getElementById('confirmActionBtn').className = '';
    pendingAction = null;
}

function executeConfirmAction() {
    if (!pendingAction) return;

    switch (pendingAction.type) {
        case 'importGeneric':
            pendingAction.onConfirm();
            break;
        case 'deleteAccount':
            ledgerData.accounts = ledgerData.accounts.filter(a => a.id !== pendingAction.id);
            ledgerData.transactions = ledgerData.transactions.filter(t => t.accountId !== pendingAction.id);
            ledgerData.paychecks = ledgerData.paychecks.filter(p => p.accountId !== pendingAction.id);
            ledgerData.statements = ledgerData.statements.filter(s => s.accountId !== pendingAction.id);
            markUnsaved();
            updateUI();
            closeAccountModal();
            showMessage('Account deleted successfully!');
            break;
        case 'deleteTransaction':
            deleteTransactions(new Set([pendingAction.id]));
            markUnsaved();
            updateUI();
            closeTransactionModal();
            showMessage('Transaction deleted successfully!');
            break;
        case 'deleteSelected':
            if (pendingAction.ctx === 'transactions') {
                deleteTransactions(selectedItems.transactions);
                selectedItems.transactions.clear();
                lastSelectedIndex.transactions = -1;
            } else {
                // For paychecks: also clean up linked transactions
                Array.from(selectedItems.paychecks).forEach(id => paycheckDeleteAndCleanup(id));
                selectedItems.paychecks.clear();
                lastSelectedIndex.paychecks = -1;
            }
            markUnsaved();
            updateUI();
            showMessage('Selected items deleted successfully!');
            break;
        case 'deleteStatement':
            ledgerData.statements = ledgerData.statements.filter(s => s.id !== pendingAction.id);
            markUnsaved();
            updateUI();
            closeStatementModal();
            showMessage('Statement deleted successfully!');
            break;
        case 'deleteEnvelope':
            // Remove envelope entity
            delete ledgerData.envelopes[pendingAction.name];
            // Clear envelope from transactions
            ledgerData.transactions.forEach(t => {
                if (t.envelope === pendingAction.name) t.envelope = '';
            });
            markUnsaved();
            updateUI();
            closeEnvelopeModal();
            showMessage('Envelope deleted!');
            break;
        case 'deletePaycheck':
            paycheckDeleteAndCleanup(pendingAction.id);
            markUnsaved();
            updateUI();
            closePaycheckModal();
            showMessage('Paycheck entry deleted!');
            break;
    }

    closeConfirmModal();
}

function openFileMenu() {
    document.getElementById('fileMenuModal').classList.add('active');
}
function closeFileMenuModal() {
    document.getElementById('fileMenuModal').classList.remove('active');
}

// ─── Generic Multiselect ──────────────────────────────────────────────────────

function toggleSelectAll(ctx) {
    const bodyId = ctx === 'transactions' ? 'transactionsBody' : 'paychecksBody';
    const selectAllId = ctx === 'transactions' ? 'selectAllTransactions' : 'selectAllPaychecks';
    const checked = document.getElementById(selectAllId).checked;
    document.querySelectorAll(`#${bodyId} input[type="checkbox"]`).forEach(cb => {
        cb.checked = checked;
        if (checked) selectedItems[ctx].add(cb.dataset.id);
        else selectedItems[ctx].delete(cb.dataset.id);
    });
    updateSelectionUI(ctx);
}

function handleRowClick(ctx, id, index, event) {
    if (event.target.type === 'checkbox') {
        event.stopPropagation();
        const checkbox = event.target;
        if (event.shiftKey && lastSelectedIndex[ctx] !== -1 && lastSelectedIndex[ctx] !== index) {
            const bodyId = ctx === 'transactions' ? 'transactionsBody' : 'paychecksBody';
            const start = Math.min(lastSelectedIndex[ctx], index);
            const end = Math.max(lastSelectedIndex[ctx], index);
            const rows = document.querySelectorAll(`#${bodyId} tr`);
            for (let i = start; i <= end; i++) {
                const cb = rows[i].querySelector('input[type="checkbox"]');
                if (cb) { cb.checked = true; selectedItems[ctx].add(cb.dataset.id); }
            }
        } else {
            if (checkbox.checked) selectedItems[ctx].add(id);
            else selectedItems[ctx].delete(id);
        }
        lastSelectedIndex[ctx] = index;
        updateSelectionUI(ctx);
        return;
    }
    // Row click → open modal
    if (ctx === 'transactions') openTransactionModal(id);
    else openPaycheckModal(id);
}

function updateSelectionUI(ctx) {
    const bodyId = ctx === 'transactions' ? 'transactionsBody' : 'paychecksBody';
    const barId = ctx === 'transactions' ? 'transactionsSelectionBar' : 'paychecksSelectionBar';
    const countId = ctx === 'transactions' ? 'transactionsSelectionCount' : 'paychecksSelectionCount';
    const sumId = ctx === 'transactions' ? 'transactionsSelectionSum' : 'paychecksSelectionSum';
    const selectAllId = ctx === 'transactions' ? 'selectAllTransactions' : 'selectAllPaychecks';
    const count = selectedItems[ctx].size;

    if (count > 0) {
        const collection = ctx === 'transactions' ? ledgerData.transactions : ledgerData.paychecks;
        const sum = Array.from(selectedItems[ctx]).reduce((total, id) => {
            const item = collection.find(x => x.id === id);
            return total + (item ? Math.abs(item.amount) : 0);
        }, 0);
        document.getElementById(countId).textContent = count;
        document.getElementById(sumId).textContent = formatCurrency(sum);
        document.getElementById(barId).style.display = 'flex';
    } else {
        document.getElementById(barId).style.display = 'none';
    }

    document.querySelectorAll(`#${bodyId} tr`).forEach(row => {
        const cb = row.querySelector('input[type="checkbox"]');
        row.classList.toggle('selected', cb && cb.checked);
    });

    const allCbs = document.querySelectorAll(`#${bodyId} input[type="checkbox"]`);
    const allChecked = allCbs.length > 0 && Array.from(allCbs).every(cb => cb.checked);
    const saEl = document.getElementById(selectAllId);
    if (saEl) saEl.checked = allChecked;
}

function confirmDeleteSelectedItems(ctx) {
    if (selectedItems[ctx].size === 0) return;
    const label = ctx === 'transactions' ? 'transaction(s)' : 'paycheck entr(ies)';
    showConfirm({ type: 'deleteSelected', ctx }, 'Delete Selected',
        `<p>Are you sure you want to delete ${selectedItems[ctx].size} selected ${label}?</p>`, 'Delete Selected');
}

function sortTable(table, column) {
    if (sortState.table === table && sortState.column === column) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.table = table;
        sortState.column = column;
        sortState.direction = 'asc';
    }
    updateUI();
}

function compareValues(a, b) {
    const dir = sortState.direction === 'asc' ? 1 : -1;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b) * dir;
    return (a > b ? 1 : a < b ? -1 : 0) * dir;
}

function updateUI() {
    updateFileName();
    updateSummary();
    updateAccountsTable();
    updatePaychecksTab();
    updateStatementsTab();
    updateTransactionsTable();
    updateEnvelopesTable();
    updateTabIncompleteIndicators();
}

function updateFileName() {
    document.getElementById('fileName').textContent = ledgerData.fileName || 'No file loaded';
}

function getMonthTransactions() {
    return ledgerData.transactions.filter(t => t.month === selectedMonth);
}

// Marks a tab as incomplete and lists what's missing in its tooltip.
function updateTabIncompleteIndicators() {
    const status = Ledger.monthStatus(ledgerData, selectedMonth);
    ['statements', 'paychecks', 'transactions', 'envelopes'].forEach(tab => {
        const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
        const issues = status[tab];
        btn.classList.toggle('tab-incomplete', issues.length > 0);
        btn.title = issues.length ? `${MONTH_NAMES[selectedMonth - 1]} still needs:\n• ${issues.join('\n• ')}` : '';
    });
}

function accountOptions(placeholder) {
    return `<option value="">${placeholder}</option>` +
        ledgerData.accounts.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
}

function populateAccountSelects() {
    document.getElementById('transactionAccount').innerHTML = accountOptions('Select account...');
}

function populateTransferSelects() {
    const opts = accountOptions('Select account...');
    document.getElementById('transferFrom').innerHTML = opts;
    document.getElementById('transferTo').innerHTML = opts;
}

function getMonthName(m) {
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] || '';
}

function formatCurrency(amt) {
    const abs = Math.abs(amt);
    const fmt = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return amt < 0 ? '-' + fmt : fmt;
}

function formatDate(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Safe for element content and quoted attribute values.
function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A value passed as a JS argument inside an inline handler attribute,
// e.g. onclick="openEnvelopeModal(${jsArg(name)})". Handles quotes in names.
function jsArg(value) {
    return escapeHtml(JSON.stringify(value));
}

// Envelope colors end up in inline styles, so only allow #rrggbb.
function safeColor(color) {
    return /^#[0-9a-f]{6}$/i.test(color || '') ? color : Ledger.DEFAULT_COLOR;
}

function envelopeTag(name) {
    const color = safeColor(ledgerData.envelopes[name] && ledgerData.envelopes[name].color);
    return `<span class="envelope-tag" style="background-color:${color}20;color:${color};">${escapeHtml(name)}</span>`;
}

document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('active'); });
});

init();
