// ─── Application State ───────────────────────────────────────────────────────
let ledgerData = { accounts: [], transactions: [], envelopes: {}, statements: [], paychecks: [], fileName: null };
let selectedMonth = null;
let selectedEnvelopeColor = '#2D5F3F';
let envelopeModalColor = '#2D5F3F';
let sortState = { table: null, column: null, direction: 'asc' };
// Generic multiselect state: keyed by context ('transactions' | 'paychecks')
let selectedItems = { transactions: new Set(), paychecks: new Set() };
let lastSelectedIndex = { transactions: -1, paychecks: -1 };
let pendingAction = null;

function init() {
    setTodayDate();
    populateMonthSelector();
    setupColorPicker();
    setupKeyboardShortcuts();
    updateUI();
    driveInit();
}

function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('transactionDate').value = today;
    document.getElementById('transferDate').value = today;
    document.getElementById('paycheckDate').value = today;
    const currentMonth = new Date().getMonth() + 1;
    document.getElementById('transactionMonth').value = currentMonth.toString();
    document.getElementById('transferMonth').value = currentMonth.toString();
}

function populateMonthSelector() {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const select = document.getElementById('monthSelect');
    months.forEach((month, i) => {
        const opt = document.createElement('option');
        opt.value = (i + 1).toString();
        opt.textContent = month;
        select.appendChild(opt);
    });
}

function setupColorPicker() {
    // Envelope modal color picker is wired in openEnvelopeModal dynamically
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

function selectColor(color) {
    selectedEnvelopeColor = color;
}

function selectEnvelopeModalColor(color) {
    envelopeModalColor = color;
    document.getElementById('envelopeModalColorPreview').style.background = color;
    document.getElementById('envelopeModalColorHex').value = color;
    document.querySelectorAll('#envelopeModal .color-preset').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.color.toLowerCase() === color.toLowerCase());
    });
}

function onEnvelopeSelectChange() {
    // no-op: inline envelope creation removed
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
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(name + 'Tab').classList.add('active');
}

function onMonthChange() {
    selectedMonth = document.getElementById('monthSelect').value ? parseInt(document.getElementById('monthSelect').value) : null;
    updateUI();
}

function openFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    ledgerData = JSON.parse(event.target.result);
                    ledgerData.fileName = file.name;
                    if (!ledgerData.envelopes) ledgerData.envelopes = {};
                    if (!ledgerData.statements) ledgerData.statements = [];
                    if (!ledgerData.paychecks) ledgerData.paychecks = [];
                    // Migrate envelopes: ensure all have a funding object and necessary flag
                    Object.keys(ledgerData.envelopes).forEach(name => {
                        if (!ledgerData.envelopes[name].funding) ledgerData.envelopes[name].funding = {};
                        if (ledgerData.envelopes[name].necessary === undefined) ledgerData.envelopes[name].necessary = false;
                    });
                    selectDefaultMonth();
                    updateUI();
                    showMessage('File loaded successfully!');
                } catch {
                    showMessage('Error loading file: Invalid JSON format', 'error');
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

function selectDefaultMonth() {
    // Select the month of the most recent transaction, if any
    if (ledgerData.transactions && ledgerData.transactions.length > 0) {
        const recent = ledgerData.transactions.reduce((latest, t) => {
            const tDate = new Date(t.date);
            return (!latest || tDate > new Date(latest.date)) ? t : latest;
        }, null);
        if (recent) {
            // parse date without timezone issues by splitting and using Date.UTC
            const [year, month] = recent.date.split('-');
            selectedMonth = parseInt(month, 10);
            document.getElementById('monthSelect').value = selectedMonth.toString();
        }
    }
}

function saveFile() {
    const dataStr = JSON.stringify(ledgerData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ledgerData.fileName || 'budget-ledger.json';
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

// Entry point: open a file picker then route to the right parser

// ── Shared confirm helper ─────────────────────────────────────────────────────
function showImportConfirm(title, bodyHtml, onConfirm) {
    pendingAction = { type: 'importGeneric', onConfirm };
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalBody').innerHTML = bodyHtml;
    document.getElementById('confirmActionBtn').textContent = 'Confirm Import';
    document.getElementById('confirmActionBtn').className = '';
    document.getElementById('confirmModal').classList.add('active');
}

function confirmDeleteAccount() {
    const id = document.getElementById('accountId').value;
    if (!id) return;
    
    pendingAction = { type: 'deleteAccount', id };
    document.getElementById('confirmModalTitle').textContent = 'Delete Account';
    document.getElementById('confirmModalBody').innerHTML = '<p>Are you sure you want to delete this account? All associated transactions will also be deleted.</p>';
    document.getElementById('confirmActionBtn').textContent = 'Delete Account';
    document.getElementById('confirmActionBtn').className = 'danger';
    document.getElementById('confirmModal').classList.add('active');
}

function confirmDeleteTransaction() {
    const id = document.getElementById('transactionId').value;
    if (!id) return;
    
    pendingAction = { type: 'deleteTransaction', id };
    document.getElementById('confirmModalTitle').textContent = 'Delete Transaction';
    document.getElementById('confirmModalBody').innerHTML = '<p>Are you sure you want to delete this transaction?</p>';
    document.getElementById('confirmActionBtn').textContent = 'Delete Transaction';
    document.getElementById('confirmActionBtn').className = 'danger';
    document.getElementById('confirmModal').classList.add('active');
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
            ledgerData.paychecks = (ledgerData.paychecks || []).filter(p => p.accountId !== pendingAction.id);
            markUnsaved();
            updateUI();
            closeAccountModal();
            showMessage('Account deleted successfully!');
            break;
        case 'deleteTransaction':
            ledgerData.transactions = ledgerData.transactions.filter(t => t.id !== pendingAction.id);
            markUnsaved();
            updateUI();
            closeTransactionModal();
            showMessage('Transaction deleted successfully!');
            break;
        case 'deleteSelected':
            if (pendingAction.ctx === 'transactions') {
                ledgerData.transactions = ledgerData.transactions.filter(t => !selectedItems.transactions.has(t.id));
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
            ledgerData.statements = (ledgerData.statements || []).filter(s => s.id !== pendingAction.id);
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
        const collection = ctx === 'transactions' ? ledgerData.transactions : (ledgerData.paychecks || []);
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
    pendingAction = { type: 'deleteSelected', ctx };
    const label = ctx === 'transactions' ? 'transaction(s)' : 'paycheck entr(ies)';
    document.getElementById('confirmModalTitle').textContent = 'Delete Selected';
    document.getElementById('confirmModalBody').innerHTML = `<p>Are you sure you want to delete ${selectedItems[ctx].size} selected ${label}?</p>`;
    document.getElementById('confirmActionBtn').textContent = 'Delete Selected';
    document.getElementById('confirmActionBtn').className = 'danger';
    document.getElementById('confirmModal').classList.add('active');
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

function getFilteredTransactions() {
    return selectedMonth === null ? ledgerData.transactions : ledgerData.transactions.filter(t => t.month === selectedMonth);
}

function getYTDTransactions() {
    return selectedMonth === null ? ledgerData.transactions : ledgerData.transactions.filter(t => t.month <= selectedMonth);
}


function populateAccountSelects() {
    document.getElementById('transactionAccount').innerHTML = '<option value="">Select account...</option>' + ledgerData.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
}

function populateTransferSelects() {
    const opts = ledgerData.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    document.getElementById('transferFrom').innerHTML = '<option value="">Select account...</option>' + opts;
    document.getElementById('transferTo').innerHTML = '<option value="">Select account...</option>' + opts;
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('active'); });
});

init();
