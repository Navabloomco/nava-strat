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
      window.location.href = "/ops/dashboard";
    }
  }

  async function checkUser() {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      setMessage(error.message);
      return;
    }

    if (!data.user) {
      setMessage("No logged-in user found.");
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

      <br />

      <button onClick={checkUser}>Check Logged In User</button>

      <br />
      <br />

      <button onClick={logout}>Logout</button>

      <br />
      <br />

      {message && (
        <pre style={{ background: "#f4f4f4", padding: 12 }}>
          {message}
        </pre>
      )}
    </main>
  );
}
