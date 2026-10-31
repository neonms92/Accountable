// ─── Statements ──────────────────────────────────────────────────────────────

function getStatementKey(accountId, month) {
    return `${accountId}::${month}`;
}

function isStatementsComplete(month) {
    if (!month) return true;
    const accountIds = ledgerData.accounts.map(a => a.id);
    if (accountIds.length === 0) return true;
    return accountIds.every(id => {
        return (ledgerData.statements || []).some(s => s.accountId === id && s.month === month);
    });
}

function updateTabIncompleteIndicators() {
    // Statements: incomplete when a month is selected and not all accounts have a statement
    const statementsBtn = document.querySelector('.tab[onclick="switchTab(\'statements\')"]');
    if (statementsBtn) {
        const incomplete = selectedMonth && ledgerData.accounts.length > 0 && !isStatementsComplete(selectedMonth);
        statementsBtn.classList.toggle('tab-incomplete', !!incomplete);
    }

    // Envelopes: incomplete when any envelope has a negative total in the current view
    const envelopesBtn = document.querySelector('.tab[onclick="switchTab(\'envelopes\')"]');
    if (envelopesBtn) {
        const envNames = Object.keys(ledgerData.envelopes || {}).filter(n => n !== 'Transfer');
        const checkMonth = selectedMonth;
        const anyNegative = envNames.some(name => {
            const total = calculateEnvelopeTotal(name, checkMonth === null ? 12 : checkMonth);
            return total < -0.005;
        });
        envelopesBtn.classList.toggle('tab-incomplete', envNames.length > 0 && anyNegative);
    }

    // Paychecks: incomplete when for any account, net positive != gross positive - total negatives
    const paychecksBtn = document.querySelector('.tab[onclick="switchTab(\'paychecks\')"]');
    if (paychecksBtn) {
        paychecksBtn.classList.toggle('tab-incomplete', !isPaychecksComplete());
    }
}

function isPaychecksComplete() {
    const paychecks = ledgerData.paychecks || [];
    if (paychecks.length === 0) return true;
    // Check per account (and month if selected)
    const relevantPaychecks = selectedMonth
        ? paychecks.filter(p => p.month === selectedMonth)
        : paychecks;
    if (relevantPaychecks.length === 0) return true;

    const positiveEntries = relevantPaychecks.filter(p => p.amount > 0);
    const negativeEntries = relevantPaychecks.filter(p => p.amount < 0);
    if (positiveEntries.length === 0) return true; // no income entries, nothing to validate
    const totalNet = positiveEntries.reduce((s, p) => s + p.amount, 0);
    const totalGross = positiveEntries.reduce((s, p) => s + (p.gross || p.amount), 0);
    const totalDeductions = negativeEntries.reduce((s, p) => s + Math.abs(p.amount), 0);
    const expectedNet = totalGross - totalDeductions;
    return Math.abs(totalNet - expectedNet) < 0.005;
}

function updateStatementsTab() {
    const tbody = document.getElementById('statementsBody');
    if (!tbody) return;

    const stmts = selectedMonth
        ? (ledgerData.statements || []).filter(s => s.month === selectedMonth)
        : (ledgerData.statements || []);

    if (stmts.length === 0) {
        const msg = selectedMonth ? 'No statements for this month' : 'No statements yet';
        const desc = selectedMonth ? 'Add a statement for each account to mark the month complete' : 'Add your first statement to start tracking';
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">🧾</div><div class="empty-state-title">${msg}</div><p>${desc}</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = stmts.map(s => {
        const account = ledgerData.accounts.find(a => a.id === s.accountId);
        const accountName = account ? escapeHtml(account.name) : 'Unknown';
        const expected = s.startBalance + s.deposits - s.withdrawals;
        const diff = Math.abs(expected - s.endBalance);
        const ok = diff < 0.005;
        const statusHtml = ok
            ? `<span class="stmt-status ok" title="Balances check out">✓</span>`
            : `<span class="stmt-status warn" title="Expected ending balance: ${formatCurrency(expected)} (diff: ${formatCurrency(diff)})">!</span>`;
        return `<tr onclick="openStatementModal('${s.id}')">
            <td>${accountName}</td>
            <td class="amount">${formatCurrency(s.startBalance)}</td>
            <td class="amount">${formatCurrency(s.endBalance)}</td>
            <td class="amount positive">${formatCurrency(s.deposits)}</td>
            <td class="amount negative">-${formatCurrency(s.withdrawals)}</td>
            <td class="date">${s.startDate ? formatDate(s.startDate) : '—'} – ${s.endDate ? formatDate(s.endDate) : '—'}</td>
            <td style="text-align:center;">${statusHtml}</td>
        </tr>`;
    }).join('');
}

