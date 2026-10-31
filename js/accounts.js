function openAccountModal(accountId = null) {
    if (accountId) {
        const account = ledgerData.accounts.find(a => a.id === accountId);
        if (account) {
            document.getElementById('accountModalTitle').textContent = 'Edit Account';
            document.getElementById('accountId').value = account.id;
            document.getElementById('accountName').value = account.name;
            document.getElementById('accountBalance').value = account.initialBalance || 0;
            document.getElementById('deleteAccountBtn').style.display = 'block';
        }
    } else {
        document.getElementById('accountModalTitle').textContent = 'Add Account';
        document.getElementById('accountId').value = '';
        document.getElementById('accountName').value = '';
        document.getElementById('accountBalance').value = '0.00';
        document.getElementById('deleteAccountBtn').style.display = 'none';
    }
    document.getElementById('accountModal').classList.add('active');
    setTimeout(() => document.getElementById('accountName').focus(), 100);
}

function closeAccountModal() {
    document.getElementById('accountModal').classList.remove('active');
}

function saveAccount() {
    const id = document.getElementById('accountId').value;
    const name = document.getElementById('accountName').value.trim();
    const balance = parseFloat(document.getElementById('accountBalance').value);
    
    if (!name) return showMessage('Please enter an account name', 'error');

    if (id) {
        const account = ledgerData.accounts.find(a => a.id === id);
        if (account) {
            account.name = name;
            account.initialBalance = balance;
        }
    } else {
        ledgerData.accounts.push({ id: Date.now().toString(), name, initialBalance: balance });
    }

    markUnsaved();
    updateUI();
    closeAccountModal();
    showMessage(id ? 'Account updated successfully!' : 'Account added successfully!');
}


function calculateAccountBalances(transactions) {
    const balances = {};
    ledgerData.accounts.forEach(a => balances[a.id] = a.initialBalance || 0);
    // Add all transactions (includes paycheck-managed deduction transactions)
    transactions.forEach(t => { if (balances[t.accountId] !== undefined) balances[t.accountId] += t.amount; });
    // Add all paycheck entries with absolute amount
    // Scope: match the same month filter used by the caller's transaction list
    const txMonths = new Set(transactions.map(t => t.month));
    const allMonths = selectedMonth === null;
    (ledgerData.paychecks || []).forEach(p => {
        if (balances[p.accountId] !== undefined) {
            if (allMonths || txMonths.has(p.month)) {
                balances[p.accountId] += Math.abs(p.amount);
            }
        }
    });
    return balances;
}


function updateAccountsTable() {
    const tbody = document.getElementById('accountsBody');
    if (ledgerData.accounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">No accounts yet</div><p>Add your first account to start tracking</p></div></td></tr>';
        return;
    }

    const bal = calculateAccountBalances(getYTDTransactions());
    // Deposits = sum of ABS(paycheck entries) per account for the period
    // Withdrawals = sum of negative transaction amounts (ABS) per account for the period
    const paychecks = ledgerData.paychecks || [];
    const filtTrans = getFilteredTransactions();

    let accounts = ledgerData.accounts.map(a => {
        const filtPaychecks = selectedMonth
            ? paychecks.filter(p => p.accountId === a.id && p.month === selectedMonth)
            : paychecks.filter(p => p.accountId === a.id);
        const deposits = filtPaychecks.reduce((s, p) => s + Math.abs(p.amount), 0);
        const withdrawals = filtTrans
            .filter(t => t.accountId === a.id && t.amount < 0)
            .reduce((s, t) => s + Math.abs(t.amount), 0);
        return { ...a, balance: bal[a.id] || 0, deposits, withdrawals };
    });

    if (sortState.table === 'accounts') {
        accounts.sort((a, b) => {
            let valA, valB;
            if (sortState.column === 'name') { valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); }
            else if (sortState.column === 'deposits') { valA = a.deposits; valB = b.deposits; }
            else if (sortState.column === 'withdrawals') { valA = a.withdrawals; valB = b.withdrawals; }
            else { valA = a.balance; valB = b.balance; }
            if (typeof valA === 'string') return sortState.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            return sortState.direction === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
        });
    }

    tbody.innerHTML = accounts.map(a =>
        `<tr onclick="openAccountModal('${a.id}')">
            <td>${escapeHtml(a.name)}</td>
            <td class="amount positive">${formatCurrency(a.deposits)}</td>
            <td class="amount ${a.withdrawals > 0 ? 'negative' : ''}">${a.withdrawals > 0 ? '-' : ''}${formatCurrency(a.withdrawals)}</td>
            <td class="amount ${a.balance >= 0 ? 'positive' : 'negative'}">${formatCurrency(a.balance)}</td>
        </tr>`
    ).join('');
}
