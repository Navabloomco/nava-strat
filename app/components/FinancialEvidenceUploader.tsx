"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function FinancialEvidenceUploader() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [journeyId, setJourneyId] = useState("");
  const [truckId, setTruckId] = useState("");

  const [documentType, setDocumentType] = useState("RECEIPT");

  const [amount, setAmount] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");

  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: journeysData } = await supabase
      .from("journeys")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: trucksData } = await supabase
      .from("trucks")
      .select("*")
      .order("created_at", { ascending: false });

    setJourneys(journeysData || []);
    setTrucks(trucksData || []);
  }

  async function uploadEvidence() {
    try {
      if (!selectedFile) {
        alert("Please select a file");
        return;
      }

      setUploading(true);

      // ============================================
      // CREATE UNIQUE FILE NAME
      // ============================================
      const fileExt = selectedFile.name.split(".").pop();

      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .substring(2)}.${fileExt}`;

      const filePath = `evidence/${fileName}`;

      // ============================================
      // UPLOAD TO STORAGE
      // ============================================
      const { error: uploadError } = await supabase.storage
        .from("financial-documents")
        .upload(filePath, selectedFile);

      if (uploadError) {
        console.error(uploadError);
        alert(uploadError.message);
        setUploading(false);
        return;
      }

      // ============================================
      // SAVE DATABASE RECORD
      // ============================================
      const { error: dbError } = await supabase
        .from("financial_documents")
        .insert({
          journey_id: journeyId || null,
          truck_id: truckId || null,

          document_type: documentType,

          file_url: filePath,

          amount: amount ? Number(amount) : null,

          vendor_name: vendorName || null,

          reference_number: referenceNumber || null,

          verification_status: "PENDING"
        });

      if (dbError) {
        console.error(dbError);
        alert(dbError.message);
        setUploading(false);
        return;
      }

      // ============================================
      // SUCCESS RESET
      // ============================================
      alert("Evidence uploaded successfully");

      setSelectedFile(null);

      setJourneyId("");
      setTruckId("");

      setDocumentType("RECEIPT");

      setAmount("");
      setVendorName("");
      setReferenceNumber("");

      setUploading(false);

    } catch (err: any) {
      console.error(err);
      alert(err.message);
      setUploading(false);
    }
  }

  return (
    <div
      style={{
        background: "#fff",
        padding: 24,
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        marginTop: 20
      }}
    >
      <h2 style={{ marginBottom: 20 }}>
        Financial Evidence Upload
      </h2>

      {/* FILE */}
      <div style={{ marginBottom: 16 }}>
        <label>Document / Receipt</label>

        <input
          type="file"
          accept="image/*,.pdf"
          capture="environment"
          onChange={(e) =>
            setSelectedFile(
              e.target.files?.[0] || null
            )
          }
        />
      </div>

      {/* DOCUMENT TYPE */}
      <div style={{ marginBottom: 16 }}>
        <label>Document Type</label>

        <select
          value={documentType}
          onChange={(e) =>
            setDocumentType(e.target.value)
          }
          style={inputStyle}
        >
          <option value="RECEIPT">Receipt</option>
          <option value="MPESA">M-Pesa</option>
          <option value="CHEQUE">Cheque</option>
          <option value="BANK_TRANSFER">Bank Transfer</option>
          <option value="ETIMS_INVOICE">eTIMS Invoice</option>
          <option value="POD">Proof of Delivery</option>
          <option value="DELIVERY_NOTE">Delivery Note</option>
          <option value="WEIGHBRIDGE">Weighbridge</option>
          <option value="FUEL_SLIP">Fuel Slip</option>
          <option value="OTHER">Other</option>
        </select>
      </div>

      {/* JOURNEY */}
      <div style={{ marginBottom: 16 }}>
        <label>Journey</label>

        <select
          value={journeyId}
          onChange={(e) =>
            setJourneyId(e.target.value)
          }
          style={inputStyle}
        >
          <option value="">Select Journey</option>

          {journeys.map((journey) => (
            <option
              key={journey.id}
              value={journey.id}
            >
              {(journey.truck || "NO TRUCK").toUpperCase()}
              {" — "}
              {(journey.client_name || "NO CLIENT").toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* TRUCK */}
      <div style={{ marginBottom: 16 }}>
        <label>Truck</label>

        <select
          value={truckId}
          onChange={(e) =>
            setTruckId(e.target.value)
          }
          style={inputStyle}
        >
          <option value="">Select Truck</option>

          {trucks.map((truck) => (
            <option
              key={truck.id}
              value={truck.id}
            >
              {(truck.truck || "UNKNOWN").toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* AMOUNT */}
      <div style={{ marginBottom: 16 }}>
        <label>Amount</label>

        <input
          type="number"
          value={amount}
          onChange={(e) =>
            setAmount(e.target.value)
          }
          placeholder="0.00"
          style={inputStyle}
        />
      </div>

      {/* VENDOR */}
      <div style={{ marginBottom: 16 }}>
        <label>Vendor / Supplier</label>

        <input
          type="text"
          value={vendorName}
          onChange={(e) =>
            setVendorName(e.target.value)
          }
          placeholder="Shell, Total, Vendor..."
          style={inputStyle}
        />
      </div>

      {/* REFERENCE */}
      <div style={{ marginBottom: 16 }}>
        <label>Reference Number</label>

        <input
          type="text"
          value={referenceNumber}
          onChange={(e) =>
            setReferenceNumber(e.target.value)
          }
          placeholder="Receipt No / M-Pesa Code"
          style={inputStyle}
        />
      </div>

      <button
        onClick={uploadEvidence}
        disabled={uploading}
        style={{
          background: "#2563eb",
          color: "#fff",
          border: "none",
          padding: "12px 18px",
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: "bold"
        }}
      >
        {uploading
          ? "Uploading..."
          : "Upload Evidence"}
      </button>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: 10,
  marginTop: 6,
  borderRadius: 8,
  border: "1px solid #cbd5e1"
};
