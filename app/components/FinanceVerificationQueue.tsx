"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function FinanceVerificationQueue() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    loadPending();
  }, []);

  async function loadPending() {
    setLoading(true);
    const { data, error } = await supabase
      .from("financial_documents")
      .select(`
        *,
        journeys ( truck, client_name ),
        trucks ( truck )
      `)
      .eq("verification_status", "PENDING")
      .order("created_at", { ascending: true });

    if (error) alert(error.message);
    setDocuments(data || []);
    setLoading(false);
  }

  async function previewDocument(doc: any) {
    setSelectedDoc(doc);
    setSignedUrl(null);

    const { data, error } = await supabase.storage
      .from("financial-documents")
      .createSignedUrl(doc.file_url, 600);

    if (error) {
      alert(error.message);
      return;
    }

    if (data?.signedUrl) {
      setSignedUrl(data.signedUrl);
    }
  }

  async function updateStatus(id: string, status: "APPROVED" | "REJECTED") {
    const { error } = await supabase
      .from("financial_documents")
      .update({
        verification_status: status,
        verified_at: new Date().toISOString(),
        verified_by: "FINANCE_USER"
      })
      .eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    setSelectedDoc(null);
    setSignedUrl(null);
    loadPending();
  }

  if (loading) return <div style={p40}>Loading Pending Audit...</div>;

  return (
    <div style={containerStyle}>
      {/* LEFT COLUMN: THE LIST */}
      <div style={listStyle}>
        <h3 style={headerStyle}>Verification Queue ({documents.length})</h3>
        {documents.length === 0 ? (
          <div style={emptySmall}>No pending financial evidence.</div>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              onClick={() => previewDocument(doc)}
              style={{
                ...cardStyle,
                borderLeft: selectedDoc?.id === doc.id ? "4px solid #2563eb" : "4px solid transparent"
              }}
            >
              <div style={flexBetween}>
                <span style={badgeStyle}>{doc.document_type}</span>
                <span style={dateStyle}>{new Date(doc.created_at).toLocaleDateString()}</span>
              </div>
              <div style={truckName}>
                {(doc.trucks?.truck || doc.journeys?.truck || "GENERAL").toUpperCase()}
              </div>
              <div style={amountStyle}>{Number(doc.amount || 0).toLocaleString()} KES</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{doc.vendor_name || "No vendor"}</div>
            </div>
          ))
        )}
      </div>

      {/* RIGHT COLUMN: THE VIEWER */}
      <div style={viewerStyle}>
        {selectedDoc ? (
          <div style={viewerContent}>
            <div style={imageContainer}>
              {signedUrl ? (
                selectedDoc.mime_type === "application/pdf" ? (
                  <iframe src={signedUrl} style={iframeStyle} title="PDF Preview" />
                ) : (
                  <img src={signedUrl} alt="Evidence" style={imgStyle} />
                )
              ) : (
                <div style={p40}>Generating Secure Link...</div>
              )}
            </div>

            <div style={detailsPanel}>
              <h2 style={detailsHeader}>Document Details</h2>
              <div style={detailGrid}>
                <div style={label}>Type</div><div>{selectedDoc.document_type}</div>
                <div style={label}>Vendor</div><div>{selectedDoc.vendor_name || "N/A"}</div>
                <div style={label}>Amount</div><div>{Number(selectedDoc.amount || 0).toLocaleString()} KES</div>
                <div style={label}>Ref No</div><div>{selectedDoc.reference_number || "N/A"}</div>
                {selectedDoc.mpesa_code && (
                  <><div style={label}>M-Pesa</div><div style={{ color: "#059669", fontWeight: "bold" }}>{selectedDoc.mpesa_code}</div></>
                )}
                <div style={label}>Description</div><div style={{ fontSize: 12 }}>{selectedDoc.description || "No description"}</div>
              </div>

              <div style={actionArea}>
                <button onClick={() => updateStatus(selectedDoc.id, "REJECTED")} style={rejectBtn}>REJECT</button>
                <button onClick={() => updateStatus(selectedDoc.id, "APPROVED")} style={approveBtn}>APPROVE & VERIFY</button>
              </div>
            </div>
          </div>
        ) : (
          <div style={emptyState}>Select a document to begin audit</div>
        )}
      </div>
    </div>
  );
}

// STYLES
const containerStyle = { display: "flex", height: "80vh", gap: 20, padding: 20, backgroundColor: "#f8fafc", marginTop: 24 };
const listStyle = { width: 350, overflowY: "auto" as const, display: "flex", flexDirection: "column" as const, gap: 10 };
const viewerStyle = { flex: 1, backgroundColor: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" };
const cardStyle = { padding: 15, backgroundColor: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", cursor: "pointer" };
const viewerContent = { display: "flex", flexDirection: "column" as const, height: "100%" };
const imageContainer = { flex: 1, backgroundColor: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" };
const detailsPanel = { padding: 24, borderTop: "1px solid #e2e8f0" };
const detailGrid = { display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, marginBottom: 20 };
const imgStyle = { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" as const };
const iframeStyle = { width: "100%", height: "100%", border: "none" };
const actionArea = { display: "flex", gap: 15 };
const approveBtn = { flex: 1, padding: "12px", backgroundColor: "#059669", color: "#fff", border: "none", borderRadius: 8, fontWeight: "bold", cursor: "pointer" };
const rejectBtn = { padding: "12px 24px", backgroundColor: "#fff", color: "#dc2626", border: "1px solid #dc2626", borderRadius: 8, fontWeight: "bold", cursor: "pointer" };
const p40 = { padding: 40, textAlign: "center" as const };
const headerStyle = { fontSize: 16, fontWeight: "bold", color: "#475569" };
const flexBetween = { display: "flex", justifyContent: "space-between", marginBottom: 8 };
const badgeStyle = { fontSize: 10, fontWeight: "bold", padding: "2px 6px", backgroundColor: "#f1f5f9", borderRadius: 4 };
const dateStyle = { fontSize: 11, color: "#94a3b8" };
const truckName = { fontWeight: "bold", fontSize: 15 };
const amountStyle = { fontSize: 18, fontWeight: "bold", color: "#1e293b", marginTop: 5 };
const label = { color: "#64748b", fontSize: 12, fontWeight: "bold" };
const detailsHeader = { fontSize: 18, fontWeight: "bold", marginBottom: 15 };
const emptyState = { display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "#94a3b8" };
const emptySmall = { padding: 20, color: "#94a3b8", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" };
