function updateSummary() {
    const ytdTrans = getYTDTransactions();
    const prevTrans = selectedMonth ? ledgerData.transactions.filter(t => t.month < selectedMonth) : [];
    const ytdBal = calculateAccountBalances(ytdTrans);
    const prevBal = calculateAccountBalances(prevTrans);

    let ytdA = 0, ytdL = 0, prevA = 0, prevL = 0;
    ledgerData.accounts.forEach(a => {
        const yb = ytdBal[a.id] || 0, pb = prevBal[a.id] || 0;
        if (yb >= 0) ytdA += yb; else ytdL += Math.abs(yb);
        if (pb >= 0) prevA += pb; else prevL += Math.abs(pb);
    });

    const ytdNW = ytdA - ytdL, prevNW = prevA - prevL;
    const deltaA = ytdA - prevA, deltaL = ytdL - prevL, deltaNW = ytdNW - prevNW;

    document.getElementById('netWorthYTD').textContent = formatCurrency(ytdNW);
    document.getElementById('netWorthYTD').className = ytdNW >= 0 ? 'summary-value positive' : 'summary-value negative';
    document.getElementById('netWorthDelta').textContent = formatCurrency(Math.abs(deltaNW));
    document.getElementById('netWorthDelta').className = deltaNW >= 0 ? 'summary-delta positive' : 'summary-delta negative';

    document.getElementById('totalAssetsYTD').textContent = formatCurrency(ytdA);
    document.getElementById('totalAssetsDelta').textContent = formatCurrency(Math.abs(deltaA));
    document.getElementById('totalAssetsDelta').className = deltaA >= 0 ? 'summary-delta positive' : 'summary-delta negative';

    document.getElementById('totalLiabilitiesYTD').textContent = formatCurrency(ytdL);
    document.getElementById('totalLiabilitiesDelta').textContent = formatCurrency(Math.abs(deltaL));
    document.getElementById('totalLiabilitiesDelta').className = deltaL >= 0 ? 'summary-delta negative' : 'summary-delta positive';

    // ── Budget Gap: total account balance minus total envelope funding ──────────
    const totalAccountBalance = Object.values(ytdBal).reduce((s, v) => s + v, 0);
    const envNames = Object.keys(ledgerData.envelopes || {}).filter(n => n !== 'Transfer');
    const checkMonth = selectedMonth === null ? 12 : selectedMonth;
    const totalEnvelopeFunding = envNames.reduce((s, name) => {
        return s + (selectedMonth
            ? getEnvelopeFunding(name, selectedMonth)
            : Array.from({length:12},(_,i)=>i+1).reduce((fs,m)=>fs+getEnvelopeFunding(name,m),0));
    }, 0);
    const budgetGap = totalAccountBalance - totalEnvelopeFunding;
    const budgetGapEl = document.getElementById('budgetGapValue');
    budgetGapEl.textContent = formatCurrency(budgetGap);
    budgetGapEl.className = budgetGap >= 0 ? 'summary-value positive' : 'summary-value negative';

    // ── Necessary Expenses: total withdrawal amount from Necessary envelopes ────
    const necessaryEnvelopes = new Set(envNames.filter(n => ledgerData.envelopes[n].necessary));
    const filtTrans = getFilteredTransactions();
    const necessaryAmt = filtTrans
        .filter(t => t.amount < 0 && necessaryEnvelopes.has(t.envelope))
        .reduce((s, t) => s + Math.abs(t.amount), 0);
    const necessaryEl = document.getElementById('necessaryExpensesValue');
    necessaryEl.textContent = formatCurrency(necessaryAmt);
}
