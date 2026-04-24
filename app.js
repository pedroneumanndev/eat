// 90 Dias — Comer Pouco (PWA, sem backend)
// Estado em localStorage. Notificações via Service Worker (showTrigger quando disponível)
// e fallback com setTimeout enquanto o app está aberto.

const KEYS = {
  start: 'cp.startDate',       // ISO date (YYYY-MM-DD) do dia 1
  checks: 'cp.checks',         // { 'YYYY-MM-DD': {almoco:bool, jantar:bool} }
  notif: 'cp.notifEnabled'
};
const TOTAL_DAYS = 90;
const REMINDERS = [
  { id: 'almoco', hour: 13, minute: 0, title: 'Pós-almoço', body: 'Marque a caixinha do almoço. Você comeu pouco?' },
  { id: 'jantar', hour: 19, minute: 0, title: 'Pós-jantar',  body: 'Marque a caixinha do jantar. Você comeu pouco?' },
];

// ---------- utils ----------
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const diffDays = (a,b) => Math.round((parseYmd(ymd(a)) - parseYmd(ymd(b))) / 86400000);

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function getStart() {
  let s = load(KEYS.start, null);
  if (!s) { s = ymd(new Date()); save(KEYS.start, s); }
  return s;
}
function getChecks() { return load(KEYS.checks, {}); }
function setChecks(obj) { save(KEYS.checks, obj); }

function dayIndex(today = new Date()) {
  const start = parseYmd(getStart());
  return Math.max(1, Math.min(TOTAL_DAYS, diffDays(today, start) + 1));
}

// ---------- render ----------
function render() {
  const today = new Date();
  const idx = dayIndex(today);
  document.getElementById('dayNumber').textContent = idx;
  const pct = Math.round((idx / TOTAL_DAYS) * 100);
  document.getElementById('progressBar').style.width = pct + '%';

  const start = parseYmd(getStart());
  const end = new Date(start); end.setDate(start.getDate() + TOTAL_DAYS - 1);
  const remaining = Math.max(0, TOTAL_DAYS - idx);
  document.getElementById('progressMeta').textContent =
    `início ${start.toLocaleDateString('pt-BR')} · fim ${end.toLocaleDateString('pt-BR')} · faltam ${remaining} dias`;

  // Today's title
  document.getElementById('todayTitle').textContent =
    `Hoje — ${today.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'short' })}`;

  // Checkboxes
  const key = ymd(today);
  const checks = getChecks();
  const rec = checks[key] || { almoco: false, jantar: false };
  document.getElementById('chkAlmoco').checked = !!rec.almoco;
  document.getElementById('chkJantar').checked = !!rec.jantar;

  // Stats
  let streak = 0, done = 0, possible = 0;
  for (let i = 0; i < idx; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const r = checks[ymd(d)] || {};
    const s = (r.almoco ? 1 : 0) + (r.jantar ? 1 : 0);
    done += s;
    possible += 2;
  }
  // streak contando de hoje para trás, dia vale se os dois foram marcados (ou só um se for hoje ainda)
  for (let i = idx - 1; i >= 0; i--) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const r = checks[ymd(d)] || {};
    const full = r.almoco && r.jantar;
    if (full) streak++;
    else if (i === idx - 1) { /* hoje ainda rolando: quebra só se já passou de 22h e não está completo */
      const now = new Date();
      if (now.getHours() >= 22) break;
      // não conta nem quebra
    } else break;
  }
  document.getElementById('statStreak').textContent = streak;
  document.getElementById('statDone').textContent = done;
  document.getElementById('statPct').textContent = possible ? Math.round((done/possible)*100) + '%' : '0%';

  // History grid
  const grid = document.getElementById('historyGrid');
  grid.innerHTML = '';
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = ymd(d);
    const r = checks[k] || {};
    const s = (r.almoco ? 1 : 0) + (r.jantar ? 1 : 0);
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.title = `Dia ${i+1} — ${d.toLocaleDateString('pt-BR')}`;
    const isFuture = i + 1 > idx;
    const isToday = i + 1 === idx;
    if (!isFuture) {
      if (s === 2) cell.classList.add('done');
      else if (s === 1) cell.classList.add('half');
      else {
        // só marca miss se o dia já terminou
        const endOfDay = new Date(d); endOfDay.setHours(23,59,59,0);
        if (endOfDay < new Date()) cell.classList.add('miss');
      }
    }
    if (isToday) cell.classList.add('today');
    cell.textContent = i + 1;
    grid.appendChild(cell);
  }
}

