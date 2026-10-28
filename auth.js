(async () => {
  const app = document.getElementById('app');
  const config = window.SLATE_CONFIG || {};
  if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
    app.innerHTML = '<main class="page"><section class="panel"><h1>Slate Notes v2</h1><p>Backend setup is pending. Configure Supabase to enable sign-in.</p></section></main>'; return;
  }
  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'slate-v2-auth'}
  });
  let started = false;
  async function open(session) {
    if (!session) {
      if (started) { location.reload(); return; }
      app.innerHTML = `<main class="page"><section class="panel" style="max-width:460px;margin:8vh auto"><h1>Slate Notes</h1><p>Sign in to your workspace</p><form id="login"><label>Email<input class="select" name="email" type="email" autocomplete="username" required></label><label>Password<input class="select" name="password" type="password" autocomplete="current-password" required></label><p id="loginError" role="alert"></p><button class="button primary" type="submit">Login</button></form></section></main>`;
      document.getElementById('login').onsubmit = async e => {
        e.preventDefault(); const form = e.currentTarget; const button = form.querySelector('button'); button.disabled = true;
        const {error} = await client.auth.signInWithPassword({email: form.email.value, password: form.password.value});
        if (error) document.getElementById('loginError').textContent = error.message;
        button.disabled = false;
      }; return;
    }
    if (started) return;
    const {data: profile, error} = await client.from('profiles').select('*').eq('id',session.user.id).single();
    if (error || !profile?.active) { app.textContent = 'Profile unavailable or inactive. Contact the administrator.'; return; }
    started = true;
    window.SLATE_AUTH = {client, user: session.user, profile};
    const script = document.createElement('script'); script.src='app.js'; document.body.append(script);
  }
  client.auth.onAuthStateChange((_event, session) => {setTimeout(() => open(session),0);});
  const {data, error} = await client.auth.getSession();
  if (error) { app.textContent = error.message; return; }
  await open(data.session);
})();