function openStatementModal(statementId = null) {
    if (ledgerData.accounts.length === 0) return showMessage('Please add an account first', 'error');

    // Populate account select
    document.getElementById('statementAccount').innerHTML =
        '<option value="">Select account...</option>' +
        ledgerData.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');

    if (statementId) {
        const s = (ledgerData.statements || []).find(x => x.id === statementId);
        if (s) {
            document.getElementById('statementModalTitle').textContent = 'Edit Statement';
            document.getElementById('statementId').value = s.id;
            document.getElementById('statementAccount').value = s.accountId;
            document.getElementById('statementMonth').value = s.month;
            document.getElementById('statementStartDate').value = s.startDate || '';
            document.getElementById('statementEndDate').value = s.endDate || '';
            document.getElementById('statementStartBalance').value = s.startBalance;
            document.getElementById('statementEndBalance').value = s.endBalance;
            document.getElementById('statementDeposits').value = s.deposits;
            document.getElementById('statementWithdrawals').value = s.withdrawals;
            document.getElementById('deleteStatementBtn').style.display = 'block';
            updateStatementSanityCheck();
        }
    } else {
        document.getElementById('statementModalTitle').textContent = 'Add Statement';
        document.getElementById('statementId').value = '';
        document.getElementById('statementForm').reset();
        document.getElementById('deleteStatementBtn').style.display = 'none';
        document.getElementById('statementSanityCheck').style.display = 'none';
        if (selectedMonth) document.getElementById('statementMonth').value = selectedMonth;
    }

    document.getElementById('statementModal').classList.add('active');
    setTimeout(() => document.getElementById('statementAccount').focus(), 100);

    // Live sanity check
    ['statementStartBalance','statementEndBalance','statementDeposits','statementWithdrawals'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateStatementSanityCheck);
    });
}

function updateStatementSanityCheck() {
    const start = parseFloat(document.getElementById('statementStartBalance').value) || 0;
    const end = parseFloat(document.getElementById('statementEndBalance').value) || 0;
    const dep = parseFloat(document.getElementById('statementDeposits').value) || 0;
    const wit = parseFloat(document.getElementById('statementWithdrawals').value) || 0;
    const expected = start + dep - wit;
    const diff = Math.abs(expected - end);
    const box = document.getElementById('statementSanityCheck');
    if (dep === 0 && wit === 0 && start === 0 && end === 0) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    if (diff < 0.005) {
        box.className = 'statement-sanity ok';
        box.textContent = '✓ Balances check out: ' + formatCurrency(start) + ' + ' + formatCurrency(dep) + ' – ' + formatCurrency(wit) + ' = ' + formatCurrency(expected);
    } else {
        box.className = 'statement-sanity warn';
        box.textContent = '⚠ Expected ending balance: ' + formatCurrency(expected) + ' (entered: ' + formatCurrency(end) + ', diff: ' + formatCurrency(diff) + ')';
    }
}

function closeStatementModal() {
    document.getElementById('statementModal').classList.remove('active');
}

function saveStatement() {
    const id = document.getElementById('statementId').value;
    const accountId = document.getElementById('statementAccount').value;
    const month = parseInt(document.getElementById('statementMonth').value);
    const startDate = document.getElementById('statementStartDate').value;
    const endDate = document.getElementById('statementEndDate').value;
    const startBalance = parseFloat(document.getElementById('statementStartBalance').value);
    const endBalance = parseFloat(document.getElementById('statementEndBalance').value);
    const deposits = parseFloat(document.getElementById('statementDeposits').value);
    const withdrawals = parseFloat(document.getElementById('statementWithdrawals').value);

    if (!accountId || !month || !startDate || !endDate || isNaN(startBalance) || isNaN(endBalance) || isNaN(deposits) || isNaN(withdrawals)) {
        return showMessage('Please fill in all required fields', 'error');
    }

    if (!ledgerData.statements) ledgerData.statements = [];

    // Check for duplicate (same account + month), excluding self
    const duplicate = ledgerData.statements.find(s => s.accountId === accountId && s.month === month && s.id !== id);
    if (duplicate) return showMessage('A statement already exists for this account and month', 'error');

    if (id) {
        const s = ledgerData.statements.find(x => x.id === id);
        if (s) Object.assign(s, { accountId, month, startDate, endDate, startBalance, endBalance, deposits, withdrawals });
    } else {
        ledgerData.statements.push({ id: Date.now().toString(), accountId, month, startDate, endDate, startBalance, endBalance, deposits, withdrawals });
    }

    markUnsaved();
    updateUI();
    closeStatementModal();
    showMessage(id ? 'Statement updated!' : 'Statement added!');
}

function confirmDeleteStatement() {
    const id = document.getElementById('statementId').value;
    if (!id) return;
    pendingAction = { type: 'deleteStatement', id };
    document.getElementById('confirmModalTitle').textContent = 'Delete Statement';
    document.getElementById('confirmModalBody').innerHTML = '<p>Are you sure you want to delete this statement?</p>';
    document.getElementById('confirmActionBtn').textContent = 'Delete Statement';
    document.getElementById('confirmActionBtn').className = 'danger';
    document.getElementById('confirmModal').classList.add('active');
}
