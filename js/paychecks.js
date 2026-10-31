// ─── Paychecks ────────────────────────────────────────────────────────────────

function updatePaychecksTab() {
    const tbody = document.getElementById('paychecksBody');
    if (!tbody) return;
    const paychecks = ledgerData.paychecks || [];
    const filtered = selectedMonth
        ? paychecks.filter(p => p.month === selectedMonth)
        : paychecks;

    if (filtered.length === 0) {
        const msg = selectedMonth ? 'No paycheck entries for this month' : 'No paycheck entries yet';
        const desc = selectedMonth ? 'Add entries or select a different month' : 'Add your first paycheck entry to start tracking';
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">💰</div><div class="empty-state-title">${msg}</div><p>${desc}</p></div></td></tr>`;
        selectedItems.paychecks.clear();
        updateSelectionUI('paychecks');
        return;
    }

    let sorted = [...filtered];
    if (sortState.table === 'paychecks') {
        sorted.sort((a, b) => {
            let vA, vB;
            if (sortState.column === 'date') { vA = a.date || ''; vB = b.date || ''; }
            else if (sortState.column === 'month') { vA = a.month; vB = b.month; }
            else if (sortState.column === 'account') {
                const accA = ledgerData.accounts.find(x => x.id === a.accountId);
                const accB = ledgerData.accounts.find(x => x.id === b.accountId);
                vA = accA ? accA.name.toLowerCase() : '';
                vB = accB ? accB.name.toLowerCase() : '';
            } else { vA = a.amount; vB = b.amount; }
            return sortState.direction === 'asc' ? (vA > vB ? 1 : -1) : (vA < vB ? 1 : -1);
        });
    } else {
        sorted.sort((a, b) => {
            if (a.month !== b.month) return a.month - b.month;
            if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
            return a.amount > 0 ? -1 : 1;
        });
    }

    tbody.innerHTML = sorted.map((p, idx) => {
        const acc = ledgerData.accounts.find(x => x.id === p.accountId);
        const accName = acc ? escapeHtml(acc.name) : 'Unknown';
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][p.month - 1] || '';
        const dateDisplay = p.date ? formatDate(p.date) : '—';
        const checked = selectedItems.paychecks.has(p.id) ? 'checked' : '';
        let details = '';
        if (p.amount > 0) {
            const grossStr = p.gross != null ? formatCurrency(p.gross) : '—';
            const typeLabel = p.tithingType === 'tithing' ? 'Tithing' : 'Non-Tithing';
            details = `Gross: ${grossStr} · ${typeLabel}`;
        } else {
            details = p.envelope ? `<span class="envelope-tag" style="background-color:${getEnvelopeColor(p.envelope)}20;color:${getEnvelopeColor(p.envelope)};">${escapeHtml(p.envelope)}</span>` : '—';
        }
        return `<tr onclick="handleRowClick('paychecks','${p.id}',${idx},event)">
            <td><input type="checkbox" ${checked} data-id="${p.id}"></td>
            <td class="date">${dateDisplay}</td>
            <td>${monthName}</td>
            <td>${accName}</td>
            <td class="amount ${p.amount >= 0 ? 'positive' : 'negative'}">${formatCurrency(p.amount)}</td>
            <td>${details}</td>
        </tr>`;
    }).join('');

    updateSelectionUI('paychecks');
}

function getEnvelopeColor(name) {
    return (ledgerData.envelopes[name] && ledgerData.envelopes[name].color) || '#2D5F3F';
}

