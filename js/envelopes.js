function getEnvelopeFunding(name, month) {
    const env = ledgerData.envelopes[name];
    if (!env) return 0;
    const funding = env.funding || {};
    if (funding[month] !== undefined) return funding[month];
    // Walk backwards to find the most recent prior explicit funding
    for (let m = month - 1; m >= 1; m--) {
        if (funding[m] !== undefined) return funding[m];
    }
    return 0;
}

// Calculate envelope running total up through a given month (inclusive).
// total(month) = sum of (funding(m) - withdrawals(m)) for m=1..month
function calculateEnvelopeTotal(name, upToMonth) {
    let total = 0;
    const maxMonth = upToMonth === null ? 12 : upToMonth;
    for (let m = 1; m <= maxMonth; m++) {
        const funding = getEnvelopeFunding(name, m);
        const withdrawals = ledgerData.transactions
            .filter(t => t.month === m && t.envelope === name && t.amount < 0)
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
        total += funding - withdrawals;
    }
    return total;
}

function updateEnvelopesTable() {
    const tbody = document.getElementById('envelopesBody');
    const envNames = Object.keys(ledgerData.envelopes || {}).filter(n => n !== 'Transfer');

    if (envNames.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">📬</div><div class="empty-state-title">No envelopes yet</div><p>Add your first envelope to start budgeting</p></div></td></tr>`;
        return;
    }

    // Build rows with computed values
    const displayMonth = selectedMonth; // may be null (All)
    let rows = envNames.map(name => {
        const color = ledgerData.envelopes[name].color || '#2D5F3F';
        const funding = displayMonth ? getEnvelopeFunding(name, displayMonth) : 
            Array.from({length:12},(_,i)=>i+1).reduce((s,m)=>s+getEnvelopeFunding(name,m),0);
        const withdrawals = (displayMonth
            ? ledgerData.transactions.filter(t => t.month === displayMonth && t.envelope === name && t.amount < 0)
            : ledgerData.transactions.filter(t => t.envelope === name && t.amount < 0)
        ).reduce((s,t) => s + Math.abs(t.amount), 0);
        const total = displayMonth ? calculateEnvelopeTotal(name, displayMonth) : calculateEnvelopeTotal(name, 12);
        return { name, color, funding, withdrawals, total };
    });

    if (sortState.table === 'envelopes') {
        rows.sort((a, b) => {
            let vA, vB;
            if (sortState.column === 'name') { vA = a.name.toLowerCase(); vB = b.name.toLowerCase(); }
            else if (sortState.column === 'funding') { vA = a.funding; vB = b.funding; }
            else if (sortState.column === 'withdrawals') { vA = a.withdrawals; vB = b.withdrawals; }
            else { vA = a.total; vB = b.total; }
            return sortState.direction === 'asc' ? (vA > vB ? 1 : -1) : (vA < vB ? 1 : -1);
        });
    } else {
        rows.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
    }

    tbody.innerHTML = rows.map(r => {
        const bg = r.color + '20';
        return `<tr onclick="openEnvelopeModal('${escapeHtml(r.name)}')">
            <td><span class="envelope-tag" style="background-color:${bg};color:${r.color};">${escapeHtml(r.name)}</span></td>
            <td class="amount positive">${formatCurrency(r.funding)}</td>
            <td class="amount ${r.withdrawals > 0 ? 'negative' : ''}">${r.withdrawals > 0 ? '-' : ''}${formatCurrency(r.withdrawals)}</td>
            <td class="amount ${r.total >= 0 ? 'positive' : 'negative'}">${formatCurrency(r.total)}</td>
        </tr>`;
    }).join('');
}

// ─── Envelope Modal ───────────────────────────────────────────────────────────

