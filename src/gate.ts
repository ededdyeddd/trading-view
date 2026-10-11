// Password gate for the hosted demo. Active only when VITE_GATE_HASH (SHA-256 hex of the password) is set at
// build time. Client-side only: it keeps casual visitors out, it is not real access control.
const HASH = import.meta.env.VITE_GATE_HASH as string | undefined;
const KEY = 'tv-gate';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function ask(hash: string): Promise<void> {
  return new Promise((resolve) => {
    const root = document.getElementById('root')!;
    root.innerHTML =
      '<form id="gate" style="display:flex;gap:8px;align-items:center;justify-content:center;height:100vh;font:14px system-ui">' +
      '<input type="password" placeholder="Password" autofocus style="padding:8px 10px;font:inherit">' +
      '<button style="padding:8px 14px;font:inherit">Enter</button></form>';
    const form = root.firstElementChild as HTMLFormElement;
    const input = form.querySelector('input')!;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if ((await sha256(input.value)) === hash) {
        try { sessionStorage.setItem(KEY, hash); } catch { /* storage blocked: ask again next load */ }
        root.innerHTML = '';
        resolve();
      } else {
        input.value = '';
        input.placeholder = 'Wrong password';
      }
    };
  });
}

if (HASH) {
  let ok = false;
  try { ok = sessionStorage.getItem(KEY) === HASH; } catch { /* ignore */ }
  if (!ok) await ask(HASH);
}
await import('./main');
