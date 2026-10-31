// ─── Envelopes ───────────────────────────────────────────────────────────────

function updateEnvelopesTable() {
    const tbody = document.getElementById('envelopesBody');
    const envNames = Ledger.envelopeNames(ledgerData);

    if (envNames.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">📬</div><div class="empty-state-title">No envelopes yet</div><p>Add your first envelope to start budgeting</p></div></td></tr>`;
        return;
    }

    let rows = envNames.map(name => ({
        name,
        funding: Ledger.envelopeFunding(ledgerData, name, selectedMonth),
        withdrawals: Ledger.envelopeWithdrawals(ledgerData, name, selectedMonth),
        total: Ledger.envelopeBalance(ledgerData, name, selectedMonth)
    }));

    if (sortState.table === 'envelopes') {
        const key = { name: r => r.name.toLowerCase(), funding: r => r.funding, withdrawals: r => r.withdrawals }[sortState.column] || (r => r.total);
        rows.sort((a, b) => compareValues(key(a), key(b)));
    } else {
        rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    }

    tbody.innerHTML = rows.map(r => `<tr onclick="openEnvelopeModal(${jsArg(r.name)})">
            <td>${envelopeTag(r.name)}</td>
            <td class="amount positive">${formatCurrency(r.funding)}</td>
            <td class="amount ${r.withdrawals > 0 ? 'negative' : ''}">${r.withdrawals > 0 ? '-' : ''}${formatCurrency(r.withdrawals)}</td>
            <td class="amount ${r.total >= 0 ? 'positive' : 'negative'}">${formatCurrency(r.total)}</td>
        </tr>`).join('');
}

// ─── Envelope Modal ───────────────────────────────────────────────────────────

function openEnvelopeModal(name = null) {
    const isEdit = name !== null && !!ledgerData.envelopes[name];
    document.getElementById('envelopeModalTitle').textContent = isEdit ? 'Edit Envelope' : 'Add Envelope';
    document.getElementById('envelopeId').value = isEdit ? name : '';
    document.getElementById('envelopeName').value = isEdit ? name : '';
    document.getElementById('deleteEnvelopeBtn').style.display = isEdit ? 'block' : 'none';

    const env = isEdit ? ledgerData.envelopes[name] : null;
    const color = safeColor(env && env.color);
    const explicit = env ? env.funding[selectedMonth] : undefined;
    const hint = document.getElementById('envelopeFundingHint');
    if (!env || explicit !== undefined) {
        hint.textContent = '';
    } else if (selectedMonth > 1) {
        hint.textContent = `Inheriting ${formatCurrency(Ledger.envelopeFunding(ledgerData, name, selectedMonth))} from a prior month. Enter a value to override.`;
    } else {
        hint.textContent = 'Defaults to $0.00 in January. Enter a value to set funding.';
    }

    document.getElementById('envelopeFundingGroup').style.display = 'block';
    document.getElementById('envelopeFundingMonthLabel').textContent = `for ${MONTH_NAMES[selectedMonth - 1]}`;
    document.getElementById('envelopeFunding').value = explicit !== undefined ? explicit : '';
    document.getElementById('envelopeNecessary').checked = !!(env && env.necessary);
    document.getElementById('envelopeOpeningBalance').value = env && env.openingBalance ? env.openingBalance : '';

    selectEnvelopeModalColor(color);
    document.querySelectorAll('#envelopeModal .color-preset').forEach(btn => {
        btn.onclick = (e) => { e.preventDefault(); selectEnvelopeModalColor(btn.dataset.color); };
    });
    document.getElementById('envelopeModalColorHex').oninput = (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) selectEnvelopeModalColor(e.target.value);
    };

    document.getElementById('envelopeModal').classList.add('active');
    setTimeout(() => document.getElementById('envelopeName').focus(), 100);
}

function closeEnvelopeModal() {
    document.getElementById('envelopeModal').classList.remove('active');
}

// Renames an envelope everywhere it is referenced.
function renameEnvelope(oldName, newName) {
    ledgerData.envelopes[newName] = ledgerData.envelopes[oldName];
    delete ledgerData.envelopes[oldName];
    ledgerData.transactions.forEach(t => { if (t.envelope === oldName) t.envelope = newName; });
    ledgerData.paychecks.forEach(p => { if (p.envelope === oldName) p.envelope = newName; });
}

function saveEnvelope() {
    const oldName = document.getElementById('envelopeId').value;
    const name = document.getElementById('envelopeName').value.trim();
    const isEdit = oldName !== '';

    if (!name) return showMessage('Please enter an envelope name', 'error');
    if (name === Ledger.TRANSFER_ENVELOPE) return showMessage(`"${name}" is reserved for transfers between accounts`, 'error');
    if (name !== oldName && ledgerData.envelopes[name]) return showMessage('An envelope with this name already exists', 'error');

    if (!isEdit) {
        ledgerData.envelopes[name] = { color: envelopeModalColor, funding: {}, necessary: false, openingBalance: 0 };
    } else if (name !== oldName) {
        if (!ledgerData.envelopes[oldName]) return;
        renameEnvelope(oldName, name);
    }

    const env = ledgerData.envelopes[name];
    env.color = envelopeModalColor;
    env.necessary = document.getElementById('envelopeNecessary').checked;
    env.openingBalance = parseFloat(document.getElementById('envelopeOpeningBalance').value) || 0;

    const rawFunding = document.getElementById('envelopeFunding').value;
    if (rawFunding === '') {
        // Clear explicit override - revert to inheritance
        delete env.funding[selectedMonth];
    } else {
        env.funding[selectedMonth] = parseFloat(rawFunding) || 0;
    }

    markUnsaved();
    updateUI();
    closeEnvelopeModal();
    showMessage(isEdit ? 'Envelope updated!' : 'Envelope added!');
}

function confirmDeleteEnvelope() {
    const name = document.getElementById('envelopeId').value;
    if (!name) return;
    showConfirm({ type: 'deleteEnvelope', name }, 'Delete Envelope',
        `<p>Are you sure you want to delete the <strong>${escapeHtml(name)}</strong> envelope? Transactions assigned to it will not be deleted, but will lose their envelope assignment.</p>`,
        'Delete Envelope');
}

// Creates envelopes for imported names that don't exist yet.
function ensureEnvelopes(names) {
    names.forEach(name => {
        if (name && !ledgerData.envelopes[name]) ledgerData.envelopes[name] = { color: Ledger.DEFAULT_COLOR, funding: {}, necessary: false, openingBalance: 0 };
    });
}