function openPaycheckModal(paycheckId = null) {
    if (ledgerData.accounts.length === 0) return showMessage('Please add an account first', 'error');

    // Populate account select
    const accountOpts = '<option value="">Select account...</option>' +
        ledgerData.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    document.getElementById('paycheckAccount').innerHTML = accountOpts;

    // Populate envelope select
    const envOpts = '<option value="">Select envelope...</option>' +
        Object.keys(ledgerData.envelopes || {}).sort().map(e => `<option value="${e}">${escapeHtml(e)}</option>`).join('');
    document.getElementById('paycheckEnvelope').innerHTML = envOpts;

    if (paycheckId) {
        const p = (ledgerData.paychecks || []).find(x => x.id === paycheckId);
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
        // Set today's date
        document.getElementById('paycheckDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('paycheckAmountLabel').textContent = 'Net Amount';
        document.getElementById('paycheckAmountHint').textContent = 'The take-home (net) pay amount. For deductions, switch type above.';
        document.getElementById('deletePaycheckBtn').style.display = 'none';
        document.getElementById('paycheckPositiveFields').style.display = 'block';
        document.getElementById('paycheckNegativeFields').style.display = 'none';
        document.getElementById('paycheckTypeToggleGroup').style.display = 'block';
        document.getElementById('paycheckTypeIncome').classList.add('active');
        document.getElementById('paycheckTypeDeduction').classList.remove('active');
        if (selectedMonth) document.getElementById('paycheckMonth').value = selectedMonth;
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

    if (!ledgerData.paychecks) ledgerData.paychecks = [];

    if (sign === 'negative') {
        const envelope = document.getElementById('paycheckEnvelope').value;
        if (!envelope) return showMessage('Please select an envelope for this deduction', 'error');

        if (id) {
            const p = ledgerData.paychecks.find(x => x.id === id);
            if (p) {
                p.date = date; p.month = month; p.accountId = accountId; p.amount = amount; p.envelope = envelope;
                paycheckUpdateLinkedTransaction(p);
            }
        } else {
            const newId = Date.now().toString();
            const txId = paycheckCreateLinkedTransaction(newId, month, accountId, amount, envelope, date);
            ledgerData.paychecks.push({ id: newId, date, month, accountId, amount, envelope, linkedTransactionId: txId });
        }
    } else {
        const gross = parseFloat(document.getElementById('paycheckGross').value) || null;
        const tithingType = document.getElementById('paycheckTithingType').value;

        if (id) {
            const p = ledgerData.paychecks.find(x => x.id === id);
            if (p) { p.date = date; p.month = month; p.accountId = accountId; p.amount = amount; p.gross = gross; p.tithingType = tithingType; }
        } else {
            ledgerData.paychecks.push({ id: Date.now().toString(), date, month, accountId, amount, gross, tithingType });
        }
    }

    markUnsaved();
    updateUI();
    closePaycheckModal();
    showMessage(id ? 'Paycheck entry updated!' : 'Paycheck entry added!');
}

// Create a linked transaction for a negative paycheck entry. Returns the transaction id.
function paycheckCreateLinkedTransaction(paycheckId, month, accountId, amount, envelope, date) {
    const txId = 'paycheck-tx-' + paycheckId;
    const year = new Date().getFullYear();
    const dateStr = date || `${year}-${String(month).padStart(2,'0')}-01`;
    ledgerData.transactions.push({
        id: txId,
        date: dateStr,
        month,
        accountId,
        amount,  // negative
        description: `Paycheck deduction`,
        envelope,
        paycheckManaged: true
    });
    return txId;
}

// Update the linked transaction when a negative paycheck entry is edited.
function paycheckUpdateLinkedTransaction(paycheckEntry) {
    const txId = paycheckEntry.linkedTransactionId;
    if (!txId) return;
    const tx = ledgerData.transactions.find(t => t.id === txId);
    if (tx) {
        tx.date = paycheckEntry.date || tx.date;
        tx.month = paycheckEntry.month;
        tx.accountId = paycheckEntry.accountId;
        tx.amount = paycheckEntry.amount;
        tx.envelope = paycheckEntry.envelope;
    }
}

// Delete a paycheck entry and its linked transaction (if any).
function paycheckDeleteAndCleanup(paycheckId) {
    const p = (ledgerData.paychecks || []).find(x => x.id === paycheckId);
    if (p && p.linkedTransactionId) {
        ledgerData.transactions = ledgerData.transactions.filter(t => t.id !== p.linkedTransactionId);
    }
    ledgerData.paychecks = (ledgerData.paychecks || []).filter(x => x.id !== paycheckId);
}

function confirmDeletePaycheck() {
    const id = document.getElementById('paycheckId').value;
    if (!id) return;
    const p = (ledgerData.paychecks || []).find(x => x.id === id);
    const isNeg = p && p.amount < 0;
    pendingAction = { type: 'deletePaycheck', id };
    document.getElementById('confirmModalTitle').textContent = 'Delete Paycheck Entry';
    document.getElementById('confirmModalBody').innerHTML = isNeg
        ? '<p>Are you sure? This will also delete the linked transaction.</p>'
        : '<p>Are you sure you want to delete this paycheck entry?</p>';
    document.getElementById('confirmActionBtn').textContent = 'Delete';
    document.getElementById('confirmActionBtn').className = 'danger';
    document.getElementById('confirmModal').classList.add('active');
}
