// ─── Paychecks ────────────────────────────────────────────────────────────────

function updatePaychecksTab() {
    const tbody = document.getElementById('paychecksBody');
    const filtered = ledgerData.paychecks.filter(p => p.month === selectedMonth);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">💰</div><div class="empty-state-title">No paycheck entries for this month</div><p>Add entries or select a different month</p></div></td></tr>`;
        selectedItems.paychecks.clear();
        updateSelectionUI('paychecks');
        return;
    }

    const accountName = id => { const a = ledgerData.accounts.find(x => x.id === id); return a ? a.name : ''; };
    let sorted = [...filtered];
    if (sortState.table === 'paychecks') {
        const key = {
            date: p => p.date || '',
            month: p => p.month,
            account: p => accountName(p.accountId).toLowerCase()
        }[sortState.column] || (p => p.amount);
        sorted.sort((a, b) => compareValues(key(a), key(b)));
    } else {
        sorted.sort((a, b) => {
            if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
            return a.amount > 0 ? -1 : 1;
        });
    }

    tbody.innerHTML = sorted.map((p, idx) => {
        const checked = selectedItems.paychecks.has(p.id) ? 'checked' : '';
        let details;
        if (p.amount > 0) {
            const grossStr = p.gross != null ? formatCurrency(p.gross) : '—';
            const typeLabel = p.tithingType === 'tithing' ? 'Tithing' : 'Non-Tithing';
            details = `Gross: ${grossStr} · ${typeLabel}`;
        } else {
            details = p.envelope ? envelopeTag(p.envelope) : '—';
        }
        return `<tr onclick="handleRowClick('paychecks',${jsArg(p.id)},${idx},event)">
            <td><input type="checkbox" ${checked} data-id="${escapeHtml(p.id)}"></td>
            <td class="date">${p.date ? formatDate(p.date) : '—'}</td>
            <td>${getMonthName(p.month)}</td>
            <td>${escapeHtml(accountName(p.accountId) || 'Unknown')}</td>
            <td class="amount ${p.amount >= 0 ? 'positive' : 'negative'}">${formatCurrency(p.amount)}</td>
            <td>${details}</td>
        </tr>`;
    }).join('');

    updateSelectionUI('paychecks');
}

function openPaycheckModal(paycheckId = null) {
    if (ledgerData.accounts.length === 0) return showMessage('Please add an account first', 'error');

    // Populate account select
    document.getElementById('paycheckAccount').innerHTML = accountOptions('Select account...');

    // Populate envelope select
    const envOpts = '<option value="">Select envelope...</option>' +
        Ledger.envelopeNames(ledgerData).sort().map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
    document.getElementById('paycheckEnvelope').innerHTML = envOpts;

    if (paycheckId) {
        const p = ledgerData.paychecks.find(x => x.id === paycheckId);
        if (p) {
            const isPositive = p.amount >= 0;
            document.getElementById('paycheckModalTitle').textContent = isPositive ? 'Edit Income Entry' : 'Edit Deduction Entry';
            document.getElementById('paycheckId').value = p.id;
            document.getElementById('paycheckSign').value = isPositive ? 'positive' : 'negative';
            document.getElementById('paycheckDate').value = p.date || '';
            document.getElementById('paycheckMonth').value = p.month;
            document.getElementById('paycheckAccount').value = p.accountId;
            document.getElementById('paycheckAmount').value = Math.abs(p.amount);
            document.getElementById('paycheckAmountLabel').textContent = isPositive ? 'Net Amount' : 'Deduction Amount';
            document.getElementById('paycheckAmountHint').textContent = isPositive ? 'The take-home (net) pay amount.' : 'Enter as a positive number.';
            document.getElementById('deletePaycheckBtn').style.display = 'block';
            // Hide type toggle when editing — sign is locked
            document.getElementById('paycheckTypeToggleGroup').style.display = 'none';

            if (isPositive) {
                document.getElementById('paycheckGross').value = p.gross != null ? p.gross : '';
                document.getElementById('paycheckTithingType').value = p.tithingType || 'tithing';
                document.getElementById('paycheckPositiveFields').style.display = 'block';
                document.getElementById('paycheckNegativeFields').style.display = 'none';
            } else {
                document.getElementById('paycheckEnvelope').value = p.envelope || '';
                document.getElementById('paycheckPositiveFields').style.display = 'none';
                document.getElementById('paycheckNegativeFields').style.display = 'block';
            }
        }
    } else {
        document.getElementById('paycheckModalTitle').textContent = 'Add Income Entry';
        document.getElementById('paycheckId').value = '';
        document.getElementById('paycheckSign').value = 'positive';
        document.getElementById('paycheckForm').reset();
        document.getElementById('paycheckSign').value = 'positive'; // reset() clears hidden fields
        document.getElementById('paycheckDate').value = defaultEntryDate();
        document.getElementById('paycheckAmountLabel').textContent = 'Net Amount';
        document.getElementById('paycheckAmountHint').textContent = 'The take-home (net) pay amount. For deductions, switch type above.';
        document.getElementById('deletePaycheckBtn').style.display = 'none';
        document.getElementById('paycheckPositiveFields').style.display = 'block';
        document.getElementById('paycheckNegativeFields').style.display = 'none';
        document.getElementById('paycheckTypeToggleGroup').style.display = 'block';
        document.getElementById('paycheckTypeIncome').classList.add('active');
        document.getElementById('paycheckTypeDeduction').classList.remove('active');
        document.getElementById('paycheckMonth').value = selectedMonth;
    }

    document.getElementById('paycheckModal').classList.add('active');
    setTimeout(() => document.getElementById('paycheckDate').focus(), 100);
}

