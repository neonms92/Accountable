// ─── Accounts ────────────────────────────────────────────────────────────────

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
    const balance = parseFloat(document.getElementById('accountBalance').value) || 0;

    if (!name) return showMessage('Please enter an account name', 'error');
    if (ledgerData.accounts.some(a => a.name === name && a.id !== id)) {
        return showMessage('An account with this name already exists', 'error');
    }

    if (id) {
        const account = ledgerData.accounts.find(a => a.id === id);
        if (account) {
            account.name = name;
            account.initialBalance = balance;
        }
    } else {
        ledgerData.accounts.push({ id: Ledger.newId(), name, initialBalance: balance });
    }

    markUnsaved();
    updateUI();
    closeAccountModal();
    showMessage(id ? 'Account updated successfully!' : 'Account added successfully!');
}

// Creates accounts for imported names that don't exist yet.
function ensureAccounts(names) {
    names.forEach(name => {
        if (!ledgerData.accounts.some(a => a.name === name)) {
            ledgerData.accounts.push({ id: Ledger.newId(), name, initialBalance: 0 });
        }
    });
}

function updateAccountsTable() {
    const tbody = document.getElementById('accountsBody');
    if (ledgerData.accounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">No accounts yet</div><p>Add your first account to start tracking</p></div></td></tr>';
        return;
    }

    // Deposits and withdrawals are this month's activity as the bank sees it;
    // the balance is as of the end of the month.
    const bal = Ledger.accountBalances(ledgerData, selectedMonth);
    let accounts = ledgerData.accounts.map(a => ({
        ...a,
        ...Ledger.accountActivity(ledgerData, a.id, selectedMonth),
        balance: bal[a.id] || 0
    }));

    if (sortState.table === 'accounts') {
        const key = { name: a => a.name.toLowerCase(), deposits: a => a.deposits, withdrawals: a => a.withdrawals }[sortState.column] || (a => a.balance);
        accounts.sort((a, b) => compareValues(key(a), key(b)));
    }

    tbody.innerHTML = accounts.map(a =>
        `<tr onclick="openAccountModal(${jsArg(a.id)})">
            <td>${escapeHtml(a.name)}</td>
            <td class="amount positive">${formatCurrency(a.deposits)}</td>
            <td class="amount ${a.withdrawals > 0 ? 'negative' : ''}">${a.withdrawals > 0 ? '-' : ''}${formatCurrency(a.withdrawals)}</td>
            <td class="amount ${a.balance >= 0 ? 'positive' : 'negative'}">${formatCurrency(a.balance)}</td>
        </tr>`
    ).join('');
}
