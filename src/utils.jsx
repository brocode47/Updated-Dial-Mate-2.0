// ===============================
// 💰 FORMAT CURRENCY (PKR)
// ===============================
export function formatCurrency(amount) {
  const value = Number(amount || 0);

  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(value);
}

// ===============================
// 📊 STATUS COLOR (ORDER STATUS)
// ===============================
export function getStatusTone(status) {
  if (!status) return 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.6)]';

  const s = String(status).toLowerCase();

  if (s.includes('confirm')) return 'bg-emerald-500/12 text-emerald-600';
  if (s.includes('cancel')) return 'bg-red-500/12 text-red-600';
  if (s.includes('no answer')) return 'bg-amber-500/12 text-amber-600';
  if (s.includes('reschedule')) return 'bg-blue-500/12 text-blue-600';

  return 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]';
}

// ===============================
// 📞 CALL STATUS COLOR
// ===============================
export function getCallTone(callStatus) {
  if (!callStatus) return 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.6)]';

  const s = String(callStatus).toLowerCase();

  if (s === 'completed') return 'bg-emerald-500/12 text-emerald-600';
  if (s === 'failed' || s === 'busy' || s === 'no-answer') {
    return 'bg-red-500/12 text-red-600';
  }
  if (s === 'ringing' || s === 'in-progress' || s === 'initiated') {
    return 'bg-blue-500/12 text-blue-600';
  }

  return 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.6)]';
}

// ===============================
// ⚠️ RISK COLOR
// ===============================
export function getRiskTone(risk) {
  const value = Number(risk || 0);

  if (value >= 70) return 'text-red-600';
  if (value >= 40) return 'text-amber-600';
  return 'text-emerald-600';
}

// ===============================
// 🌐 HASH ROUTING
// ===============================
export function hashRoute() {
  const raw = window.location.hash || '#/onboarding';

  const route = raw.replace('#', '') || '/onboarding';

  const validRoutes = [
    '/dashboard',
    '/orders',
    '/calls',
    '/billing',
    '/settings',
    '/onboarding'
  ];

  return validRoutes.includes(route) ? route : '/onboarding';
}

// ===============================
// 🔗 SAFE ENCODE (for URLs)
// ===============================
export function encodeId(id) {
  return encodeURIComponent(String(id || ''));
}