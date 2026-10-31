// ─── Transactions ────────────────────────────────────────────────────────────

function openTransactionModal(transactionId = null) {
    if (ledgerData.accounts.length === 0) return showMessage('Please add an account first', 'error');

    if (transactionId) {
        const transaction = ledgerData.transactions.find(t => t.id === transactionId);
        if (!transaction) return;
        // Payroll deductions are edited through their paycheck entry so the two stay in sync
        if (transaction.paycheckManaged) {
            const owner = ledgerData.paychecks.find(p => p.linkedTransactionId === transaction.id);
            if (owner) return openPaycheckModal(owner.id);
        }
        document.getElementById('transactionModalTitle').textContent = 'Edit Transaction';
        document.getElementById('transactionId').value = transaction.id;
        document.getElementById('transactionDate').value = transaction.date;
        document.getElementById('transactionMonth').value = transaction.month;
        document.getElementById('transactionAmount').value = transaction.amount;
        document.getElementById('transactionDescription').value = transaction.description;
        document.getElementById('deleteTransactionBtn').style.display = 'block';

        populateAccountSelects();
        document.getElementById('transactionAccount').value = transaction.accountId;

        populateEnvelopeSelect();
        document.getElementById('transactionEnvelope').value = transaction.envelope || '';
    } else {
        document.getElementById('transactionModalTitle').textContent = 'Add Transaction';
        document.getElementById('transactionId').value = '';
        document.getElementById('transactionForm').reset();
        setTodayDate();
        document.getElementById('deleteTransactionBtn').style.display = 'none';
        populateAccountSelects();
        populateEnvelopeSelect();
    }

    document.getElementById('transactionModal').classList.add('active');
    setTimeout(() => document.getElementById('transactionDate').focus(), 100);
}

function closeTransactionModal() {
    document.getElementById('transactionModal').classList.remove('active');
}

function populateEnvelopeSelect() {
    const select = document.getElementById('transactionEnvelope');
    const envs = Object.keys(ledgerData.envelopes).sort();
    select.innerHTML = '<option value="">— No envelope —</option>';
    envs.forEach(env => {
        const opt = document.createElement('option');
        opt.value = env;
        opt.textContent = env;
        select.appendChild(opt);
    });
}

function saveTransaction() {
    const id = document.getElementById('transactionId').value;
    const date = document.getElementById('transactionDate').value;
    const month = parseInt(document.getElementById('transactionMonth').value);
    const accountId = document.getElementById('transactionAccount').value;
    const amount = parseFloat(document.getElementById('transactionAmount').value);
    const description = document.getElementById('transactionDescription').value.trim();
    const envelope = document.getElementById('transactionEnvelope').value;

    if (!date || !month || !accountId || !description || isNaN(amount)) return showMessage('Please fill in all required fields', 'error');

    if (id) {
        const transaction = ledgerData.transactions.find(t => t.id === id);
        if (transaction) Object.assign(transaction, { date, month, accountId, amount, description, envelope });
    } else {
        ledgerData.transactions.push({ id: Ledger.newId(), date, month, accountId, amount, description, envelope });
    }

    markUnsaved();
    updateUI();
    closeTransactionModal();
    showMessage(id ? 'Transaction updated successfully!' : 'Transaction added successfully!');
}

// Deletes transactions by id. Deleting a payroll deduction's transaction also
// deletes its paycheck entry, which would otherwise keep adding to the balance.
function deleteTransactions(ids) {
    ledgerData.paychecks
        .filter(p => p.linkedTransactionId && ids.has(p.linkedTransactionId))
        .map(p => p.id)
        .forEach(paycheckDeleteAndCleanup);
    ledgerData.transactions = ledgerData.transactions.filter(t => !ids.has(t.id));
}

function openTransferModal() {
    if (ledgerData.accounts.length < 2) return showMessage('Please add at least two accounts first', 'error');
    document.getElementById('transferModal').classList.add('active');
    populateTransferSelects();
    setTimeout(() => document.getElementById('transferDate').focus(), 100);
}

function closeTransferModal() {
    document.getElementById('transferModal').classList.remove('active');
}

function addTransfer() {
    const date = document.getElementById('transferDate').value;
    const month = parseInt(document.getElementById('transferMonth').value);
    const fromId = document.getElementById('transferFrom').value;
    const toId = document.getElementById('transferTo').value;
    const amount = parseFloat(document.getElementById('transferAmount').value);
    const description = document.getElementById('transferDescription').value.trim();

    if (!date || !month || !fromId || !toId || !description || !(amount > 0)) return showMessage('Please fill in all fields correctly', 'error');
    if (fromId === toId) return showMessage('Source and destination accounts must be different', 'error');

    const id = Ledger.newId();
    const envelope = Ledger.TRANSFER_ENVELOPE;
    ledgerData.transactions.push({ id: id + '-from', date, month, accountId: fromId, amount: -amount, description: description + ' (Transfer Out)', envelope });
    ledgerData.transactions.push({ id: id + '-to', date, month, accountId: toId, amount: amount, description: description + ' (Transfer In)', envelope });

    markUnsaved();
    updateUI();
    closeTransferModal();
    document.getElementById('transferForm').reset();
    setTodayDate();
    showMessage('Transfer added successfully!');
}

function updateTransactionsTable() {
    const tbody = document.getElementById('transactionsBody');
    const filt = getMonthTransactions();

    if (filt.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">💸</div><div class="empty-state-title">No transactions for this month</div><p>Add transactions or select a different month</p></div></td></tr>`;
        selectedItems.transactions.clear();
        updateSelectionUI('transactions');
        return;
    }

    const accountName = id => { const a = ledgerData.accounts.find(x => x.id === id); return a ? a.name : ''; };
    let sorted = [...filt];
    if (sortState.table === 'transactions') {
        const key = {
            date: t => t.date,
            month: t => t.month,
            account: t => accountName(t.accountId).toLowerCase(),
            description: t => (t.description || '').toLowerCase(),
            envelope: t => (t.envelope || '').toLowerCase(),
            amount: t => t.amount
        }[sortState.column] || (t => t.date);
        sorted.sort((a, b) => compareValues(key(a), key(b)));
    } else {
        sorted.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }

    tbody.innerHTML = sorted.map((t, idx) => {
        const checked = selectedItems.transactions.has(t.id) ? 'checked' : '';
        return `<tr onclick="handleRowClick('transactions',${jsArg(t.id)},${idx},event)">
            <td><input type="checkbox" ${checked} data-id="${escapeHtml(t.id)}"></td>
            <td class="date">${t.date ? formatDate(t.date) : '—'}</td>
            <td>${getMonthName(t.month)}</td>
            <td>${escapeHtml(accountName(t.accountId) || 'Unknown')}</td>
            <td>${escapeHtml(t.description)}</td>
            <td>${t.envelope ? envelopeTag(t.envelope) : '—'}</td>
            <td class="amount ${t.amount >= 0 ? 'positive' : 'negative'}">${formatCurrency(t.amount)}</td>
        </tr>`;
    }).join('');

    updateSelectionUI('transactions');
}
