// Money & date helpers shared across routes.

function formatINR(amount) {
  const n = Number(amount || 0);
  return '\u20B9' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// Late fee: Rs.50/day for every day paid after the 10th of the month.
// dueDate and paidDate are JS Date objects (or null if not paid yet).
function calculateLateFee(forMonth, paymentDateStr, ratePerDay = 50, dueDay = 10) {
  if (!paymentDateStr) return 0;
  const [year, month] = forMonth.split('-').map(Number);
  const due = new Date(year, month - 1, dueDay);
  const paid = new Date(paymentDateStr);
  const diffDays = Math.floor((paid - due) / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays * ratePerDay : 0;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(forMonth) {
  const [year, month] = forMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

module.exports = { formatINR, calculateLateFee, currentMonthKey, monthLabel };
