// ─── Statements ──────────────────────────────────────────────────────────────

function updateStatementsTab() {
    const tbody = document.getElementById('statementsBody');
    const stmts = ledgerData.statements.filter(s => s.month === selectedMonth);

    if (stmts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">🧾</div><div class="empty-state-title">No statements for this month</div><p>Add a statement for each account to mark the month complete</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = stmts.map(s => {
        const account = ledgerData.accounts.find(a => a.id === s.accountId);
        const accountName = account ? escapeHtml(account.name) : 'Unknown';
        // Two checks: the statement adds up on its own, and the ledger's activity
        // for the account matches the statement's deposit and withdrawal totals.
        const problems = [];
        const check = Ledger.statementCheck(s);
        if (!check.ok) problems.push(`Expected ending balance: ${formatCurrency(check.expected)} (diff: ${formatCurrency(check.diff)})`);
        const act = Ledger.accountActivity(ledgerData, s.accountId, s.month);
        if (!Ledger.nearlyEqual(act.deposits, s.deposits)) problems.push(`Ledger deposits: ${formatCurrency(act.deposits)}`);
        if (!Ledger.nearlyEqual(act.withdrawals, s.withdrawals)) problems.push(`Ledger withdrawals: ${formatCurrency(act.withdrawals)}`);
        const statusHtml = problems.length === 0
            ? `<span class="stmt-status ok" title="Balances check out and match the ledger">✓</span>`
            : `<span class="stmt-status warn" title="${escapeHtml(problems.join('\n'))}">!</span>`;
        return `<tr onclick="openStatementModal(${jsArg(s.id)})">
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
    document.getElementById('statementAccount').innerHTML = accountOptions('Select account...');

    if (statementId) {
        const s = ledgerData.statements.find(x => x.id === statementId);
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
        document.getElementById('statementMonth').value = selectedMonth;
    }

    document.getElementById('statementModal').classList.add('active');
    setTimeout(() => document.getElementById('statementAccount').focus(), 100);
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

    // Check for duplicate (same account + month), excluding self
    const duplicate = ledgerData.statements.find(s => s.accountId === accountId && s.month === month && s.id !== id);
    if (duplicate) return showMessage('A statement already exists for this account and month', 'error');

    if (id) {
        const s = ledgerData.statements.find(x => x.id === id);
        if (s) Object.assign(s, { accountId, month, startDate, endDate, startBalance, endBalance, deposits, withdrawals });
    } else {
        ledgerData.statements.push({ id: Ledger.newId(), accountId, month, startDate, endDate, startBalance, endBalance, deposits, withdrawals });
    }

    markUnsaved();
    updateUI();
    closeStatementModal();
    showMessage(id ? 'Statement updated!' : 'Statement added!');
}

function confirmDeleteStatement() {
    const id = document.getElementById('statementId').value;
    if (!id) return;
    showConfirm({ type: 'deleteStatement', id }, 'Delete Statement',
        '<p>Are you sure you want to delete this statement?</p>', 'Delete Statement');
}