function openEnvelopeModal(name = null) {
    const isEdit = name !== null;
    document.getElementById('envelopeModalTitle').textContent = isEdit ? 'Edit Envelope' : 'Add Envelope';
    document.getElementById('envelopeId').value = name || '';
    document.getElementById('deleteEnvelopeBtn').style.display = isEdit ? 'block' : 'none';

    let color = '#2D5F3F';
    let fundingVal = '';
    let necessary = false;

    if (isEdit && ledgerData.envelopes[name]) {
        const env = ledgerData.envelopes[name];
        document.getElementById('envelopeName').value = name;
        document.getElementById('envelopeName').readOnly = true; // name is the key, renaming would be complex
        color = env.color || '#2D5F3F';
        necessary = !!env.necessary;

        if (selectedMonth) {
            const explicit = (env.funding || {})[selectedMonth];
            const inherited = getEnvelopeFunding(name, selectedMonth);
            fundingVal = explicit !== undefined ? explicit : '';
            // Show hint about inherited value
            const hint = document.getElementById('envelopeFundingHint');
            if (explicit === undefined && selectedMonth > 1) {
                hint.textContent = `Inheriting ${formatCurrency(inherited)} from a prior month. Enter a value to override.`;
            } else if (explicit === undefined && selectedMonth === 1) {
                hint.textContent = 'Defaults to $0.00 in January. Enter a value to set funding.';
            } else {
                hint.textContent = '';
            }
        }
    } else {
        document.getElementById('envelopeName').value = '';
        document.getElementById('envelopeName').readOnly = false;
        document.getElementById('envelopeFundingHint').textContent = '';
    }

    // Show/hide funding field based on whether a month is selected
    const fundingGroup = document.getElementById('envelopeFundingGroup');
    const fundingLabel = document.getElementById('envelopeFundingMonthLabel');
    if (selectedMonth) {
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        fundingGroup.style.display = 'block';
        fundingLabel.textContent = `for ${months[selectedMonth - 1]}`;
        document.getElementById('envelopeFunding').value = fundingVal;
    } else {
        fundingGroup.style.display = 'none';
    }

    envelopeModalColor = color;
    document.getElementById('envelopeModalColorPreview').style.background = color;
    document.getElementById('envelopeModalColorHex').value = color;
    document.getElementById('envelopeNecessary').checked = necessary;

    // Wire up color picker
    document.querySelectorAll('#envelopeModal .color-preset').forEach(btn => {
        btn.onclick = (e) => { e.preventDefault(); selectEnvelopeModalColor(btn.dataset.color); };
        btn.classList.toggle('selected', btn.dataset.color.toLowerCase() === color.toLowerCase());
    });
    document.getElementById('envelopeModalColorHex').oninput = (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) selectEnvelopeModalColor(e.target.value);
    };

    document.getElementById('envelopeModal').classList.add('active');
    if (!isEdit) setTimeout(() => document.getElementById('envelopeName').focus(), 100);
}

function closeEnvelopeModal() {
    document.getElementById('envelopeModal').classList.remove('active');
    document.getElementById('envelopeName').readOnly = false;
}

function saveEnvelope() {
    const oldName = document.getElementById('envelopeId').value;
    const name = document.getElementById('envelopeName').value.trim();
    const color = envelopeModalColor;
    const necessary = document.getElementById('envelopeNecessary').checked;

    if (!name) return showMessage('Please enter an envelope name', 'error');

    const isEdit = oldName !== '';

    if (!isEdit) {
        // Creating new envelope
        if (ledgerData.envelopes[name]) return showMessage('An envelope with this name already exists', 'error');
        ledgerData.envelopes[name] = { color, funding: {}, necessary };
    } else {
        // Editing existing
        if (!ledgerData.envelopes[oldName]) return;
        ledgerData.envelopes[oldName].color = color;
        ledgerData.envelopes[oldName].necessary = necessary;
    }

    // Save funding if a month is selected
    if (selectedMonth && document.getElementById('envelopeFundingGroup').style.display !== 'none') {
        const rawFunding = document.getElementById('envelopeFunding').value;
        const targetName = isEdit ? oldName : name;
        if (!ledgerData.envelopes[targetName].funding) ledgerData.envelopes[targetName].funding = {};
        if (rawFunding === '' || rawFunding === null) {
            // Clear explicit override - revert to inheritance
            delete ledgerData.envelopes[targetName].funding[selectedMonth];
        } else {
            ledgerData.envelopes[targetName].funding[selectedMonth] = parseFloat(rawFunding) || 0;
        }
    }

    markUnsaved();
    updateUI();
    closeEnvelopeModal();
    showMessage(isEdit ? 'Envelope updated!' : 'Envelope added!');
}

function confirmDeleteEnvelope() {
    const name = document.getElementById('envelopeId').value;
    if (!name) return;
    pendingAction = { type: 'deleteEnvelope', name };
    document.getElementById('confirmModalTitle').textContent = 'Delete Envelope';
    document.getElementById('confirmModalBody').innerHTML = `<p>Are you sure you want to delete the <strong>${escapeHtml(name)}</strong> envelope? Transactions assigned to it will not be deleted, but will lose their envelope assignment.</p>`;
    document.getElementById('confirmActionBtn').textContent = 'Delete Envelope';
    document.getElementById('confirmActionBtn').className = 'danger';
    document.getElementById('confirmModal').classList.add('active');
}
