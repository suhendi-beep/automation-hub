import React, { useState } from "react";

const VALID_USER = "admin";
const VALID_PASS = "ICSsupport2026";

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setTimeout(() => {
      if (username === VALID_USER && password === VALID_PASS) {
        sessionStorage.setItem("pr_auth", "1");
        onLogin();
      } else {
        setError("Username atau password salah.");
      }
      setLoading(false);
    }, 400);
  };

  return (
    <div style={styles.bg}>
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoWrap}>
          <img src="/logo.svg" alt="ICS Compute" style={styles.logo} />
        </div>

        {/* Title */}
        <h1 style={styles.title}>Report Portal</h1>

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Username */}
          <div style={styles.field}>
            <label style={styles.label}>Username</label>
            <input
              style={styles.input}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>

          {/* Password */}
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <div style={styles.pwdWrap}>
              <input
                style={{...styles.input, paddingRight: 44}}
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button type="button" style={styles.eyeBtn}
                onClick={() => setShowPwd(v => !v)}>
                {showPwd ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && <div style={styles.error}>{error}</div>}

          {/* Submit */}
          <button type="submit" style={styles.loginBtn} disabled={loading || !username || !password}>
            {loading ? "..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  bg: {
    minHeight: "100vh",
    background: "#13131a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "Inter, sans-serif",
  },
  card: {
    background: "#1e1e2e",
    borderRadius: 16,
    padding: "40px 44px 44px",
    width: 420,
    maxWidth: "92vw",
    boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  logoWrap: {
    marginBottom: 20,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 12,
  },
  title: {
    color: "#fff",
    fontSize: 26,
    fontWeight: 700,
    marginBottom: 28,
    letterSpacing: "-0.5px",
  },
  form: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    color: "#aaa",
    fontSize: 14,
    fontWeight: 500,
  },
  input: {
    background: "#111118",
    border: "1px solid #2a2a3e",
    borderRadius: 8,
    color: "#fff",
    fontSize: 15,
    padding: "13px 14px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border 0.2s",
  },
  pwdWrap: {
    position: "relative",
  },
  eyeBtn: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 18,
    color: "#888",
    padding: "2px 4px",
    lineHeight: 1,
  },
  error: {
    color: "#ff6b6b",
    fontSize: 13,
    textAlign: "center",
    marginTop: -4,
  },
  loginBtn: {
    marginTop: 8,
    background: "#7c3aed",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    padding: "14px",
    cursor: "pointer",
    width: "100%",
    transition: "background 0.2s",
  },
};