function switchPaycheckType(type) {
    document.getElementById('paycheckSign').value = type;
    document.getElementById('paycheckTypeIncome').classList.toggle('active', type === 'positive');
    document.getElementById('paycheckTypeDeduction').classList.toggle('active', type === 'negative');
    if (type === 'positive') {
        document.getElementById('paycheckModalTitle').textContent = 'Add Income Entry';
        document.getElementById('paycheckAmountLabel').textContent = 'Net Amount';
        document.getElementById('paycheckAmountHint').textContent = 'The take-home (net) pay amount.';
        document.getElementById('paycheckPositiveFields').style.display = 'block';
        document.getElementById('paycheckNegativeFields').style.display = 'none';
    } else {
        document.getElementById('paycheckModalTitle').textContent = 'Add Deduction Entry';
        document.getElementById('paycheckAmountLabel').textContent = 'Deduction Amount';
        document.getElementById('paycheckAmountHint').textContent = 'Enter as a positive number; will be stored as negative.';
        document.getElementById('paycheckPositiveFields').style.display = 'none';
        document.getElementById('paycheckNegativeFields').style.display = 'block';
    }
}

function closePaycheckModal() {
    document.getElementById('paycheckModal').classList.remove('active');
}

function savePaycheck() {
    const id = document.getElementById('paycheckId').value;
    const sign = document.getElementById('paycheckSign').value;
    const date = document.getElementById('paycheckDate').value;
    const month = parseInt(document.getElementById('paycheckMonth').value);
    const accountId = document.getElementById('paycheckAccount').value;
    const absAmount = parseFloat(document.getElementById('paycheckAmount').value);

    if (!date || !month || !accountId || isNaN(absAmount) || absAmount <= 0) {
        return showMessage('Please fill in all required fields with valid values', 'error');
    }

    const amount = sign === 'negative' ? -absAmount : absAmount;

    if (sign === 'negative') {
        const envelope = document.getElementById('paycheckEnvelope').value;
        if (!envelope) return showMessage('Please select an envelope for this deduction', 'error');

        if (id) {
            const p = ledgerData.paychecks.find(x => x.id === id);
            if (p) {
                Object.assign(p, { date, month, accountId, amount, envelope });
                paycheckUpdateLinkedTransaction(p);
            }
        } else {
            addPaycheckEntry({ date, month, accountId, amount, envelope });
        }
    } else {
        const gross = parseFloat(document.getElementById('paycheckGross').value) || null;
        const tithingType = document.getElementById('paycheckTithingType').value;

        if (id) {
            const p = ledgerData.paychecks.find(x => x.id === id);
            if (p) Object.assign(p, { date, month, accountId, amount, gross, tithingType });
        } else {
            addPaycheckEntry({ date, month, accountId, amount, gross, tithingType });
        }
    }

    markUnsaved();
    updateUI();
    closePaycheckModal();
    showMessage(id ? 'Paycheck entry updated!' : 'Paycheck entry added!');
}

// Adds a paycheck entry. A deduction (negative amount) also gets a linked
// transaction that spends it from its envelope.
function addPaycheckEntry({ date, month, accountId, amount, gross = null, tithingType = 'tithing', envelope = '' }) {
    const entry = { id: Ledger.newId(), date: date || Ledger.defaultDate(ledgerData.year, month), month, accountId, amount };
    if (amount < 0) {
        entry.envelope = envelope;
        entry.linkedTransactionId = 'paycheck-tx-' + entry.id;
        ledgerData.transactions.push({ id: entry.linkedTransactionId, paycheckManaged: true, description: 'Paycheck deduction' });
        paycheckUpdateLinkedTransaction(entry);
    } else {
        Object.assign(entry, { gross, tithingType });
    }
    ledgerData.paychecks.push(entry);
    return entry;
}

// Copies a deduction entry onto its linked transaction, recreating the
// transaction if it has gone missing.
function paycheckUpdateLinkedTransaction(entry) {
    if (!entry.linkedTransactionId) entry.linkedTransactionId = 'paycheck-tx-' + entry.id;
    let tx = ledgerData.transactions.find(t => t.id === entry.linkedTransactionId);
    if (!tx) {
        tx = { id: entry.linkedTransactionId, paycheckManaged: true, description: 'Paycheck deduction' };
        ledgerData.transactions.push(tx);
    }
    Object.assign(tx, { date: entry.date, month: entry.month, accountId: entry.accountId, amount: entry.amount, envelope: entry.envelope });
}

// Delete a paycheck entry and its linked transaction (if any).
function paycheckDeleteAndCleanup(paycheckId) {
    const p = ledgerData.paychecks.find(x => x.id === paycheckId);
    if (p && p.linkedTransactionId) {
        ledgerData.transactions = ledgerData.transactions.filter(t => t.id !== p.linkedTransactionId);
    }
    ledgerData.paychecks = ledgerData.paychecks.filter(x => x.id !== paycheckId);
}

function confirmDeletePaycheck() {
    const id = document.getElementById('paycheckId').value;
    if (!id) return;
    const p = ledgerData.paychecks.find(x => x.id === id);
    const isNeg = p && p.amount < 0;
    showConfirm({ type: 'deletePaycheck', id }, 'Delete Paycheck Entry', isNeg
        ? '<p>Are you sure? This will also delete the linked transaction.</p>'
        : '<p>Are you sure you want to delete this paycheck entry?</p>', 'Delete');
}
