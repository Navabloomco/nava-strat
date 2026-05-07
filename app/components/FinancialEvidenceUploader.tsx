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
  const [mpesaCode, setMpesaCode] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [kraInvoiceNumber, setKraInvoiceNumber] = useState("");
  const [kraEtimsSerial, setKraEtimsSerial] = useState("");

  const [uploading, setUploading] = useState(false);

  const isTruckRequired = [
    "FUEL_SLIP",
    "SERVICE",
    "REPAIR",
    "TYRES",
    "PARKING",
    "WEIGHBRIDGE"
  ].includes(documentType);

  const isJourneyRequired = [
    "FUEL_SLIP",
    "POD",
    "DELIVERY_NOTE",
    "WEIGHBRIDGE"
  ].includes(documentType);

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

      if (isTruckRequired && !truckId) {
        alert(`A truck must be selected for ${documentType}`);
        return;
      }

      if (isJourneyRequired && !journeyId) {
        alert(`A journey must be selected for ${documentType}`);
        return;
      }

      setUploading(true);

      const fileExt = selectedFile.name.split(".").pop() || "file";

      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .substring(2)}.${fileExt}`;

      const filePath = `evidence/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("financial-documents")
        .upload(filePath, selectedFile);

      if (uploadError) {
        alert(uploadError.message);
        setUploading(false);
        return;
      }

      const { error: dbError } = await supabase
        .from("financial_documents")
        .insert({
          journey_id: journeyId || null,
          truck_id: truckId || null,

          document_type: documentType,

          file_url: filePath,
          file_name: selectedFile.name,
          mime_type: selectedFile.type,
          file_size: selectedFile.size,

          amount: amount ? Number(amount) : null,
          currency: "KES",

          vendor_name: vendorName || null,
          reference_number: referenceNumber || null,

          mpesa_code: mpesaCode || null,
          cheque_number: chequeNumber || null,
          kra_invoice_number: kraInvoiceNumber || null,
          kra_etims_serial: kraEtimsSerial || null,

          verification_status: "PENDING"
        });

      if (dbError) {
        alert(dbError.message);
        setUploading(false);
        return;
      }

      alert("Evidence uploaded successfully");

      setSelectedFile(null);
      setJourneyId("");
      setTruckId("");
      setDocumentType("RECEIPT");
      setAmount("");
      setVendorName("");
      setReferenceNumber("");
      setMpesaCode("");
      setChequeNumber("");
      setKraInvoiceNumber("");
      setKraEtimsSerial("");

      setUploading(false);
    } catch (err: any) {
      alert(err.message);
      setUploading(false);
    }
  }

  return (
    <div style={boxStyle}>
      <h2>Financial Evidence Upload</h2>

      <div style={fieldStyle}>
        <label>Document / Evidence</label>
        <input
          type="file"
          accept="image/*,.pdf"
          capture="environment"
          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
        />
      </div>

      <div style={fieldStyle}>
        <label>Document Type</label>
        <select
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          style={inputStyle}
        >
          <option value="RECEIPT">Receipt</option>
          <option value="MPESA">M-Pesa</option>
          <option value="CHEQUE">Cheque</option>
          <option value="BANK_TRANSFER">Bank Transfer</option>
          <option value="ETIMS_INVOICE">eTIMS Invoice</option>
          <option value="INVOICE">Invoice</option>
          <option value="POD">Proof of Delivery</option>
          <option value="DELIVERY_NOTE">Delivery Note</option>
          <option value="WEIGHBRIDGE">Weighbridge</option>
          <option value="FUEL_SLIP">Fuel Slip</option>
          <option value="SERVICE">Service</option>
          <option value="REPAIR">Repair</option>
          <option value="TYRES">Tyres</option>
          <option value="SALARY_ADVANCE">Salary Advance</option>
          <option value="OFFICE_EXPENSE">Office Expense</option>
          <option value="PARKING">Parking</option>
          <option value="TOLL">Toll</option>
          <option value="OTHER">Other</option>
        </select>
      </div>

      <div style={fieldStyle}>
        <label>
          Journey {isJourneyRequired ? "(required)" : "(optional)"}
        </label>
        <select
          value={journeyId}
          onChange={(e) => setJourneyId(e.target.value)}
          style={inputStyle}
        >
          <option value="">Select Journey</option>
          {journeys.map((journey) => (
            <option key={journey.id} value={journey.id}>
              {(journey.truck || "NO TRUCK").toUpperCase()} —{" "}
              {(journey.client_name || "NO CLIENT").toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div style={fieldStyle}>
        <label>
          Truck {isTruckRequired ? "(required)" : "(optional)"}
        </label>
        <select
          value={truckId}
          onChange={(e) => setTruckId(e.target.value)}
          style={inputStyle}
        >
          <option value="">Select Truck</option>
          {trucks.map((truck) => (
            <option key={truck.id} value={truck.id}>
              {(truck.truck || "UNKNOWN").toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div style={fieldStyle}>
        <label>Amount</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label>Vendor / Supplier</label>
        <input
          type="text"
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          placeholder="Shell, Total, mechanic, vendor..."
          style={inputStyle}
        />
      </div>

      <div style={fieldStyle}>
        <label>Reference Number</label>
        <input
          type="text"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          placeholder="Receipt No / Invoice No / Reference"
          style={inputStyle}
        />
      </div>

      {documentType === "MPESA" && (
        <div style={fieldStyle}>
          <label>M-Pesa Code</label>
          <input
            type="text"
            value={mpesaCode}
            onChange={(e) => setMpesaCode(e.target.value.toUpperCase())}
            placeholder="Example: TFA123ABC"
            style={inputStyle}
          />
        </div>
      )}

      {documentType === "CHEQUE" && (
        <div style={fieldStyle}>
          <label>Cheque Number</label>
          <input
            type="text"
            value={chequeNumber}
            onChange={(e) => setChequeNumber(e.target.value)}
            placeholder="Cheque number"
            style={inputStyle}
          />
        </div>
      )}

      {documentType === "ETIMS_INVOICE" && (
        <>
          <div style={fieldStyle}>
            <label>KRA Invoice Number</label>
            <input
              type="text"
              value={kraInvoiceNumber}
              onChange={(e) => setKraInvoiceNumber(e.target.value)}
              placeholder="KRA invoice number"
              style={inputStyle}
            />
          </div>

          <div style={fieldStyle}>
            <label>KRA eTIMS Serial</label>
            <input
              type="text"
              value={kraEtimsSerial}
              onChange={(e) => setKraEtimsSerial(e.target.value)}
              placeholder="eTIMS serial"
              style={inputStyle}
            />
          </div>
        </>
      )}

      <button onClick={uploadEvidence} disabled={uploading} style={buttonStyle}>
        {uploading ? "Uploading..." : "Upload Evidence"}
      </button>
    </div>
  );
}

const boxStyle = {
  background: "#fff",
  padding: 24,
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  marginTop: 20
};

const fieldStyle = {
  marginBottom: 16,
  display: "flex",
  flexDirection: "column" as const,
  gap: 6
};

const inputStyle = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid #cbd5e1"
};

const buttonStyle = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "12px 18px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: "bold"
};
