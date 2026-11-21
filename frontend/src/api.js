const SESSION_KEYS = ["pr_auth", "pr_user", "pr_display", "pr_role", "pr_token", "pr_features", "pr_login_at"];

export function clearSession() {
  SESSION_KEYS.forEach((k) => {
    try { sessionStorage.removeItem(k); } catch (_) {}
  });
  if (window.location) window.location.reload();
}

export function getToken() {
  try { return sessionStorage.getItem("pr_token") || ""; } catch (_) { return ""; }
}

/** Local (Asia/Jakarta) calendar date as YYYY-MM-DD — never UTC-shifted. */
export function localISODate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Attach the bearer token to every same-origin /api request and force a
 * re-login when the backend reports an expired/invalid session.
 */
export function installFetchAuth() {
  if (window.__ahFetchAuthInstalled) return;
  window.__ahFetchAuthInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const isApi = url.startsWith("/api/");
    const isLogin = url.includes("/api/auth/login");

    if (isApi && !isLogin) {
      const token = getToken();
      if (token) {
        const headers = new Headers(
          init.headers || (typeof input !== "string" ? input.headers : undefined)
        );
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        init = { ...init, headers };
      }
    }

    return originalFetch(input, init).then((response) => {
      if (response.status === 401 && isApi && !isLogin) {
        clearSession();
      }
      return response;
    });
  };
}