// ---------- interação ----------
function bindChecks() {
  const bind = (id, field) => {
    document.getElementById(id).addEventListener('change', e => {
      const key = ymd(new Date());
      const checks = getChecks();
      checks[key] = checks[key] || { almoco: false, jantar: false };
      checks[key][field] = e.target.checked;
      setChecks(checks);
      render();
    });
  };
  bind('chkAlmoco', 'almoco');
  bind('chkJantar', 'jantar');
}

document.getElementById('btnReset').addEventListener('click', () => {
  if (!confirm('Reiniciar o contador para hoje? Os check-ins atuais serão apagados.')) return;
  localStorage.removeItem(KEYS.start);
  localStorage.removeItem(KEYS.checks);
  render();
  scheduleAll();
});

// ---------- notificações ----------
const tip = msg => { document.getElementById('notifTip').textContent = msg || ''; };

async function enableNotifications() {
  if (!('Notification' in window)) { tip('Este navegador não suporta notificações.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { tip('Permissão negada. Ative em ajustes do navegador.'); return; }
  save(KEYS.notif, true);
  await scheduleAll();
  tip('Lembretes ativados para 13:00 e 19:00.');
}

document.getElementById('btnNotif').addEventListener('click', enableNotifications);

function nextOccurrence(hour, minute, fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setSeconds(0, 0);
  d.setHours(hour, minute, 0, 0);
  if (d <= fromDate) d.setDate(d.getDate() + 1);
  return d;
}

// Agenda notificações usando TimestampTrigger (quando disponível) para os próximos 14 dias.
async function scheduleWithTriggers(reg) {
  if (!('showTrigger' in Notification.prototype) || typeof TimestampTrigger === 'undefined') return false;
  const now = new Date();
  for (const r of REMINDERS) {
    for (let i = 0; i < 14; i++) {
      const when = nextOccurrence(r.hour, r.minute, now);
      when.setDate(when.getDate() + i);
      try {
        await reg.showNotification(r.title, {
          tag: `cp-${r.id}-${ymd(when)}`,
          body: r.body,
          icon: 'icon.svg',
          badge: 'icon.svg',
          showTrigger: new TimestampTrigger(when.getTime()),
          data: { url: '/' }
        });
      } catch (e) { console.warn('trigger fail', e); }
    }
  }
  return true;
}

// Fallback enquanto o app está aberto: agenda setTimeout pro próximo horário.
let fallbackTimers = [];
function clearFallback() { fallbackTimers.forEach(clearTimeout); fallbackTimers = []; }
function scheduleFallback() {
  clearFallback();
  if (Notification.permission !== 'granted') return;
  const now = new Date();
  for (const r of REMINDERS) {
    const when = nextOccurrence(r.hour, r.minute, now);
    const ms = when - now;
    fallbackTimers.push(setTimeout(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) reg.showNotification(r.title, { body: r.body, icon: 'icon.svg', tag: `cp-${r.id}-live` });
        else new Notification(r.title, { body: r.body, icon: 'icon.svg' });
      } catch {}
      scheduleFallback();
    }, ms));
  }
}

async function scheduleAll() {
  if (!load(KEYS.notif, false)) return;
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const ok = await scheduleWithTriggers(reg);
  if (!ok) {
    tip('Seu navegador não suporta agendamento em background. Os lembretes tocam enquanto o app estiver aberto. Instale na tela inicial e mantenha em segundo plano para melhor resultado.');
  }
  scheduleFallback();
}

// ---------- service worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW fail', e));
}

// Lembrete in-app quando o app abre dentro da janela do horário e falta marcar
function inAppNudge() {
  const now = new Date();
  const key = ymd(now);
  const rec = getChecks()[key] || {};
  const h = now.getHours();
  const showFor = [];
  if (h >= 13 && h < 17 && !rec.almoco) showFor.push('almoço');
  if (h >= 19 && h < 23 && !rec.jantar) showFor.push('jantar');
  if (showFor.length && Notification.permission === 'granted') {
    navigator.serviceWorker?.getRegistration().then(reg => {
      if (reg) reg.showNotification('Não esquece', { body: `Marque a caixinha do ${showFor.join(' e ')}.`, icon: 'icon.svg' });
    });
  }
}

// ---------- init ----------
getStart();
bindChecks();
render();
if (Notification && Notification.permission === 'granted') {
  save(KEYS.notif, true);
  scheduleAll();
  tip('Lembretes ativos.');
} else if (Notification && Notification.permission === 'denied') {
  tip('Notificações bloqueadas. Ative no navegador.');
}
inAppNudge();

// Re-render a cada minuto para virar o dia sozinho
setInterval(render, 60 * 1000);
