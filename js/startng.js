// Talks to start.ng through its hidden connect page (see start.ng docs).
const START_NG = 'https://start.ng';
let frame;

function connectFrame() {
  frame ??= new Promise((resolve) => {
    const el = document.createElement('iframe');
    el.src = `${START_NG}/connect`;
    el.hidden = true;
    const giveUp = setTimeout(() => { frame = undefined; resolve(null); }, 5000);
    el.onload = () => { clearTimeout(giveUp); resolve(el); };
    el.onerror = () => { clearTimeout(giveUp); frame = undefined; resolve(null); };
    document.body.append(el);
  });
  return frame;
}

// Sends a message and resolves to start.ng's reply, or null if it didn't answer.
export async function askStartNg(message, replyType, timeoutMs = 5000) {
  const el = await connectFrame();
  if (!el) return null;
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const done = (reply) => {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(reply);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    function onMessage(e) {
      if (e.origin !== START_NG || e.source !== el.contentWindow) return;
      if (e.data?.type === replyType && e.data.requestId === requestId) done(e.data);
    }
    addEventListener('message', onMessage);
    el.contentWindow.postMessage({ ...message, requestId }, START_NG);
  });
}

// { user, guest } or null when start.ng didn't answer (for example when opened as a local file).
export async function whoami() {
  const reply = await askStartNg({ type: 'startng:whoami' }, 'startng:user');
  return reply ? { user: reply.user ?? null, guest: reply.guest ?? null } : null;
}

export function signIn() {
  location.href = `${START_NG}/?return_to=${encodeURIComponent(location.origin + location.pathname)}`;
}

export function saveRun(stats) {
  return askStartNg({ type: 'startng:score', stats }, 'startng:scoreSaved', 8000);
}

export async function getLeaderboard(limit = 10) {
  const reply = await askStartNg({ type: 'startng:leaderboard', limit }, 'startng:leaderboardData', 8000);
  return reply?.ok ? reply.entries : null;
}
