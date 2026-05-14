"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("contact@navabloomco.com");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function login(e: any) {
    e.preventDefault();
    setMessage("Logging in...");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    if (data.session) {
      setMessage(`Logged in as ${data.user.email} ✅`);
      // ✅ FIX: redirect to the new canonical dashboard
      window.location.href = "/dashboard";
    }
  }

  return (
    <main style={{ padding: 40, maxWidth: 500 }}>
      <h1>Nava Strat Login</h1>
      <form onSubmit={login}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 10 }}
          required
        />
        <br />
        <br />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: 10 }}
          required
        />
        <br />
        <br />
        <button type="submit">Login</button>
      </form>
      {message && <pre style={{ background: "#f4f4f4", padding: 12 }}>{message}</pre>}
    </main>
  );
}
