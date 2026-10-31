function openTransactionModal(transactionId = null) {
    if (ledgerData.accounts.length === 0) return showMessage('Please add an account first', 'error');
    
    if (transactionId) {
        const transaction = ledgerData.transactions.find(t => t.id === transactionId);
        if (transaction) {
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
        }
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
    const envs = Object.keys(ledgerData.envelopes || {}).sort();
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

    if (!date || !month || !accountId || !description) return showMessage('Please fill in all required fields', 'error');

    if (id) {
        const transaction = ledgerData.transactions.find(t => t.id === id);
        if (transaction) {
            transaction.date = date;
            transaction.month = month;
            transaction.accountId = accountId;
            transaction.amount = amount;
            transaction.description = description;
            transaction.envelope = envelope;
        }
    } else {
        ledgerData.transactions.push({ id: Date.now().toString(), date, month, accountId, amount, description, envelope });
    }

    markUnsaved();
    updateUI();
    closeTransactionModal();
    showMessage(id ? 'Transaction updated successfully!' : 'Transaction added successfully!');
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

    if (!date || !month || !fromId || !toId || !description || amount <= 0) return showMessage('Please fill in all fields correctly', 'error');
    if (fromId === toId) return showMessage('Source and destination accounts must be different', 'error');

    const ts = Date.now().toString();
    ledgerData.transactions.push({ id: ts + '-from', date, month, accountId: fromId, amount: -amount, description: description + ' (Transfer Out)', envelope: 'Transfer' });
    ledgerData.transactions.push({ id: ts + '-to', date, month, accountId: toId, amount: amount, description: description + ' (Transfer In)', envelope: 'Transfer' });

    markUnsaved();
    updateUI();
    closeTransferModal();
    document.getElementById('transferForm').reset();
    setTodayDate();
    showMessage('Transfer added successfully!');
}


function updateTransactionsTable() {
    const tbody = document.getElementById('transactionsBody');
    const filt = getFilteredTransactions();
    
    if (filt.length === 0) {
        const msg = selectedMonth ? 'No transactions for this month' : 'No transactions yet';
        const desc = selectedMonth ? 'Add transactions or select a different month' : 'Add your first transaction to start tracking';
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">💸</div><div class="empty-state-title">${msg}</div><p>${desc}</p></div></td></tr>`;
        selectedItems.transactions.clear();
        updateSelectionUI('transactions');
        return;
    }

    let sorted = [...filt];
    if (sortState.table === 'transactions') {
        sorted.sort((a, b) => {
            let valA, valB;
            switch(sortState.column) {
                case 'date': valA = a.date; valB = b.date; break;
                case 'month': valA = a.month; valB = b.month; break;
                case 'account':
                    const accA = ledgerData.accounts.find(x => x.id === a.accountId);
                    const accB = ledgerData.accounts.find(x => x.id === b.accountId);
                    valA = accA ? accA.name.toLowerCase() : '';
                    valB = accB ? accB.name.toLowerCase() : '';
                    break;
                case 'description': valA = a.description.toLowerCase(); valB = b.description.toLowerCase(); break;
                case 'envelope': valA = (a.envelope || '').toLowerCase(); valB = (b.envelope || '').toLowerCase(); break;
                case 'amount': valA = a.amount; valB = b.amount; break;
                default: valA = a.date; valB = b.date;
            }
            return sortState.direction === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
        });
    } else {
        sorted.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    tbody.innerHTML = sorted.map((t, idx) => {
        const a = ledgerData.accounts.find(x => x.id === t.accountId);
        const color = t.envelope && ledgerData.envelopes[t.envelope] ? ledgerData.envelopes[t.envelope].color : '#2D5F3F';
        const checked = selectedItems.transactions.has(t.id) ? 'checked' : '';
        return `<tr onclick="handleRowClick('transactions','${t.id}',${idx},event)">
            <td><input type="checkbox" ${checked} data-id="${t.id}"></td>
            <td class="date">${formatDate(t.date)}</td>
            <td>${getMonthName(t.month)}</td>
            <td>${a ? escapeHtml(a.name) : 'Unknown'}</td>
            <td>${escapeHtml(t.description)}</td>
            <td>${t.envelope ? `<span class="envelope-tag" style="background-color:${color}20;color:${color};">${escapeHtml(t.envelope)}</span>` : '—'}</td>
            <td class="amount ${t.amount >= 0 ? 'positive' : 'negative'}">${formatCurrency(t.amount)}</td>
        </tr>`;
    }).join('');

    updateSelectionUI('transactions');
}

// ─── Envelope Calculations ────────────────────────────────────────────────────

// Get the effective funding for an envelope in a given month.
// If there's no explicit entry for that month, walk back to the most recent prior month.
// If none found, default to 0.
