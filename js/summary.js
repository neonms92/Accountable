// ─── Summary ─────────────────────────────────────────────────────────────────

function setSummaryValue(id, value, className) {
    const el = document.getElementById(id);
    el.textContent = formatCurrency(value);
    if (className) el.className = className;
}

function updateSummary() {
    // Balances at the end of the selected month, compared with the end of the previous one
    const now = Ledger.netWorth(ledgerData, selectedMonth);
    const prev = Ledger.netWorth(ledgerData, selectedMonth - 1);
    const deltaNW = now.netWorth - prev.netWorth;
    const deltaA = now.assets - prev.assets;
    const deltaL = now.liabilities - prev.liabilities;

    setSummaryValue('netWorthYTD', now.netWorth, now.netWorth >= 0 ? 'summary-value positive' : 'summary-value negative');
    setSummaryValue('netWorthDelta', Math.abs(deltaNW), deltaNW >= 0 ? 'summary-delta positive' : 'summary-delta negative');
    setSummaryValue('totalAssetsYTD', now.assets);
    setSummaryValue('totalAssetsDelta', Math.abs(deltaA), deltaA >= 0 ? 'summary-delta positive' : 'summary-delta negative');
    setSummaryValue('totalLiabilitiesYTD', now.liabilities);
    setSummaryValue('totalLiabilitiesDelta', Math.abs(deltaL), deltaL >= 0 ? 'summary-delta negative' : 'summary-delta positive');

    const gap = Ledger.budgetGap(ledgerData, selectedMonth);
    setSummaryValue('budgetGapValue', gap, Ledger.nearlyEqual(gap, 0) || gap > 0 ? 'summary-value positive' : 'summary-value negative');

    setSummaryValue('necessaryExpensesValue', Ledger.necessaryExpenses(ledgerData, selectedMonth));
}
