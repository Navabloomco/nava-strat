"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function RoleManager() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRoles();
  }, []);

  async function fetchRoles() {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_roles")
      .select("*")
      .order("role", { ascending: true });

    if (error) {
      alert(error.message);
    } else {
      setUsers(data || []);
    }
    setLoading(false);
  }

  async function updateRole(id: string, newRole: string) {
    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole })
      .eq("id", id);

    if (error) {
      alert(error.message);
    } else {
      // Local state update for immediate feedback
      setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
    }
  }

  async function toggleActive(id: string, currentState: boolean) {
    const { error } = await supabase
      .from("user_roles")
      .update({ is_active: !currentState })
      .eq("id", id);

    if (error) {
      alert(error.message);
    } else {
      setUsers(users.map(u => u.id === id ? { ...u, is_active: !currentState } : u));
    }
  }

  if (loading) return <div style={{ padding: 40 }}>Loading Team Access...</div>;

  return (
    <div style={containerStyle}>
      <h2 style={headerStyle}>Organization Access Control</h2>
      
      <table style={tableStyle}>
        <thead>
          <tr style={headerRowStyle}>
            <th style={thStyle}>Full Name</th>
            <th style={thStyle}>Email</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={rowStyle}>
              <td style={tdStyle}>{u.full_name || "—"}</td>
              <td style={tdStyle}>{u.email}</td>
              <td style={tdStyle}>
                <select
                  value={u.role}
                  onChange={(e) => updateRole(u.id, e.target.value)}
                  style={selectStyle}
                >
                  <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                  <option value="MANAGEMENT">MANAGEMENT</option>
                  <option value="FINANCE">FINANCE</option>
                  <option value="OPS">OPS</option>
                  <option value="DRIVER">DRIVER</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
              </td>
              <td style={tdStyle}>
                <button 
                  onClick={() => toggleActive(u.id, u.is_active)}
                  style={u.is_active ? activeBtn : inactiveBtn}
                >
                  {u.is_active ? "Active" : "Deactivated"}
                </button>
              </td>
              <td style={tdStyle}>
                <span style={roleBadge(u.role)}>{u.role}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// STYLES
const containerStyle = { background: "#fff", padding: 24, borderRadius: 12, border: "1px solid #e2e8f0", marginTop: 24 };
const headerStyle = { fontSize: 20, fontWeight: "bold", marginBottom: 20, color: "#1e293b" };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const };
const headerRowStyle = { textAlign: "left" as const, borderBottom: "2px solid #f1f5f9" };
const thStyle = { padding: "12px", color: "#64748b", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "0.05em" };
const rowStyle = { borderBottom: "1px solid #f1f5f9" };
const tdStyle = { padding: "16px 12px", fontSize: "14px", color: "#334155" };
const selectStyle = { padding: "6px 8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", outline: "none" };

const activeBtn = { padding: "4px 10px", borderRadius: "6px", fontSize: "12px", border: "none", background: "#dcfce7", color: "#166534", cursor: "pointer" };
const inactiveBtn = { padding: "4px 10px", borderRadius: "6px", fontSize: "12px", border: "none", background: "#fee2e2", color: "#991b1b", cursor: "pointer" };

const roleBadge = (role: string) => ({
  fontSize: "10px",
  fontWeight: "bold" as const,
  padding: "2px 8px",
  borderRadius: "12px",
  backgroundColor: role === "SUPER_ADMIN" ? "#1e293b" : "#f1f5f9",
  color: role === "SUPER_ADMIN" ? "#fff" : "#475569"
});
