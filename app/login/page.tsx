"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
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
      setMessage("Login successful ✅ Redirecting...");
      window.location.href = "/ops/dashboard";
    }
  }

  async function checkUser() {
    const { data } = await supabase.auth.getUser();

    if (!data.user) {
      setMessage("No user logged in.");
      return;
    }

    setMessage(`Logged in as: ${data.user.email}`);
  }

  async function logout() {
    await supabase.auth.signOut();
    setMessage("Logged out.");
  }

  return (
    <main style={{ padding: 40, maxWidth: 500 }}>
      <h1>Nava Strat Login</h1>
      <p>Log in before enabling strict RLS.</p>

      <form onSubmit={login}>
        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ width: "100%", padding: 10 }}
        />

        <br />
        <br />

        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ width: "100%", padding: 10 }}
        />

        <br />
        <br />

        <button type="submit">Login</button>
      </form>

      <br />

      <button onClick={checkUser}>Check Logged In User</button>

      <br />
      <br />

      <button onClick={logout}>Logout</button>

      <br />
      <br />

      {message && (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#f4f4f4",
            padding: 12,
          }}
        >
          {message}
        </pre>
      )}
    </main>
  );
}
