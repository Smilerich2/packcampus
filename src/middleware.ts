import { defineMiddleware } from "astro:middleware";

const PUBLIC_PATHS = ["/api/"];

export const onRequest = defineMiddleware(({ url, cookies }, next) => {
  // Let API routes and static assets through
  if (PUBLIC_PATHS.some((p) => url.pathname.startsWith(p))) {
    return next();
  }

  // Check access cookie
  if (cookies.get("site_access")?.value === "granted") {
    return next();
  }

  // Show login gate
  const hasError = url.searchParams.has("error");
  const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PackCampus — Zugang</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Inter", system-ui, -apple-system, sans-serif;
      background: #f9fafb;
      color: #111827;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      background: #fff;
      border: 1px solid rgba(229,231,235,0.6);
      border-radius: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      width: 100%;
      max-width: 24rem;
      padding: 2.5rem 2rem;
      text-align: center;
    }
    .logo {
      width: 3rem; height: 3rem;
      background: #f97316;
      border-radius: 0.75rem;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 1.5rem;
    }
    .logo svg { width: 1.5rem; height: 1.5rem; color: #fff; }
    h1 { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.25rem; }
    .sub { font-size: 0.875rem; color: #9ca3af; margin-bottom: 1.5rem; }
    input {
      width: 100%;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      background: #f9fafb;
      border: 1px solid rgba(229,231,235,0.6);
      border-radius: 0.75rem;
      outline: none;
      color: #111827;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input:focus {
      border-color: #f97316;
      box-shadow: 0 0 0 3px rgba(249,115,22,0.1);
      background: #fff;
    }
    input::placeholder { color: #9ca3af; }
    button {
      width: 100%;
      margin-top: 0.75rem;
      padding: 0.75rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: #fff;
      background: #f97316;
      border: none;
      border-radius: 0.75rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #ea580c; }
    .error {
      margin-top: 0.75rem;
      font-size: 0.8125rem;
      color: #dc2626;
      background: #fef2f2;
      padding: 0.5rem;
      border-radius: 0.5rem;
    }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    </div>
    <h1>PackCampus</h1>
    <p class="sub">Bitte Zugangspasswort eingeben</p>
    <form method="POST" action="/api/site-login">
      <input type="password" name="password" placeholder="Passwort" autofocus required />
      <button type="submit">Zugang erhalten</button>
    </form>
    ${hasError ? '<div class="error">Falsches Passwort. Bitte erneut versuchen.</div>' : ""}
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
