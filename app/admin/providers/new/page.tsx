"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";

function companyIdFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("companyId") || "";
}

function companyQuery(companyId: string) {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
}

type CredentialField = {
  name: "username" | "api_key" | "password" | "bearer_token";
  label: string;
  secret: boolean;
};

const REQUEST_SETUP_OPTION = "__request_provider_setup__";
const CUSTOM_API_OPTION = "__custom_api_provider__";
const KNOWN_LOGIN_ENDPOINTS = ["/auth/login", "/login"] as const;
const KNOWN_FLEET_ENDPOINTS = [
  "/get_devices",
  "/devices",
  "/vehicles",
  "/fleet",
  "/get_reports",
] as const;
const CONNECT_PROGRESS_DEFINITIONS = [
  { id: "prepare", label: "Checking secure connection" },
  { id: "login", label: "Signing in" },
  { id: "token", label: "Confirming access" },
  { id: "fleet", label: "Finding vehicles" },
  { id: "rows", label: "Matching trucks" },
  { id: "mapping", label: "Checking location fields" },
  { id: "capability", label: "Checking signal quality" },
  { id: "create", label: "Creating inactive provider" },
  { id: "ready", label: "Ready for review" },
] as const;

type ProgressStepState =
  | "waiting"
  | "running"
  | "success"
  | "warning"
  | "failed"
  | "skipped";

type ProgressStep = {
  id: string;
  label: string;
  state: ProgressStepState;
  detail: string;
};

const INITIAL_CUSTOM_PROVIDER_FORM = {
  provider_name: "",
  provider_website: "",
  base_url: "",
  provider_notes: "",
  provider_timezone: "Africa/Nairobi",
  auth_method: "api_key_header",
  login_credential_placement: "json_body",
  api_key_header: "x-api-key",
  api_key: "",
  bearer_token: "",
  username: "",
  password: "",
  login_url: "",
  login_token_path: "",
  login_username_field: "username",
  login_secret_field: "password",
  endpoint_url: "",
  fleet_token_placement: "authorization_bearer",
  http_method: "GET",
  row_path: "",
  request_body: "",
  vehicle_field: "",
  latitude_field: "",
  longitude_field: "",
  timestamp_field: "",
  speed_field: "",
  location_label_field: "",
  fuel_level_field: "",
  ignition_field: "",
  rpm_field: "",
  odometer_field: "",
  capability_declaration: "not_sure",
};

export default function NewProviderPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [company, setCompany] = useState<any>(null);
  const [capabilities, setCapabilities] = useState<any>({
    can_add_provider: false,
    can_edit_advanced_provider_config: false,
  });
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSaving, setRequestSaving] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState(false);
  const [requestError, setRequestError] = useState("");

  const [form, setForm] = useState({
    username: "",
    api_key: "",
    password: "",
    bearer_token: "",
  });
  const [requestForm, setRequestForm] = useState({
    provider_name: "",
    provider_website: "",
    provider_contact: "",
    access_type_known: "unsure",
    notes: "",
  });
  const [customForm, setCustomForm] = useState(INITIAL_CUSTOM_PROVIDER_FORM);
  const [detectResults, setDetectResults] = useState<Record<string, any>>({});
  const [testingEndpoint, setTestingEndpoint] = useState("");
  const [connectSteps, setConnectSteps] = useState<ProgressStep[]>(
    createInitialConnectSteps
  );
  const [connectRunning, setConnectRunning] = useState(false);
  const [connectedProviderId, setConnectedProviderId] = useState("");

  useEffect(() => {
    const companyId = companyIdFromLocation();
    setSelectedCompanyId(companyId);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("request") === "1") {
        setRequestOpen(true);
      }
    }
    loadWizardData(companyId);
  }, []);

  async function loadWizardData(companyId = "") {
    setLoadError("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    try {
      const [templateRes, providerRes] = await Promise.all([
        fetch("/api/providers/templates", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
        fetch(`/api/providers${companyQuery(companyId)}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
      ]);
      const templateData = await templateRes.json();
      const providerData = await providerRes.json();

      if (!templateRes.ok || !templateData.success) {
        throw new Error(templateData.error || "Failed to load provider templates");
      }

      if (!providerRes.ok || !providerData.success) {
        throw new Error(providerData.error || "Failed to load provider access");
      }

      setTemplates(templateData.templates || []);
      setCapabilities(providerData.capabilities || {});
      setCompany(providerData.company || null);
      setIsPlatformOwner(Boolean(providerData.is_platform_owner));
    } catch (err: any) {
      setLoadError(err.message || "Failed to load provider templates");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const requestSetupSelected = selectedTemplateId === REQUEST_SETUP_OPTION;
  const customApiSelected = selectedTemplateId === CUSTOM_API_OPTION;
  const publicTemplates = templates.filter((template) => !template.internal_template);
  const internalTemplates = templates.filter((template) => template.internal_template);
  const searchedPublicTemplates = filterTemplates(publicTemplates, providerSearch);
  const searchedInternalTemplates = filterTemplates(internalTemplates, providerSearch);
  const selectedTemplateIsSetupOnly = Boolean(
    selectedTemplate?.setup_only || selectedTemplate?.fleet_config?.setup_only
  );
  const requiredCredentialFields: CredentialField[] = selectedTemplate
    ? selectedTemplateIsSetupOnly
      ? []
      : getCredentialFields(selectedTemplate)
    : [];

  function originFromUrl(url: string | null) {
    if (!url) return "";
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  }

  async function handleCreateProvider() {
    if (customApiSelected) {
      await handleCreateCustomProvider();
      return;
    }

    if (!selectedTemplate) {
      alert("Choose a supported provider first.");
      return;
    }

    const missingCredential = requiredCredentialFields.find(
      (field: CredentialField) => !String(form[field.name] || "").trim()
    );

    if (missingCredential) {
      alert(`${missingCredential.label} is required.`);
      return;
    }

    const canUseAdvancedTemplateConfig = Boolean(
      capabilities.can_edit_advanced_provider_config
    );
    let createPayload: Record<string, any>;

    if (canUseAdvancedTemplateConfig) {
      const loginUrl =
        selectedTemplate.default_login_url ||
        selectedTemplate.auth_config?.login_url ||
        null;

      const fleetUrl =
        selectedTemplate.default_fleet_url ||
        selectedTemplate.fleet_config?.fleet_url ||
        null;
      const baseUrl =
        selectedTemplate.base_url ||
        selectedTemplate.default_base_url ||
        selectedTemplate.auth_config?.base_url ||
        selectedTemplate.fleet_config?.base_url ||
        originFromUrl(fleetUrl);

      if (!loginUrl) {
        alert("Provider setup is incomplete. Please request support.");
        return;
      }

      if (!fleetUrl) {
        alert("Provider setup is incomplete. Please request support.");
        return;
      }

      createPayload = {
        template_id: selectedTemplate.id,
        provider_name: selectedTemplate.display_name,
        name: selectedTemplate.display_name,
        provider_slug: selectedTemplate.slug,
        provider_type: selectedTemplate.slug,

        auth_type: selectedTemplate.auth_type,
        auth_config: selectedTemplate.auth_config,
        fleet_config: selectedTemplate.fleet_config,
        field_mapping: selectedTemplate.field_mapping,
        capability_profile:
          selectedTemplate.capability_profile ||
          selectedTemplate.fleet_config?.capability_profile ||
          {},
        supported_signals:
          selectedTemplate.supported_signals ||
          selectedTemplate.fleet_config?.supported_signals ||
          {},
        provider_timezone:
          selectedTemplate.provider_timezone ||
          selectedTemplate.fleet_config?.provider_timezone ||
          "Africa/Nairobi",
        source_signal_notes: selectedTemplate.source_signal_notes || {},

        username: form.username,
        api_key: form.api_key,
        password: form.password || null,
        bearer_token: form.bearer_token || null,

        base_url: baseUrl,
        login_url: loginUrl,
        fleet_url: fleetUrl,

        is_active: false,
        ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
      };
    } else {
      createPayload = {
        template_id: selectedTemplate.id,
        username: form.username,
        api_key: form.api_key,
        password: form.password || null,
        bearer_token: form.bearer_token || null,
        is_active: false,
        ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
      };
    }

    setSaving(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      alert("Session expired. Please log in again.");
      setSaving(false);
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/providers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createPayload),
    });
    const data = await res.json();

    setSaving(false);

    if (!res.ok || !data.success) {
      alert(`Provider creation failed: ${data.error || "Unknown error"}`);
      return;
    }

    alert("Provider added inactive. Test the connection before activating sync.");
    window.location.href = `/admin/providers${companyQuery(selectedCompanyId)}`;
  }

  function updateCustomForm(patch: Record<string, string>) {
    setCustomForm((current) => ({ ...current, ...patch }));
  }

  function resetConnectProgress() {
    setConnectedProviderId("");
    setConnectSteps(createInitialConnectSteps());
  }

  function updateConnectStep(
    id: string,
    state: ProgressStepState,
    detail = ""
  ) {
    setConnectSteps((steps) =>
      steps.map((step) =>
        step.id === id ? { ...step, state, detail } : step
      )
    );
  }

  function applyProgressUpdates(
    updates: Record<string, { state: ProgressStepState; detail?: string }>
  ) {
    setConnectSteps((steps) =>
      steps.map((step) => {
        const update = updates[step.id];
        return update
          ? { ...step, state: update.state, detail: update.detail || "" }
          : step;
      })
    );
  }

  function handleBaseUrlBlur() {
    const split = normalizeProviderBaseInput(customForm.base_url);
    const patch: Record<string, string> = { base_url: split.baseUrl };

    if (split.endpointKind === "login" && split.endpointUrl) {
      patch.login_url = customForm.login_url.trim() || split.endpointUrl;
    }
    if (split.endpointKind === "fleet" && split.endpointUrl) {
      patch.endpoint_url = customForm.endpoint_url.trim() || split.endpointUrl;
    }
    if (split.fleetTrackLike) {
      Object.assign(patch, buildLoginTokenSetupPatch(split.baseUrl, customForm));
    }

    updateCustomForm(patch);
  }

  function buildCustomProviderCreateBody(
    formInput: typeof INITIAL_CUSTOM_PROVIDER_FORM
  ) {
    return {
      provider_mode: "custom_api",
      custom_provider: {
        provider_name: formInput.provider_name.trim(),
        provider_website: formInput.provider_website.trim() || null,
        base_url: normalizeBaseUrl(formInput.base_url),
        provider_notes: formInput.provider_notes.trim() || null,
        provider_timezone:
          formInput.provider_timezone.trim() || "Africa/Nairobi",
        auth_method: formInput.auth_method,
        login_credential_placement: formInput.login_credential_placement,
        api_key_header: formInput.api_key_header.trim() || "x-api-key",
        api_key: formInput.api_key,
        bearer_token: formInput.bearer_token,
        username: formInput.username,
        password: formInput.password,
        login_url: formInput.login_url.trim(),
        login_token_path: formInput.login_token_path.trim(),
        login_username_field:
          formInput.login_username_field.trim() || "username",
        login_secret_field:
          formInput.login_secret_field.trim() || "password",
        endpoint_url: formInput.endpoint_url.trim(),
        fleet_token_placement: formInput.fleet_token_placement,
        http_method: formInput.http_method,
        row_path: formInput.row_path.trim(),
        request_body: formInput.request_body.trim(),
        field_mapping: {
          truck: formInput.vehicle_field.trim(),
          latitude: formInput.latitude_field.trim(),
          longitude: formInput.longitude_field.trim(),
          recorded_at: formInput.timestamp_field.trim(),
          speed: formInput.speed_field.trim(),
          location_label: formInput.location_label_field.trim(),
          fuel_level: formInput.fuel_level_field.trim(),
          ignition_on: formInput.ignition_field.trim(),
          engine_rpm: formInput.rpm_field.trim(),
          odometer: formInput.odometer_field.trim(),
        },
        capability_declaration: formInput.capability_declaration,
      },
      is_active: false,
      ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
    };
  }

  async function createCustomProviderRecord(
    formInput: typeof INITIAL_CUSTOM_PROVIDER_FORM,
    redirectAfterCreate: boolean
  ) {
    const validationError = validateCustomProviderForm(formInput);
    if (validationError) {
      throw new Error(validationError);
    }

    setSaving(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setSaving(false);
      window.location.href = "/login";
      throw new Error("Session expired. Please log in again.");
    }

    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildCustomProviderCreateBody(formInput)),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Provider creation failed");
      }

      if (redirectAfterCreate) {
        alert("Custom provider added inactive. Test the connection before activating sync.");
        window.location.href = `/admin/providers${companyQuery(selectedCompanyId)}`;
      }

      return data;
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCustomProvider() {
    try {
      await createCustomProviderRecord(customForm, true);
    } catch (err: any) {
      alert(`Provider creation failed: ${err.message || "Unknown error"}`);
    }
  }

  async function handleTestCustomEndpoint(target: "login" | "fleet") {
    const url =
      target === "login"
        ? customForm.login_url.trim()
        : customForm.endpoint_url.trim();
    if (!url) {
      alert(
        target === "login"
          ? "Login endpoint URL is required."
          : "Fleet/current location endpoint URL is required."
      );
      return;
    }

    setTestingEndpoint(target);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      alert("Session expired. Please log in again.");
      setTestingEndpoint("");
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/providers/test-endpoint", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
          mode: target,
          url,
          method: target === "login" ? "POST" : customForm.http_method,
          auth_method: target === "login" ? "post_login" : customForm.auth_method,
          api_key_header: customForm.api_key_header.trim() || "x-api-key",
          api_key: customForm.api_key,
          bearer_token: customForm.bearer_token,
          username: customForm.username,
          password: customForm.password,
          login_url: customForm.login_url.trim(),
          login_token_path: customForm.login_token_path.trim(),
          login_credential_placement: customForm.login_credential_placement,
          login_username_field:
            customForm.login_username_field.trim() || "username",
          login_secret_field:
            customForm.login_secret_field.trim() || "password",
          request_body: target === "fleet" ? customForm.request_body.trim() : "",
        }),
      });
      const data = await res.json();
      setDetectResults((current) => ({
        ...current,
        [target]: res.ok && data.success ? data : { error: data.error || "Endpoint test failed" },
      }));
    } catch (err: any) {
      setDetectResults((current) => ({
        ...current,
        [target]: { error: err.message || "Endpoint test failed" },
      }));
    } finally {
      setTestingEndpoint("");
    }
  }

  function applyEndpointDetection(target: "login" | "fleet") {
    const result = detectResults[target];
    if (!result || result.error) return;

    if (target === "login") {
      const tokenPath = result.token_like_paths?.[0];
      if (tokenPath) updateCustomForm({ login_token_path: tokenPath });
      return;
    }

    const suggestions = result.field_mapping_suggestions || {};
    const patch: Record<string, string> = {};
    if (result.row_path_suggestions?.[0]) {
      patch.row_path = result.row_path_suggestions[0];
    }
    if (suggestions.truck || suggestions.vehicle) {
      patch.vehicle_field = suggestions.truck || suggestions.vehicle;
    }
    if (suggestions.latitude) patch.latitude_field = suggestions.latitude;
    if (suggestions.longitude) patch.longitude_field = suggestions.longitude;
    if (suggestions.recorded_at || suggestions.timestamp) {
      patch.timestamp_field = suggestions.recorded_at || suggestions.timestamp;
    }
    if (suggestions.speed) patch.speed_field = suggestions.speed;
    if (suggestions.location_label) patch.location_label_field = suggestions.location_label;
    if (suggestions.fuel_level) patch.fuel_level_field = suggestions.fuel_level;
    if (suggestions.ignition_on || suggestions.ignition) {
      patch.ignition_field = suggestions.ignition_on || suggestions.ignition;
    }
    if (suggestions.engine_rpm) patch.rpm_field = suggestions.engine_rpm;
    if (suggestions.odometer_km || suggestions.odometer) {
      patch.odometer_field = suggestions.odometer_km || suggestions.odometer;
    }
    updateCustomForm(patch);
  }

  function handleAutoFillCustomProvider() {
    const split = normalizeProviderBaseInput(customForm.base_url);
    const baseUrl = split.baseUrl;
    if (!baseUrl) {
      alert("Enter a provider base URL first.");
      return;
    }
    const fleetTrackLike = split.fleetTrackLike || isFleetTrackLike(customForm, baseUrl);
    const hasLoginCredentials = Boolean(
      customForm.username.trim() && customForm.password.trim()
    );
    const hasApiToken = Boolean(
      customForm.api_key.trim() || customForm.bearer_token.trim()
    );
    const patch: Record<string, string> = {
      base_url: baseUrl,
      provider_timezone: customForm.provider_timezone || "Africa/Nairobi",
    };

    if (split.endpointKind === "login" && split.endpointUrl) {
      patch.login_url = customForm.login_url.trim() || split.endpointUrl;
    }
    if (split.endpointKind === "fleet" && split.endpointUrl) {
      patch.endpoint_url = customForm.endpoint_url.trim() || split.endpointUrl;
    }

    if (fleetTrackLike) {
      Object.assign(patch, buildLoginTokenSetupPatch(baseUrl, customForm));
    } else if (hasApiToken) {
      patch.auth_method = customForm.bearer_token.trim()
        ? "bearer_token"
        : "api_key_header";
    } else if (hasLoginCredentials || customForm.auth_method === "post_login") {
      Object.assign(patch, {
        auth_method: "post_login",
        login_url: customForm.login_url.trim() || `${baseUrl}/login`,
        login_token_path: customForm.login_token_path.trim() || "token",
        login_username_field:
          customForm.login_username_field.trim() || "username",
        login_secret_field:
          customForm.login_secret_field.trim() || "password",
        login_credential_placement:
          customForm.login_credential_placement || "json_body",
      });
    }

    if (!customForm.endpoint_url.trim()) {
      patch.endpoint_url = fleetTrackLike
        ? `${baseUrl}/get_devices?lang=en&user_api_hash={{user_api_hash}}`
        : `${baseUrl}/get_devices`;
    }
    patch.http_method = customForm.http_method || "GET";
    patch.row_path = customForm.row_path.trim() || "data";

    patch.fleet_token_placement = fleetTrackLike
      ? "query_user_api_hash"
      : customForm.fleet_token_placement || "authorization_bearer";

    updateCustomForm(patch);
  }

  function handleUseLoginTokenSetup() {
    const split = normalizeProviderBaseInput(customForm.base_url);
    if (!split.baseUrl) {
      alert("Enter a provider base URL first.");
      return;
    }
    updateCustomForm({
      base_url: split.baseUrl,
      ...buildLoginTokenSetupPatch(split.baseUrl, customForm, true),
    });
  }

  async function handleAutoTestCustomProvider() {
    try {
      await runCustomAutoTest(customForm, true);
    } catch {
      // The progress runner and result panel already show the actionable error.
    }
  }

  async function runCustomAutoTest(
    formInput: typeof INITIAL_CUSTOM_PROVIDER_FORM,
    showProgress: boolean
  ) {
    const split = normalizeProviderBaseInput(formInput.base_url);
    const baseUrl = split.baseUrl;
    if (!baseUrl) {
      if (showProgress) {
        resetConnectProgress();
        updateConnectStep("prepare", "failed", "Enter the provider API link first.");
      } else {
        alert("Enter a provider base URL first.");
      }
      throw new Error("Enter the provider API link first.");
    }

    if (showProgress) {
      resetConnectProgress();
      updateConnectStep("prepare", "running", "Checking the provider link safely.");
      updateConnectStep("prepare", "success", "Secure check prepared.");
      if (formInput.auth_method === "post_login") {
        updateConnectStep("login", "running", "Signing in with the supplied access details.");
        updateConnectStep("token", "running", "Confirming access without showing secrets.");
      } else {
        updateConnectStep("login", "skipped", "Using the supplied key/password.");
        updateConnectStep("token", "skipped", "No separate sign-in step needed.");
      }
      updateConnectStep("fleet", "running", "Looking for vehicles.");
    }

    if (
      formInput.auth_method === "post_login" &&
      (!formInput.username.trim() || !formInput.password.trim())
    ) {
      if (showProgress) {
        applyProgressUpdates({
          login: {
            state: "failed",
            detail: "Login failed. Check email/password.",
          },
          token: { state: "skipped", detail: "Access was not checked because sign-in failed." },
          fleet: { state: "skipped", detail: "Vehicle search was not attempted." },
          rows: { state: "skipped", detail: "Truck matching was not attempted." },
          mapping: { state: "skipped", detail: "Location fields were not checked." },
          capability: { state: "skipped", detail: "Signal quality was not checked." },
          create: { state: "skipped", detail: "Provider was not created." },
          ready: { state: "skipped", detail: "Review is not ready yet." },
        });
      }
      throw new Error("Login failed. Check email/password.");
    }

    setTestingEndpoint("auto");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setTestingEndpoint("");
      window.location.href = "/login";
      throw new Error("Session expired. Please log in again.");
    }

    try {
      const res = await fetch("/api/providers/test-endpoint", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
          mode: "auto_setup",
          base_url: baseUrl,
          provider_name: formInput.provider_name.trim(),
          provider_website: formInput.provider_website.trim(),
          provider_notes: [
            formInput.provider_notes.trim(),
            formInput.login_url.trim(),
            formInput.endpoint_url.trim(),
          ].filter(Boolean).join("\n"),
          auth_method: formInput.auth_method,
          api_key_header: formInput.api_key_header.trim() || "x-api-key",
          api_key: formInput.api_key,
          bearer_token: formInput.bearer_token,
          username: formInput.username,
          password: formInput.password,
        }),
      });
      const data = await res.json();
      const result = res.ok && data.success
        ? data
        : { error: data.error || "Auto-test failed" };
      setDetectResults((current) => ({
        ...current,
        auto: result,
      }));
      if (showProgress) {
        applyAutoTestProgress(result, formInput);
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Auto-test failed");
      }
      return data;
    } catch (err: any) {
      const result = { error: err.message || "Auto-test failed" };
      setDetectResults((current) => ({
        ...current,
        auto: result,
      }));
      if (showProgress) {
        applyAutoTestProgress(result, formInput);
      }
      throw err;
    } finally {
      setTestingEndpoint("");
    }
  }

  function applyAutoDetection() {
    const result = detectResults.auto;
    if (!result || result.error) return;

    updateCustomForm(buildAutoDetectionPatch(result, customForm));
  }

  function applyAutoTestProgress(
    result: any,
    formInput: typeof INITIAL_CUSTOM_PROVIDER_FORM
  ) {
    if (result?.error) {
      applyProgressUpdates({
        prepare: {
          state: "failed",
          detail: setupFixMessage(result),
        },
        login: { state: "skipped", detail: "Stopped before sign-in." },
        token: { state: "skipped", detail: "Stopped before access confirmation." },
        fleet: { state: "skipped", detail: "Vehicle search was not attempted." },
        rows: { state: "skipped", detail: "Truck matching was not attempted." },
        mapping: { state: "skipped", detail: "Location fields were not checked." },
        capability: { state: "skipped", detail: "Signal quality was not checked." },
        create: { state: "skipped", detail: "Provider was not created." },
        ready: { state: "skipped", detail: "Review is not ready yet." },
      });
      return;
    }

    const suggestions = result?.fleet?.field_mapping_suggestions || {};
    const coreFields = [
      suggestions.truck || suggestions.vehicle ? "vehicle" : "",
      suggestions.latitude ? "latitude" : "",
      suggestions.longitude ? "longitude" : "",
      suggestions.recorded_at || suggestions.timestamp ? "timestamp" : "",
    ].filter(Boolean);
    const blockers = result?.setup_blockers || [];
    const authIsLogin = formInput.auth_method === "post_login";
    const loginNeedsSwitch =
      !authIsLogin && result.suggested_auth_method === "post_login";
    const loginFailed = authIsLogin && result.failure_stage === "login";
    const tokenFailed = authIsLogin && result.failure_stage === "token";

    if (loginFailed) {
      applyProgressUpdates({
        login: {
          state: "failed",
          detail:
            setupFixMessage({ setup_blockers: blockers }) ||
            "Login failed. Check email/password.",
        },
        token: { state: "skipped", detail: "Access was not checked because sign-in failed." },
        fleet: { state: "skipped", detail: "Vehicle search was not attempted." },
        rows: { state: "skipped", detail: "Truck matching was not attempted." },
        mapping: { state: "skipped", detail: "Location fields were not checked." },
        capability: { state: "skipped", detail: "Signal quality was not checked." },
        create: { state: "skipped", detail: "Provider was not created." },
        ready: { state: "skipped", detail: "Review is not ready yet." },
      });
      return;
    }

    if (tokenFailed) {
      applyProgressUpdates({
        login: { state: "success", detail: "Sign-in accepted." },
        token: {
          state: "failed",
          detail: "Access token was not found. Ask the provider which token or hash field to use.",
        },
        fleet: { state: "skipped", detail: "Vehicle search was not attempted." },
        rows: { state: "skipped", detail: "Truck matching was not attempted." },
        mapping: { state: "skipped", detail: "Location fields were not checked." },
        capability: { state: "skipped", detail: "Signal quality was not checked." },
        create: { state: "skipped", detail: "Provider was not created." },
        ready: { state: "skipped", detail: "Review is not ready yet." },
      });
      return;
    }

    if (loginNeedsSwitch && !result.fleet) {
      applyProgressUpdates({
        login: {
          state: "warning",
          detail: "This looks like an email/password provider.",
        },
        token: {
          state: "skipped",
          detail: "Switch to the sign-in setup before checking access.",
        },
        fleet: {
          state: "failed",
          detail: setupFixMessage({ setup_blockers: blockers }),
        },
        rows: { state: "skipped", detail: "Truck matching was not attempted." },
        mapping: { state: "skipped", detail: "Location fields were not checked." },
        capability: { state: "skipped", detail: "Signal quality was not checked." },
        create: { state: "skipped", detail: "Provider was not created." },
        ready: { state: "skipped", detail: "Review is not ready yet." },
      });
      return;
    }

    if (!result.fleet) {
      applyProgressUpdates({
        login: {
          state: authIsLogin ? "success" : "skipped",
          detail: authIsLogin ? "Sign-in accepted." : "No separate sign-in step needed.",
        },
        token: {
          state: authIsLogin ? "success" : "skipped",
          detail: authIsLogin ? "Access confirmed." : "Using the supplied API key or public access.",
        },
        fleet: {
          state: "failed",
          detail: setupFixMessage({ setup_blockers: blockers }),
        },
        rows: { state: "skipped", detail: "Truck matching was not attempted." },
        mapping: { state: "skipped", detail: "Location fields were not checked." },
        capability: { state: "skipped", detail: "Signal quality was not checked." },
        create: { state: "skipped", detail: "Provider was not created." },
        ready: { state: "skipped", detail: "Review is not ready yet." },
      });
      return;
    }

    if (coreFields.length < 4) {
      applyProgressUpdates({
        login: {
          state: authIsLogin ? "success" : "skipped",
          detail: authIsLogin ? "Sign-in accepted." : "No separate sign-in step needed.",
        },
        token: {
          state: authIsLogin ? "success" : "skipped",
          detail: authIsLogin ? "Access confirmed." : "Using the supplied API key or public access.",
        },
        fleet: { state: "success", detail: "Vehicle list found." },
        rows: {
          state: result.fleet.detected_vehicle_count ? "success" : "failed",
          detail: result.fleet.detected_vehicle_count
            ? `Vehicles found: ${result.fleet.detected_vehicle_count}.`
            : "No vehicles were found.",
        },
        mapping: {
          state: "failed",
          detail: "Vehicles were found, but required location fields were missing.",
        },
        capability: { state: "skipped", detail: "Signal quality was not checked." },
        create: { state: "skipped", detail: "Provider was not created." },
        ready: { state: "skipped", detail: "Review is not ready yet." },
      });
      return;
    }

    applyProgressUpdates({
      login: {
        state: authIsLogin ? "success" : "skipped",
        detail: authIsLogin ? "Sign-in accepted." : "No separate sign-in step needed.",
      },
      token: {
        state: authIsLogin ? "success" : "skipped",
        detail: authIsLogin
          ? "Access confirmed."
          : "Using the supplied API key or public access.",
      },
      fleet: {
        state: "success",
        detail: "Vehicle list found.",
      },
      rows: {
        state: "success",
        detail: `Vehicles found: ${result.fleet.detected_vehicle_count}.`,
      },
      mapping: {
        state: "success",
        detail: "Location tracking fields found.",
      },
      capability: {
        state: "success",
        detail: "Signal quality ready for review.",
      },
      create: {
        state: "waiting",
        detail: "",
      },
      ready: {
        state: "waiting",
        detail: "",
      },
    });
  }

  async function handleConnectCustomProvider() {
    resetConnectProgress();
    setConnectRunning(true);

    try {
      updateConnectStep("prepare", "running", "Checking the provider link safely.");
      const prepared = prepareSimpleConnectForm(customForm);
      setCustomForm(prepared);
      updateConnectStep("prepare", "success", "Secure check prepared.");

      const autoResult = await runCustomAutoTest(prepared, true);
      if (!autoResult?.fleet) {
        throw new Error(setupFixMessage(autoResult));
      }

      const patch = buildAutoDetectionPatch(autoResult, prepared);
      const effectiveForm = { ...prepared, ...patch };
      setCustomForm(effectiveForm);

      const coreMissing = missingCoreMappingFields(effectiveForm);
      if (coreMissing.length > 0) {
        applyProgressUpdates({
          mapping: {
            state: "failed",
            detail: "Vehicles were found, but the required location fields were missing.",
          },
          capability: { state: "skipped", detail: "Signal quality was not checked." },
          create: { state: "skipped", detail: "Provider was not created." },
          ready: { state: "skipped", detail: "Review is not ready yet." },
        });
        throw new Error("Core field mapping is incomplete.");
      }

      updateConnectStep(
        "create",
        "running",
        "Creating provider record as inactive."
      );
      let created: any;
      try {
        created = await createCustomProviderRecord(effectiveForm, false);
      } catch (err: any) {
        updateConnectStep(
          "create",
          "failed",
          err.message || "Provider creation failed."
        );
        throw err;
      }
      setConnectedProviderId(created?.provider?.id || "");
      updateConnectStep(
        "create",
        "success",
        "Provider created inactive. Review and activate sync in Provider Vault."
      );
      updateConnectStep(
        "ready",
        "success",
        "Ready for Provider Vault review."
      );
    } catch (err: any) {
      setConnectSteps((steps) =>
        steps.some((step) => step.state === "failed")
          ? steps
          : steps.map((step) =>
              step.id === "prepare"
                ? {
                    ...step,
                    state: "failed",
                    detail: err.message || "Setup failed.",
                  }
                : step
            )
      );
    } finally {
      setConnectRunning(false);
    }
  }

  function handleProviderSelection(value: string) {
    setSelectedTemplateId(value);
    if (value === REQUEST_SETUP_OPTION) {
      setRequestOpen(true);
    } else {
      setRequestOpen(false);
    }
  }

  async function handleSubmitSetupRequest() {
    const providerName = requestForm.provider_name.trim();
    if (!providerName) {
      setRequestError("Provider name is required.");
      return;
    }

    setRequestSaving(true);
    setRequestError("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setRequestSaving(false);
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/providers/setup-requests", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider_name: providerName,
          provider_website: requestForm.provider_website.trim() || null,
          provider_contact: requestForm.provider_contact.trim() || null,
          access_type_known: requestForm.access_type_known,
          notes: requestForm.notes.trim() || null,
          ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to submit provider setup request");
      }

      setRequestSuccess(true);
      setRequestForm({
        provider_name: "",
        provider_website: "",
        provider_contact: "",
        access_type_known: "unsure",
        notes: "",
      });
    } catch (err: any) {
      setRequestError(err.message || "Failed to submit provider setup request");
    } finally {
      setRequestSaving(false);
    }
  }

  if (loading) {
    return <main style={{ padding: 40 }}>Loading supported providers...</main>;
  }

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: 30 }}>
        <div style={eyebrowStyle}>Provider onboarding</div>
        <h1 style={titleStyle}>Connect your tracking provider</h1>
        <p style={subtitleStyle}>
          Choose a provider, enter the access details supplied by your provider,
          and let Nava verify the connection before anything is activated.
        </p>
      </header>

      {selectedCompanyId && isPlatformOwner && company && (
        <div style={tenantBannerStyle}>
          <div>
            <div style={tenantEyebrowStyle}>Platform tenant context</div>
            <div style={tenantTitleStyle}>
              Adding provider for <strong>{company.name}</strong>
            </div>
          </div>
          <Link
            href={`/admin/providers${companyQuery(selectedCompanyId)}`}
            style={tenantBackLinkStyle}
          >
            Back to Provider Vault
          </Link>
        </div>
      )}

      <WizardSteps />

      <section style={cardStyle}>
        {!capabilities.can_add_provider ? (
          <div style={noAccessStyle}>
            <div style={emptyBadgeStyle}>Provider administration</div>
            <h2 style={emptyTitleStyle}>Provider setup requires an owner or admin</h2>
            <p style={emptyBodyStyle}>
              You can view provider status, but creating provider connections is
              limited to company owners/admins and platform owners.
            </p>
            <Link
              href={`/admin/providers${companyQuery(selectedCompanyId)}`}
              style={secondaryLinkStyle}
            >
              Back to Provider Vault
            </Link>
          </div>
        ) : (
          <>
            {loadError && <div style={errorStyle}>{loadError}</div>}
            <div style={fieldGroup}>
              <label style={labelStyle}>Choose or search provider</label>
              <input
                style={inputStyle}
                value={providerSearch}
                placeholder="Search provider name..."
                onChange={(event) => setProviderSearch(event.target.value)}
              />
              <select
                style={inputStyle}
                value={selectedTemplateId}
                onChange={(e) => handleProviderSelection(e.target.value)}
              >
                <option value="">Choose provider...</option>
                {searchedPublicTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.display_name}
                  </option>
                ))}
                <option value={CUSTOM_API_OPTION}>Custom API provider</option>
                <option value={REQUEST_SETUP_OPTION}>
                  Request assisted setup
                </option>
                {capabilities.can_edit_advanced_provider_config &&
                  searchedInternalTemplates.length > 0 && (
                    <optgroup label="Internal templates - platform setup only">
                      {searchedInternalTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.display_name} - Internal template
                        </option>
                      ))}
                    </optgroup>
                  )}
              </select>
            </div>

            <ProviderSetupRequestSection
              requestOpen={requestOpen}
              requestSuccess={requestSuccess}
              requestError={requestError}
              requestSaving={requestSaving}
              requestForm={requestForm}
              setRequestOpen={setRequestOpen}
              setRequestForm={setRequestForm}
              onSubmit={handleSubmitSetupRequest}
            />

            {requestSetupSelected && (
              <div style={noticeStyle}>
                Tell us which tracking system you use. Nava will review the
                provider and prepare a verified setup path before collecting
                sensitive credentials.
              </div>
            )}

            {customApiSelected && (
              <CustomApiProviderForm
                form={customForm}
                updateForm={updateCustomForm}
                saving={saving}
                onCreate={handleCreateProvider}
                detectResults={detectResults}
                testingEndpoint={testingEndpoint}
                onTestEndpoint={handleTestCustomEndpoint}
                onApplyDetection={applyEndpointDetection}
                onAutoFill={handleAutoFillCustomProvider}
                onAutoTest={handleAutoTestCustomProvider}
                onApplyAutoDetection={applyAutoDetection}
                onBaseUrlBlur={handleBaseUrlBlur}
                onUseLoginTokenSetup={handleUseLoginTokenSetup}
                onConnect={handleConnectCustomProvider}
                connectSteps={connectSteps}
                connectRunning={connectRunning}
                connectedProviderId={connectedProviderId}
                providerVaultHref={`/admin/providers${companyQuery(selectedCompanyId)}`}
                onRequestAssistedSetup={() => setRequestOpen(true)}
                canShowDebug={Boolean(
                  capabilities.can_edit_advanced_provider_config
                )}
              />
            )}

            {selectedTemplate && (
              <>
                <div style={noticeStyle}>
                  <strong>{selectedTemplate.display_name}</strong> selected.{" "}
                  {selectedTemplateIsSetupOnly
                    ? "Internal template - platform setup only. Not customer-facing."
                    : "The provider will be created inactive, then tested and activated from Provider Vault."}
                </div>

                <TemplateCapabilityPreview
                  template={selectedTemplate}
                  canShowAdvanced={Boolean(
                    capabilities.can_edit_advanced_provider_config
                  )}
                />

                {!selectedTemplateIsSetupOnly && (
                  <div style={gridStyle}>
                    {requiredCredentialFields.map((field) => (
                      <div key={field.name} style={fieldGroup}>
                        <label style={labelStyle}>{field.label}</label>
                        <input
                          type={field.secret ? "password" : "text"}
                          style={inputStyle}
                          value={form[field.name]}
                          onChange={(e) =>
                            setForm({ ...form, [field.name]: e.target.value })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}

                {selectedTemplateIsSetupOnly ? (
                  <div style={noticeStyle}>
                    This internal template is for platform setup only. Do not
                    use it as customer-facing provider onboarding or collect
                    live credentials until the provider path is verified.
                  </div>
                ) : (
                  <button
                    onClick={handleCreateProvider}
                    disabled={saving}
                    style={buttonStyle}
                  >
                    {saving ? "CREATING CONNECTION..." : "CREATE INACTIVE CONNECTION"}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function WizardSteps() {
  const steps = [
    "Choose provider",
    "Enter access",
    "Find vehicles",
    "Create inactive connection",
    "Review and activate",
  ];

  return (
    <div style={wizardStepsStyle}>
      {steps.map((step, index) => (
        <div key={step} style={wizardStepStyle}>
          <span style={wizardStepNumberStyle}>{index + 1}</span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}

function TemplateCapabilityPreview({
  template,
  canShowAdvanced,
}: {
  template: any;
  canShowAdvanced: boolean;
}) {
  const capability =
    template.capability_profile?.default_capability ||
    template.fleet_config?.capability_profile?.default_capability ||
    "UNKNOWN";
  const supportedSignals =
    template.supported_signals || template.fleet_config?.supported_signals || {};
  const safeSupportedSignals =
    supportedSignals && typeof supportedSignals === "object" && !Array.isArray(supportedSignals)
      ? supportedSignals
      : {};
  const signalNames = Object.entries(safeSupportedSignals)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

  const endpointLabels = Array.isArray(template.default_endpoint_labels)
    ? template.default_endpoint_labels
    : [];
  const setupNotes = Array.isArray(template.setup_notes)
    ? template.setup_notes
    : [];

  if (!canShowAdvanced) {
    return (
      <div style={templatePreviewStyle}>
        <div style={previewGridStyle}>
          <PreviewMetric
            label="Connection test"
            value="Vehicles and live location"
          />
          <PreviewMetric
            label="Data review"
            value="Engine and fuel signals checked after testing"
          />
          <PreviewMetric
            label="Sync"
            value="Inactive until you activate it"
          />
        </div>
        <div style={previewNoteStyle}>
          The connection test will show which vehicles are detected, which
          existing assets match, and whether location, engine, or fuel signals
          are verified. Technical signal tiers and mappings stay internal.
        </div>
      </div>
    );
  }

  return (
    <div style={templatePreviewStyle}>
      {template.internal_template && (
        <div style={internalTemplateBadgeStyle}>
          Internal template - platform setup only - not customer-facing
        </div>
      )}
      <div style={previewGridStyle}>
        <PreviewMetric
          label="Signal capability"
          value={capabilityLabel(capability)}
        />
        <PreviewMetric
          label="Auth method"
          value={template.auth_method_label || template.auth_type || "Provider credentials"}
        />
        <PreviewMetric
          label="Template status"
          value={
            template.internal_template
              ? "Internal platform setup"
              : template.setup_only || template.fleet_config?.setup_only
                ? "Requires provider support"
              : "Self-serve template"
          }
        />
      </div>

      <div style={previewNoteStyle}>
        <strong>Supported signals:</strong>{" "}
        {signalNames.length > 0 ? signalNames.join(", ") : "none declared"}
      </div>

      {setupNotes.length > 0 && (
        <div style={previewNoteStyle}>
          <strong>Setup notes:</strong> {setupNotes.join(" ")}
        </div>
      )}

      <details style={templateAdvancedStyle}>
        <summary style={templateAdvancedSummaryStyle}>Advanced template details</summary>
        <div style={previewNoteStyle}>
          <strong>Endpoint labels:</strong>{" "}
          {endpointLabels.length > 0 ? endpointLabels.join(", ") : "none declared"}
        </div>
        <div style={previewNoteStyle}>
          <strong>Field mapping:</strong>{" "}
          {Object.keys(template.field_mapping || {}).length > 0
            ? Object.keys(template.field_mapping).join(", ")
            : "none declared"}
        </div>
      </details>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={previewMetricStyle}>
      <div style={previewMetricLabelStyle}>{label}</div>
      <div style={previewMetricValueStyle}>{value}</div>
    </div>
  );
}

function capabilityLabel(value: string) {
  const labels: Record<string, string> = {
    UNKNOWN: "Unknown Capability",
    GPS_ONLY: "GPS Intelligence",
    GPS_WITH_IGNITION: "Ignition-Aware GPS",
    CAN_BUS: "Engine Intelligence",
    FUEL_ROD: "Tank Intelligence",
    HYBRID_CAN_AND_FUEL_ROD: "Full Fuel Intelligence",
  };
  return labels[String(value || "UNKNOWN").toUpperCase()] || "Unknown Capability";
}

function filterTemplates(templates: any[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return templates;
  return templates.filter((template) =>
    String(template.display_name || template.name || "")
      .toLowerCase()
      .includes(query)
  );
}

function validateCustomProviderForm(form: typeof INITIAL_CUSTOM_PROVIDER_FORM) {
  if (!form.base_url.trim()) return "API base URL is required.";
  if (!form.provider_name.trim()) return "Provider name is required.";
  if (!form.endpoint_url.trim()) return "Fleet/current location endpoint URL is required.";
  if (!form.row_path.trim()) return "Row path / data group is required.";
  const rowPathError = validateSingleJsonPath(form.row_path, "Row path / data group");
  if (rowPathError) return rowPathError;
  if (!form.vehicle_field.trim()) return "Vehicle / registration field is required.";
  if (!form.latitude_field.trim()) return "Latitude field is required.";
  if (!form.longitude_field.trim()) return "Longitude field is required.";
  if (!form.timestamp_field.trim()) return "Timestamp field is required.";

  if (form.http_method === "GET" && form.request_body.trim()) {
    return "Request body is only supported for POST endpoints.";
  }

  if (form.http_method === "POST" && form.request_body.trim()) {
    try {
      const parsed = JSON.parse(form.request_body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return "Request body must be a JSON object.";
      }
    } catch {
      return "Request body must be valid JSON.";
    }
  }

  if (form.auth_method === "api_key_header" && !form.api_key.trim()) {
    return "API key is required.";
  }
  if (form.auth_method === "bearer_token" && !form.bearer_token.trim()) {
    return "Bearer token is required.";
  }
  if (form.auth_method === "basic" && (!form.username.trim() || !form.password.trim())) {
    return "Basic username and password are required.";
  }
  if (form.auth_method === "post_login") {
    if (!form.login_url.trim()) return "Login endpoint URL is required.";
    if (!form.login_token_path.trim()) return "Login token path is required.";
    if (!form.username.trim() || !form.password.trim()) {
      return "Login username and password are required.";
    }
  }

  if (form.capability_declaration === "location_ignition" && !form.ignition_field.trim()) {
    return "Location + ignition setup requires an ignition field mapping.";
  }
  if (form.capability_declaration === "engine" && !form.rpm_field.trim()) {
    return "Engine data setup requires an RPM field mapping.";
  }
  if (form.capability_declaration === "tank" && !form.fuel_level_field.trim()) {
    return "Tank fuel sensor setup requires a fuel/tank level field mapping.";
  }

  return "";
}

function createInitialConnectSteps(): ProgressStep[] {
  return CONNECT_PROGRESS_DEFINITIONS.map((step) => ({
    id: step.id,
    label: step.label,
    state: "waiting",
    detail: "",
  }));
}

function buildAutoDetectionPatch(
  result: any,
  sourceForm: typeof INITIAL_CUSTOM_PROVIDER_FORM
) {
  const patch: Record<string, string> = {
    base_url: result.base_url || normalizeBaseUrl(sourceForm.base_url),
  };

  if (result.login) {
    patch.auth_method = "post_login";
    patch.login_url = result.login.login_url || sourceForm.login_url;
    patch.login_token_path = result.login.token_path || sourceForm.login_token_path;
    patch.login_username_field =
      result.login.username_field || sourceForm.login_username_field;
    patch.login_secret_field =
      result.login.password_field || sourceForm.login_secret_field;
    patch.login_credential_placement =
      result.login.credential_placement ||
      sourceForm.login_credential_placement;
  }

  if (result.fleet) {
    patch.endpoint_url = result.fleet.endpoint_url || sourceForm.endpoint_url;
    patch.row_path = result.fleet.row_path || sourceForm.row_path;
    patch.fleet_token_placement =
      result.fleet.token_placement || sourceForm.fleet_token_placement;
    const suggestions = result.fleet.field_mapping_suggestions || {};
    if (suggestions.truck || suggestions.vehicle) {
      patch.vehicle_field = suggestions.truck || suggestions.vehicle;
    }
    if (suggestions.latitude) patch.latitude_field = suggestions.latitude;
    if (suggestions.longitude) patch.longitude_field = suggestions.longitude;
    if (suggestions.recorded_at || suggestions.timestamp) {
      patch.timestamp_field = suggestions.recorded_at || suggestions.timestamp;
    }
    if (suggestions.speed) patch.speed_field = suggestions.speed;
    if (suggestions.location_label) patch.location_label_field = suggestions.location_label;
    if (suggestions.fuel_level) patch.fuel_level_field = suggestions.fuel_level;
    if (suggestions.ignition_on || suggestions.ignition) {
      patch.ignition_field = suggestions.ignition_on || suggestions.ignition;
    }
    if (suggestions.engine_rpm) patch.rpm_field = suggestions.engine_rpm;
    if (suggestions.odometer_km || suggestions.odometer) {
      patch.odometer_field = suggestions.odometer_km || suggestions.odometer;
    }
  }

  return patch;
}

function prepareSimpleConnectForm(form: typeof INITIAL_CUSTOM_PROVIDER_FORM) {
  const split = normalizeProviderBaseInput(form.base_url);
  const baseUrl = split.baseUrl;
  const prepared = {
    ...form,
    base_url: baseUrl,
    provider_timezone: form.provider_timezone || "Africa/Nairobi",
  };
  const fleetTrackLike = split.fleetTrackLike || isFleetTrackLike(prepared, baseUrl);

  if (split.endpointKind === "login" && split.endpointUrl && !prepared.login_url.trim()) {
    prepared.login_url = split.endpointUrl;
  }
  if (split.endpointKind === "fleet" && split.endpointUrl && !prepared.endpoint_url.trim()) {
    prepared.endpoint_url = split.endpointUrl;
  }
  const hasLoginCredentials = Boolean(
    prepared.username.trim() && prepared.password.trim()
  );
  const hasApiToken = Boolean(
    prepared.api_key.trim() || prepared.bearer_token.trim()
  );
  if (fleetTrackLike) {
    Object.assign(prepared, buildLoginTokenSetupPatch(baseUrl, prepared, true));
  } else if (hasApiToken) {
    prepared.auth_method = prepared.bearer_token.trim()
      ? "bearer_token"
      : "api_key_header";
  } else if (hasLoginCredentials) {
    prepared.auth_method = "post_login";
    prepared.login_url = prepared.login_url.trim() || `${baseUrl}/login`;
    prepared.login_token_path = prepared.login_token_path.trim() || "token";
  } else if (!prepared.endpoint_url.trim()) {
    prepared.endpoint_url = `${baseUrl}/get_devices`;
  }
  if (!prepared.row_path.trim()) prepared.row_path = "data";

  return prepared;
}

function missingCoreMappingFields(form: typeof INITIAL_CUSTOM_PROVIDER_FORM) {
  return [
    ["vehicle", form.vehicle_field],
    ["latitude", form.latitude_field],
    ["longitude", form.longitude_field],
    ["timestamp", form.timestamp_field],
  ]
    .filter(([, value]) => !String(value || "").trim())
    .map(([label]) => label);
}

function setupFixMessage(result: any) {
  const blockers = Array.isArray(result?.setup_blockers)
    ? result.setup_blockers
    : [];
  const text = String(result?.error || blockers[0] || "").toLowerCase();
  if (text.includes("access token not found") || text.includes("token path")) {
    return "Access token not found. Ask your provider which token or hash field is returned after login.";
  }
  if (text.includes("422") || text.includes("login request shape")) {
    return "Login failed. Check email/password or whether this provider expects query-parameter login.";
  }
  if (text.includes("login failed")) {
    return "Login failed. Check email/password or whether this provider expects query-parameter login.";
  }
  if (text.includes("username and password")) {
    return "Login failed. Check email/password.";
  }
  if (text.includes("api key is required") || text.includes("bearer token is required")) {
    return "API key or token is missing. Add the provider token or use email/password sign-in.";
  }
  if (text.includes("401") || text.includes("user_api_hash")) {
    return "Nava signed in but the provider rejected vehicle access. Ask your provider how vehicle access should be authorized.";
  }
  if (text.includes("vehicle rows") || text.includes("row array")) {
    return "Nava signed in but could not find vehicles. Ask your provider for the vehicle list endpoint.";
  }
  if (text.includes("latitude") || text.includes("longitude") || text.includes("timestamp")) {
    return "Vehicles were found, but the required location fields were missing.";
  }
  return "Connection failed. Check the provider link and credentials.";
}

function normalizeBaseUrl(value: string) {
  return normalizeProviderBaseInput(value).baseUrl;
}

function normalizeProviderBaseInput(value: string) {
  const text = String(value || "").trim();
  if (!text) {
    return {
      baseUrl: "",
      endpointKind: "",
      endpointUrl: "",
      fleetTrackLike: false,
    };
  }

  try {
    const parsed = new URL(text);
    parsed.hash = "";
    const endpointUrl = parsed.toString().replace(/\/+$/, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const lowerPath = path.toLowerCase();

    const matchedLogin = KNOWN_LOGIN_ENDPOINTS.find((endpoint) =>
      lowerPath.endsWith(endpoint)
    );
    const matchedFleet = KNOWN_FLEET_ENDPOINTS.find((endpoint) =>
      lowerPath.endsWith(endpoint)
    );
    const matched = matchedLogin || matchedFleet || "";

    if (matched) {
      parsed.search = "";
      const basePath = path.slice(0, path.length - matched.length).replace(/\/+$/, "");
      parsed.pathname = basePath || "/";
      const baseUrl = parsed.toString().replace(/\/+$/, "");
      return {
        baseUrl,
        endpointKind: matchedLogin ? "login" : "fleet",
        endpointUrl,
        fleetTrackLike: isFleetTrackHint(`${text} ${matched}`),
      };
    }

    parsed.search = "";
    return {
      baseUrl: parsed.toString().replace(/\/+$/, ""),
      endpointKind: "",
      endpointUrl: "",
      fleetTrackLike: isFleetTrackHint(text),
    };
  } catch {
    const trimmed = text.replace(/\/+$/, "");
    return {
      baseUrl: trimmed,
      endpointKind: "",
      endpointUrl: "",
      fleetTrackLike: isFleetTrackHint(trimmed),
    };
  }
}

function isFleetTrackLike(
  form: typeof INITIAL_CUSTOM_PROVIDER_FORM,
  baseUrl: string
) {
  const text = `${form.provider_name} ${form.provider_website} ${form.provider_notes} ${form.login_url} ${form.endpoint_url} ${baseUrl}`;
  return isFleetTrackHint(text);
}

function isFleetTrackHint(value: string) {
  const text = String(value || "").toLowerCase();
  return (
    text.includes("fleettrack") ||
    text.includes("get_devices") ||
    text.includes("user_api_hash") ||
    text.includes("api_hash") ||
    text.includes("post_login")
  );
}

function buildLoginTokenSetupPatch(
  baseUrl: string,
  form: typeof INITIAL_CUSTOM_PROVIDER_FORM,
  force = false
) {
  return {
    auth_method: "post_login",
    login_url:
      !force && form.login_url.trim()
        ? form.login_url.trim()
        : `${baseUrl}/login?email={{username}}&password={{password}}`,
    login_token_path: "user_api_hash",
    login_username_field:
      !force && form.login_username_field.trim()
        ? form.login_username_field.trim()
        : "email",
    login_secret_field:
      !force && form.login_secret_field.trim()
        ? form.login_secret_field.trim()
        : "password",
    login_credential_placement: "query_params",
    endpoint_url: `${baseUrl}/get_devices?lang=en&user_api_hash={{user_api_hash}}`,
    fleet_token_placement: "query_user_api_hash",
    row_path: !force && form.row_path.trim() ? form.row_path.trim() : "data",
  };
}

function validateSingleJsonPath(value: string, label: string) {
  const text = String(value || "").trim();
  if (!text) return `${label} is required.`;
  if (/https?:\/\//i.test(text)) {
    return `${label} must be one JSON path, not a URL.`;
  }
  if (/[{},]/.test(text)) {
    return `${label} must be one JSON path only, for example data or data.vehicles.`;
  }
  if (/\s/.test(text)) {
    return `${label} cannot contain spaces. Enter one path only, for example data, items, devices, or data.vehicles.`;
  }
  return "";
}

function getCredentialFields(template: any): CredentialField[] {
  if (Array.isArray(template.required_fields) && template.required_fields.length > 0) {
    return template.required_fields.map((field: any) => ({
      name: String(field.name || ""),
      label: String(field.label || field.name || "Credential"),
      secret: field.secret !== false,
    })).filter((field: any): field is CredentialField =>
      ["username", "api_key", "password", "bearer_token"].includes(field.name)
    );
  }

  const placeholders = new Set<string>();
  const configText = JSON.stringify({
    auth_config: template.auth_config || {},
    fleet_config: template.fleet_config || {},
  });

  const matches = configText.match(/{{\s*(username|api_key|password|bearer_token)\s*}}/g) || [];
  matches.forEach((match) => placeholders.add(match.replace(/[{}\s]/g, "")));

  const fields: CredentialField[] = [
    { name: "username", label: "API Username", secret: false },
    { name: "api_key", label: "Provider Password / Secret", secret: true },
    { name: "password", label: "Password", secret: true },
    { name: "bearer_token", label: "Access Token", secret: true },
  ];

  return fields.filter((field) => placeholders.has(field.name));
}

function EmptyTemplateState({
  error,
  onRequest,
}: {
  error: string;
  onRequest: () => void;
}) {
  return (
    <div style={emptyTemplateStyle}>
      <div style={emptyBadgeStyle}>Provider setup</div>
      <h2 style={emptyTitleStyle}>No verified provider setup available yet</h2>
      <p style={emptyBodyStyle}>
        Nava needs a verified GPS/telemetry setup template before it can create
        a secure connection for this provider.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={emptyActionsStyle}>
        <button
          type="button"
          onClick={onRequest}
          style={buttonStyle}
        >
          Request provider setup
        </button>
        <Link href="/onboarding" style={secondaryLinkStyle}>
          Back to onboarding
        </Link>
      </div>

      <div style={emptyNoteStyle}>
        Provider access details should only be saved after Nava has verified the
        provider connection safely.
      </div>
    </div>
  );
}

function CustomApiProviderForm({
  form,
  updateForm,
  saving,
  onCreate,
  detectResults,
  testingEndpoint,
  onTestEndpoint,
  onApplyDetection,
  onAutoFill,
  onAutoTest,
  onApplyAutoDetection,
  onBaseUrlBlur,
  onUseLoginTokenSetup,
  onConnect,
  connectSteps,
  connectRunning,
  connectedProviderId,
  providerVaultHref,
  onRequestAssistedSetup,
  canShowDebug,
}: {
  form: typeof INITIAL_CUSTOM_PROVIDER_FORM;
  updateForm: (patch: Record<string, string>) => void;
  saving: boolean;
  onCreate: () => void;
  detectResults: Record<string, any>;
  testingEndpoint: string;
  onTestEndpoint: (target: "login" | "fleet") => void;
  onApplyDetection: (target: "login" | "fleet") => void;
  onAutoFill: () => void;
  onAutoTest: () => void;
  onApplyAutoDetection: () => void;
  onBaseUrlBlur: () => void;
  onUseLoginTokenSetup: () => void;
  onConnect: () => void;
  connectSteps: ProgressStep[];
  connectRunning: boolean;
  connectedProviderId: string;
  providerVaultHref: string;
  onRequestAssistedSetup: () => void;
  canShowDebug: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isPost = form.http_method === "POST";
  const loginTokenHint = isFleetTrackLike(form, normalizeBaseUrl(form.base_url));

  return (
    <div style={customProviderStyle}>
      <div style={customHeaderStyle}>
        <div>
          <div style={requestTitleStyle}>Custom API provider</div>
          <p style={requestCopyStyle}>
            Use this when your tracking provider gives you API details. The
            connection is saved inactive, then tested before sync can be
            activated.
          </p>
        </div>
        <div style={safeBadgeStyle}>Self-serve API setup</div>
      </div>

      <section style={simpleConnectStyle}>
        <div>
          <h2 style={providerWizardSectionTitleStyle}>Simple Connect</h2>
          <p style={providerWizardSectionCopyStyle}>
            Enter the provider link and access details. Nava will check the
            connection, find vehicles, and create the provider inactive for
            review.
          </p>
        </div>
        <div style={gridStyle}>
          <TextField
            label="Provider name"
            value={form.provider_name}
            onChange={(value) => updateForm({ provider_name: value })}
            required
          />
          <TextField
            label="Provider website or API link"
            value={form.base_url}
            onChange={(value) => updateForm({ base_url: value })}
            onBlur={onBaseUrlBlur}
            placeholder="https://fleettrack.africa/api"
            required
          />
          <TextField
            label="Email / username"
            value={form.username}
            onChange={(value) => updateForm({ username: value })}
          />
          <TextField
            label="Password"
            value={form.password}
            onChange={(value) => updateForm({ password: value })}
            secret
          />
          <TextField
            label="API key / token optional"
            value={form.api_key}
            onChange={(value) => updateForm({ api_key: value })}
            secret
          />
        </div>
        {loginTokenHint && (
          <div style={warningStyle}>
            This provider appears to use email/password sign-in that returns an
            access hash. Nava will try that first.
          </div>
        )}
        <div style={autoActionsStyle}>
          <button
            type="button"
            style={buttonStyle}
            disabled={connectRunning || saving}
            onClick={onConnect}
          >
            {connectRunning ? "CONNECTING PROVIDER..." : "CONNECT PROVIDER"}
          </button>
        </div>
        <ConnectProgressRunner
          steps={connectSteps}
          providerVaultHref={providerVaultHref}
          connectedProviderId={connectedProviderId}
        />
        <ConnectOutcomePanel
          steps={connectSteps}
          result={detectResults.auto}
          connectedProviderId={connectedProviderId}
          providerVaultHref={providerVaultHref}
          onOpenAdvanced={() => setAdvancedOpen(true)}
          onRequestAssistedSetup={onRequestAssistedSetup}
        />
      </section>

      <details
        style={templateAdvancedStyle}
        open={advancedOpen}
        onToggle={(event) =>
          setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary style={templateAdvancedSummaryStyle}>
          Advanced troubleshooting
        </summary>
      <div style={advancedTroubleshootingIntroStyle}>
        Use these tools only when Simple Connect cannot find vehicles or your
        provider has supplied exact technical setup details.
      </div>
      <div style={autoActionsStyle}>
        <button type="button" style={secondaryButtonStyle} onClick={onAutoFill}>
          Try common endpoint patterns
        </button>
        {loginTokenHint && (
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={onUseLoginTokenSetup}
          >
            Use detected sign-in setup
          </button>
        )}
        <button
          type="button"
          style={buttonInlineStyle}
          disabled={testingEndpoint === "auto" || connectRunning}
          onClick={onAutoTest}
        >
          {testingEndpoint === "auto" ? "Testing setup..." : "Test setup"}
        </button>
      </div>
      <AutoSetupDetectionResult
        result={detectResults.auto}
        canShowDebug={canShowDebug}
        onApply={onApplyAutoDetection}
        onUseLoginTokenSetup={onUseLoginTokenSetup}
      />
      <ProviderWizardSection
        title="Provider identity"
        copy="Name the tracking system and choose the provider timezone used for timestamp interpretation."
      >
        <div style={gridStyle}>
          <TextField
            label="Provider name"
            value={form.provider_name}
            onChange={(value) => updateForm({ provider_name: value })}
            required
          />
          <TextField
            label="Provider website optional"
            value={form.provider_website}
            onChange={(value) => updateForm({ provider_website: value })}
            placeholder="https://provider.example"
          />
          <TextField
            label="API base URL"
            value={form.base_url}
            onChange={(value) => updateForm({ base_url: value })}
            onBlur={onBaseUrlBlur}
            placeholder="https://provider.example/api"
            required
          />
          <TextField
            label="Provider timezone"
            value={form.provider_timezone}
            onChange={(value) => updateForm({ provider_timezone: value })}
          />
        </div>
        <div style={fieldGroupWithTop}>
          <label style={labelStyle}>Provider docs / notes optional</label>
          <textarea
            style={textareaStyle}
            value={form.provider_notes}
            onChange={(e) => updateForm({ provider_notes: e.target.value })}
            placeholder="Paste short hints such as get_devices, user_api_hash, or provider endpoint notes."
          />
        </div>
      </ProviderWizardSection>

      <ProviderWizardSection
        title="Authentication"
        copy="Credentials are stored server-side only and are not echoed back after save."
      >
        <div style={gridStyle}>
          <div style={fieldGroup}>
            <label style={labelStyle}>Auth method</label>
            <select
              style={inputStyle}
              value={form.auth_method}
              onChange={(e) => updateForm({ auth_method: e.target.value })}
            >
              <option value="none">No auth / public endpoint</option>
              <option value="api_key_header">API key header</option>
              <option value="bearer_token">Bearer token</option>
              <option value="basic">Basic username/password</option>
              <option value="post_login">POST login token</option>
            </select>
          </div>

          {form.auth_method === "api_key_header" && (
            <>
              <TextField
                label="API key header"
                value={form.api_key_header}
                onChange={(value) => updateForm({ api_key_header: value })}
              />
              <TextField
                label="API key"
                value={form.api_key}
                onChange={(value) => updateForm({ api_key: value })}
                secret
                required
              />
            </>
          )}

          {form.auth_method === "bearer_token" && (
            <TextField
              label="Bearer token"
              value={form.bearer_token}
              onChange={(value) => updateForm({ bearer_token: value })}
              secret
              required
            />
          )}

          {(form.auth_method === "basic" || form.auth_method === "post_login") && (
            <>
              <TextField
                label="Username"
                value={form.username}
                onChange={(value) => updateForm({ username: value })}
                required
              />
              <TextField
                label="Password / secret"
                value={form.password}
                onChange={(value) => updateForm({ password: value })}
                secret
                required
              />
            </>
          )}

          {form.auth_method === "post_login" && (
            <>
              <div style={fieldGroup}>
                <label style={labelStyle}>Credential placement</label>
                <select
                  style={inputStyle}
                  value={form.login_credential_placement}
                  onChange={(e) =>
                    updateForm({ login_credential_placement: e.target.value })
                  }
                >
                  <option value="json_body">JSON body</option>
                  <option value="query_params">Query params</option>
                </select>
              </div>
              <TextField
                label="Login endpoint URL"
                value={form.login_url}
                onChange={(value) => updateForm({ login_url: value })}
                placeholder="https://api.provider.example/login"
                required
              />
              <TextField
                label="Login token path"
                value={form.login_token_path}
                onChange={(value) => updateForm({ login_token_path: value })}
                placeholder="data.token"
                required
              />
              <TextField
                label="Login username field"
                value={form.login_username_field}
                onChange={(value) => updateForm({ login_username_field: value })}
              />
              <TextField
                label="Login password field"
                value={form.login_secret_field}
                onChange={(value) => updateForm({ login_secret_field: value })}
              />
            </>
          )}
        </div>

        {form.auth_method === "post_login" && (
          <>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={testingEndpoint === "login"}
              onClick={() => onTestEndpoint("login")}
            >
              {testingEndpoint === "login"
                ? "TESTING LOGIN ENDPOINT..."
                : "TEST ENDPOINT & DETECT TOKEN"}
            </button>
            <EndpointDetectionResult
              target="login"
              result={detectResults.login}
              canShowDebug={canShowDebug}
              onApply={() => onApplyDetection("login")}
            />
          </>
        )}
      </ProviderWizardSection>

      <ProviderWizardSection
        title="Fleet/current location endpoint"
        copy="This should be the endpoint that returns current vehicle location rows."
      >
        <div style={gridStyle}>
          <TextField
            label="Endpoint URL"
            value={form.endpoint_url}
            onChange={(value) => updateForm({ endpoint_url: value })}
            placeholder="https://api.provider.example/fleet"
            required
          />
          <div style={fieldGroup}>
            <label style={labelStyle}>HTTP method</label>
            <select
              style={inputStyle}
              value={form.http_method}
              onChange={(e) => updateForm({ http_method: e.target.value })}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </div>
          <div style={fieldGroup}>
            <label style={labelStyle}>Token placement</label>
            <select
              style={inputStyle}
              value={form.fleet_token_placement}
              onChange={(e) =>
                updateForm({ fleet_token_placement: e.target.value })
              }
            >
              <option value="authorization_bearer">Authorization Bearer</option>
              <option value="query_user_api_hash">Query user_api_hash</option>
              <option value="query_token">Query token</option>
              <option value="x_api_key">X-API-Key header</option>
              <option value="none">No token on fleet endpoint</option>
            </select>
          </div>
          <TextField
            label="Row path / data group"
            value={form.row_path}
            onChange={(value) => updateForm({ row_path: value })}
            placeholder="data.vehicles"
            required
          />
        </div>
        <div style={helperTextStyle}>
          Enter one JSON path only, for example data, items, devices, or
          data.vehicles.
        </div>

        {isPost && (
          <div style={fieldGroupWithTop}>
            <label style={labelStyle}>Request body optional, JSON object</label>
            <textarea
              style={textareaStyle}
              value={form.request_body}
              onChange={(e) => updateForm({ request_body: e.target.value })}
              placeholder='{"fleetId":"example"}'
            />
            <div style={helperTextStyle}>
              Keep credentials out of the request body. Use the authentication
              fields above for tokens, keys, and passwords.
            </div>
          </div>
        )}

        <button
          type="button"
          style={secondaryButtonStyle}
          disabled={testingEndpoint === "fleet"}
          onClick={() => onTestEndpoint("fleet")}
        >
          {testingEndpoint === "fleet"
            ? "TESTING FLEET ENDPOINT..."
            : "TEST ENDPOINT & DETECT FIELDS"}
        </button>
        <EndpointDetectionResult
          target="fleet"
          result={detectResults.fleet}
          canShowDebug={canShowDebug}
          onApply={() => onApplyDetection("fleet")}
          onChooseRowPath={(path) => updateForm({ row_path: path })}
        />
      </ProviderWizardSection>

      <ProviderWizardSection
        title="Field mapping"
        copy="Map provider keys into Nava's standard vehicle signals. Use dot paths if the data is nested."
      >
        <div style={gridStyle}>
          <TextField
            label="Vehicle / registration field"
            value={form.vehicle_field}
            onChange={(value) => updateForm({ vehicle_field: value })}
            placeholder="reg_no"
            required
          />
          <TextField
            label="Latitude field"
            value={form.latitude_field}
            onChange={(value) => updateForm({ latitude_field: value })}
            placeholder="latitude"
            required
          />
          <TextField
            label="Longitude field"
            value={form.longitude_field}
            onChange={(value) => updateForm({ longitude_field: value })}
            placeholder="longitude"
            required
          />
          <TextField
            label="Timestamp field"
            value={form.timestamp_field}
            onChange={(value) => updateForm({ timestamp_field: value })}
            placeholder="recorded_at"
            required
          />
          <TextField
            label="Speed field optional"
            value={form.speed_field}
            onChange={(value) => updateForm({ speed_field: value })}
            placeholder="speed"
          />
          <TextField
            label="Location label field optional"
            value={form.location_label_field}
            onChange={(value) => updateForm({ location_label_field: value })}
            placeholder="location"
          />
          <TextField
            label="Fuel/tank level field optional"
            value={form.fuel_level_field}
            onChange={(value) => updateForm({ fuel_level_field: value })}
            placeholder="fuelLevel"
          />
          <TextField
            label="Ignition field optional"
            value={form.ignition_field}
            onChange={(value) => updateForm({ ignition_field: value })}
            placeholder="ignition"
          />
          <TextField
            label="RPM field optional"
            value={form.rpm_field}
            onChange={(value) => updateForm({ rpm_field: value })}
            placeholder="rpm"
          />
          <TextField
            label="Odometer field optional"
            value={form.odometer_field}
            onChange={(value) => updateForm({ odometer_field: value })}
            placeholder="odometer"
          />
        </div>
      </ProviderWizardSection>

      <ProviderWizardSection
        title="Signal capability"
        copy="Declare only signals your provider confirms are real sensor values."
      >
        <div style={fieldGroup}>
          <label style={labelStyle}>What can this provider prove?</label>
          <select
            style={inputStyle}
            value={form.capability_declaration}
            onChange={(e) =>
              updateForm({ capability_declaration: e.target.value })
            }
          >
            <option value="not_sure">Not sure</option>
            <option value="location_only">Location only</option>
            <option value="location_ignition">Location + ignition</option>
            <option value="engine">Engine data available</option>
            <option value="tank">Tank fuel sensor available</option>
          </select>
        </div>
        <div style={warningStyle}>
          Only select engine or tank signals if your provider confirms these
          fields are real sensor values, not dashboard placeholders. Test
          Connection will still verify the observed rows before sync activation.
        </div>
      </ProviderWizardSection>

      <button
        type="button"
        onClick={onCreate}
        disabled={saving}
        style={buttonStyle}
      >
        {saving ? "CREATING CUSTOM PROVIDER..." : "CREATE INACTIVE PROVIDER"}
      </button>
      </details>
    </div>
  );
}

function ConnectProgressRunner({
  steps,
  providerVaultHref,
  connectedProviderId,
}: {
  steps: ProgressStep[];
  providerVaultHref: string;
  connectedProviderId: string;
}) {
  const hasStarted = steps.some(
    (step) => step.state !== "waiting" || step.detail
  );
  if (!hasStarted) {
    return (
      <div style={progressShellStyle}>
        <div style={progressHeaderStyle}>
          <div style={detectionTitleStyle}>Connection progress</div>
          <div style={detectionMetaStyle}>
            The setup checklist will appear here when testing starts.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={progressShellStyle}>
      <div style={progressHeaderStyle}>
        <div>
          <div style={detectionTitleStyle}>Connection progress</div>
          <div style={detectionMetaStyle}>
            Access details and provider responses stay hidden while setup runs.
          </div>
        </div>
        {connectedProviderId && (
          <Link href={providerVaultHref} style={smallLinkButtonStyle}>
            Open Provider Vault
          </Link>
        )}
      </div>
      <div style={progressListStyle}>
        {steps.map((step) => (
          <div key={step.id} style={progressStepStyle}>
            <span style={progressDotStyle(step.state)}>
              {progressSymbol(step.state)}
            </span>
            <span style={progressTextStyle}>
              <strong>{step.label}</strong>
              {step.detail && <span>{step.detail}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectOutcomePanel({
  steps,
  result,
  connectedProviderId,
  providerVaultHref,
  onOpenAdvanced,
  onRequestAssistedSetup,
}: {
  steps: ProgressStep[];
  result: any;
  connectedProviderId: string;
  providerVaultHref: string;
  onOpenAdvanced: () => void;
  onRequestAssistedSetup: () => void;
}) {
  const failedStep = steps.find((step) => step.state === "failed");
  if (connectedProviderId) {
    const fleet = result?.fleet || {};
    const vehiclesFound = Number(fleet.detected_vehicle_count || 0);
    const matched = Number(fleet.matched_existing_assets || 0);
    const unmatched = Number(
      fleet.unmatched_vehicle_count ?? Math.max(0, vehiclesFound - matched)
    );

    return (
      <div style={successPanelStyle}>
        <div style={outcomeTitleStyle}>Provider created inactive</div>
        <div style={outcomeCopyStyle}>
          Review detected vehicles and activate sync from Provider Vault when
          you are ready.
        </div>
        <div style={outcomeGridStyle}>
          <PreviewMetric label="Vehicles found" value={String(vehiclesFound)} />
          <PreviewMetric label="Matched existing trucks" value={String(matched)} />
          <PreviewMetric label="New/unmatched vehicles" value={String(unmatched)} />
          <PreviewMetric
            label="Tracking verified"
            value={fleet.tracking_verified ? "yes" : "needs review"}
          />
          <PreviewMetric
            label="Engine/fuel signals verified"
            value={fleet.engine_fuel_verified ? "yes" : "not yet"}
          />
          <PreviewMetric label="Sync status" value="inactive" />
        </div>
        <Link href={providerVaultHref} style={buttonStyle}>
          Review in Provider Vault
        </Link>
      </div>
    );
  }

  if (!failedStep) return null;

  return (
    <div style={failurePanelStyle}>
      <div style={outcomeTitleStyle}>Connection needs attention</div>
      <div style={outcomeCopyStyle}>
        {failedStep.detail || "Connection failed. Check the provider link and credentials."}
      </div>
      <div style={outcomeActionRowStyle}>
        <button type="button" style={secondaryButtonStyle} onClick={onOpenAdvanced}>
          Try advanced troubleshooting
        </button>
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={onRequestAssistedSetup}
        >
          Request assisted setup
        </button>
      </div>
    </div>
  );
}

function progressSymbol(state: ProgressStepState) {
  if (state === "success") return "OK";
  if (state === "warning") return "!";
  if (state === "failed") return "X";
  if (state === "skipped") return "-";
  if (state === "running") return "...";
  return "";
}

function EndpointDetectionResult({
  target,
  result,
  canShowDebug,
  onApply,
  onChooseRowPath,
}: {
  target: "login" | "fleet";
  result: any;
  canShowDebug: boolean;
  onApply: () => void;
  onChooseRowPath?: (path: string) => void;
}) {
  if (!result) return null;

  if (result.error) {
    return <div style={requestErrorStyle}>{result.error}</div>;
  }

  const blockers = Array.isArray(result.setup_blockers)
    ? result.setup_blockers
    : [];
  const tokenPath = result.token_like_paths?.[0] || "";
  const rowPath = result.row_path_suggestions?.[0] || "";
  const suggestions = result.field_mapping_suggestions || {};
  const suggestedFields = Object.entries(suggestions)
    .filter(([, value]) => Boolean(value))
    .slice(0, 10);
  const rowPathButtons =
    target === "fleet"
      ? ((result.row_path_suggestions || []).length > 0
          ? result.row_path_suggestions
          : ["data", "items", "devices"])
      : [];
  const canApply =
    target === "login" ? Boolean(tokenPath) : Boolean(rowPath || suggestedFields.length);

  return (
    <div style={detectionResultStyle}>
      <div style={detectionHeaderStyle}>
        <div>
          <div style={detectionTitleStyle}>
            Endpoint response detected
          </div>
          <div style={detectionMetaStyle}>
            HTTP {result.status_code} · {result.response_type || "unknown"} response
            {result.content_type ? ` · ${result.content_type}` : ""}
          </div>
        </div>
        {canApply && (
          <button type="button" style={smallButtonStyle} onClick={onApply}>
            Apply suggestions
          </button>
        )}
      </div>

      {blockers.length > 0 && (
        <div style={detectionWarningStyle}>
          {blockers.map((blocker: string) => (
            <div key={blocker}>{blocker}</div>
          ))}
        </div>
      )}

      {target === "login" ? (
        <div style={detectionGridStyle}>
          <PreviewMetric
            label="Token path suggestion"
            value={tokenPath || "No token-like path found"}
          />
          <PreviewMetric
            label="Top-level keys"
            value={(result.top_level_keys || []).join(", ") || "none detected"}
          />
        </div>
      ) : (
        <>
          <div style={detectionGridStyle}>
            <PreviewMetric
              label="Row path suggestion"
              value={rowPath || "No row array detected"}
            />
            <PreviewMetric
              label="Array paths"
              value={(result.array_paths || []).slice(0, 3).join(", ") || "none detected"}
            />
          </div>
          {suggestedFields.length > 0 && (
            <div style={suggestionListStyle}>
              {suggestedFields.map(([key, value]) => (
                <div key={key} style={suggestionItemStyle}>
                  <span>{fieldSuggestionLabel(key)}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>
          )}
          {onChooseRowPath && rowPathButtons.length > 0 && (
            <div style={rowPathButtonWrapStyle}>
              {rowPathButtons.slice(0, 6).map((path: string) => (
                <button
                  key={path}
                  type="button"
                  style={rowPathButtonStyle}
                  onClick={() => onChooseRowPath(path)}
                >
                  {path}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {canShowDebug && (
        <details style={templateAdvancedStyle}>
          <summary style={templateAdvancedSummaryStyle}>
            Sanitized debug structure
          </summary>
          <pre style={debugPreStyle}>
            {JSON.stringify(
              {
                top_level_keys: result.top_level_keys,
                array_paths: result.array_paths,
                token_like_paths: result.token_like_paths,
                sanitized_sample: result.sanitized_sample,
              },
              null,
              2
            )}
          </pre>
        </details>
      )}
    </div>
  );
}

function AutoSetupDetectionResult({
  result,
  canShowDebug,
  onApply,
  onUseLoginTokenSetup,
}: {
  result: any;
  canShowDebug: boolean;
  onApply: () => void;
  onUseLoginTokenSetup: () => void;
}) {
  if (!result) return null;
  if (result.error) return <div style={requestErrorStyle}>{result.error}</div>;

  const blockers = Array.isArray(result.setup_blockers)
    ? result.setup_blockers
    : [];
  const fleet = result.fleet || null;
  const login = result.login || null;
  const canApply = Boolean(login || fleet);

  return (
    <div style={detectionResultStyle}>
      <div style={detectionHeaderStyle}>
        <div>
          <div style={detectionTitleStyle}>
            {fleet
              ? "Nava found vehicles at this endpoint"
              : "Auto-test completed"}
          </div>
          <div style={detectionMetaStyle}>
            Tried {result.attempts?.login || 0} login candidates and{" "}
            {result.attempts?.fleet || 0} fleet endpoint candidates.
          </div>
        </div>
        {canApply && (
          <button type="button" style={smallButtonStyle} onClick={onApply}>
            Apply detected setup
          </button>
        )}
      </div>

      {blockers.length > 0 && (
        <div style={detectionWarningStyle}>
          {blockers.map((blocker: string) => (
            <div key={blocker}>{blocker}</div>
          ))}
          {result.suggested_auth_method === "post_login" && (
            <button
              type="button"
              style={smallButtonStyle}
              onClick={onUseLoginTokenSetup}
            >
              Use POST login token setup
            </button>
          )}
        </div>
      )}

      <div style={detectionGridStyle}>
        <PreviewMetric
          label="Login endpoint"
          value={login?.login_url || "No login token detected"}
        />
        <PreviewMetric
          label="Token path"
          value={login?.token_path || "none detected"}
        />
        <PreviewMetric
          label="Fleet endpoint"
          value={fleet?.endpoint_url || "No vehicle rows found"}
        />
        <PreviewMetric
          label="Detected vehicles"
          value={
            fleet?.detected_vehicle_count !== undefined
              ? String(fleet.detected_vehicle_count)
              : "0"
          }
        />
      </div>

      {fleet?.row_path && (
        <div style={suggestionListStyle}>
          <div style={suggestionItemStyle}>
            <span>Row path</span>
            <strong>{fleet.row_path}</strong>
          </div>
          <div style={suggestionItemStyle}>
            <span>Token placement</span>
            <strong>{tokenPlacementLabel(fleet.token_placement)}</strong>
          </div>
          {Object.entries(fleet.field_mapping_suggestions || {})
            .filter(([, value]) => Boolean(value))
            .slice(0, 8)
            .map(([key, value]) => (
              <div key={key} style={suggestionItemStyle}>
                <span>{fieldSuggestionLabel(key)}</span>
                <strong>{String(value)}</strong>
              </div>
            ))}
        </div>
      )}

      {!fleet && (
        <div style={emptyNoteLightStyle}>
          No vehicle rows found yet. Try another endpoint or ask your provider
          for the exact get_devices response.
        </div>
      )}

      {canShowDebug && (
        <details style={templateAdvancedStyle}>
          <summary style={templateAdvancedSummaryStyle}>
            Sanitized auto-test debug
          </summary>
          <pre style={debugPreStyle}>
            {JSON.stringify(
              {
                login_candidates: result.login_candidates,
                fleet_candidates: result.fleet_candidates,
                token_path_candidates: result.token_path_candidates,
                row_path_candidates: result.row_path_candidates,
                setup_blockers: result.setup_blockers,
              },
              null,
              2
            )}
          </pre>
        </details>
      )}
    </div>
  );
}

function fieldSuggestionLabel(value: string) {
  const labels: Record<string, string> = {
    vehicle: "Vehicle",
    latitude: "Latitude",
    longitude: "Longitude",
    speed: "Speed",
    timestamp: "Timestamp",
    location_label: "Location label",
    ignition: "Ignition",
    engine_rpm: "RPM",
    fuel_level: "Fuel/tank level",
    odometer: "Odometer",
    mileage: "Mileage",
    violations: "Violations",
  };
  return labels[value] || value;
}

function tokenPlacementLabel(value: string) {
  const labels: Record<string, string> = {
    query_user_api_hash: "Query user_api_hash",
    query_token: "Query token",
    authorization_bearer: "Authorization Bearer",
    x_api_key: "X-API-Key header",
    basic_auth: "Basic auth",
    none: "None",
  };
  return labels[value] || value || "Not detected";
}

function ProviderWizardSection({
  title,
  copy,
  children,
}: {
  title: string;
  copy: string;
  children: ReactNode;
}) {
  return (
    <section style={providerWizardSectionStyle}>
      <h2 style={providerWizardSectionTitleStyle}>{title}</h2>
      <p style={providerWizardSectionCopyStyle}>{copy}</p>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  secret = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
}) {
  return (
    <div style={fieldGroup}>
      <label style={labelStyle}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        type={secret ? "password" : "text"}
        style={inputStyle}
        value={value}
        placeholder={placeholder}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ProviderSetupRequestSection({
  requestOpen,
  requestSuccess,
  requestError,
  requestSaving,
  requestForm,
  setRequestOpen,
  setRequestForm,
  onSubmit,
}: {
  requestOpen: boolean;
  requestSuccess: boolean;
  requestError: string;
  requestSaving: boolean;
  requestForm: any;
  setRequestOpen: (open: boolean) => void;
  setRequestForm: (form: any) => void;
  onSubmit: () => void;
}) {
  return (
    <div style={requestSectionStyle}>
      <div>
        <div style={requestTitleStyle}>Don&apos;t see your provider?</div>
        <p style={requestCopyStyle}>
          Nava can help set up a verified connection for your fleet.
        </p>
      </div>
      <button
        type="button"
        style={secondaryButtonStyle}
        onClick={() => setRequestOpen(!requestOpen)}
      >
        Request provider setup
      </button>

      {requestOpen && (
        <ProviderSetupRequestForm
          requestSuccess={requestSuccess}
          requestError={requestError}
          requestSaving={requestSaving}
          requestForm={requestForm}
          setRequestForm={setRequestForm}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}

function ProviderSetupRequestForm({
  requestSuccess,
  requestError,
  requestSaving,
  requestForm,
  setRequestForm,
  onSubmit,
}: {
  requestSuccess: boolean;
  requestError: string;
  requestSaving: boolean;
  requestForm: any;
  setRequestForm: (form: any) => void;
  onSubmit: () => void;
}) {
  if (requestSuccess) {
    return (
      <div style={requestSuccessStyle}>
        Request received. Nava will review the provider and prepare a verified
        connection path before any credentials are collected.
      </div>
    );
  }

  return (
    <div style={requestFormStyle}>
      <div style={gridStyle}>
        <div style={fieldGroup}>
          <label style={labelStyle}>Current Tracking System / Provider Name</label>
          <input
            style={inputStyle}
            value={requestForm.provider_name}
            onChange={(e) =>
              setRequestForm({ ...requestForm, provider_name: e.target.value })
            }
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>Provider Website Optional</label>
          <input
            style={inputStyle}
            value={requestForm.provider_website}
            onChange={(e) =>
              setRequestForm({
                ...requestForm,
                provider_website: e.target.value,
              })
            }
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>Provider Support Contact Optional</label>
          <input
            style={inputStyle}
            value={requestForm.provider_contact}
            onChange={(e) =>
              setRequestForm({
                ...requestForm,
                provider_contact: e.target.value,
              })
            }
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>Access Type Known</label>
          <select
            style={inputStyle}
            value={requestForm.access_type_known}
            onChange={(e) =>
              setRequestForm({
                ...requestForm,
                access_type_known: e.target.value,
              })
            }
          >
            <option value="unsure">Unsure</option>
            <option value="username_password">Username/password</option>
            <option value="api_key">API key</option>
            <option value="token">Token</option>
          </select>
        </div>
      </div>

      <div style={fieldGroup}>
        <label style={labelStyle}>Notes / Current Workflow Optional</label>
        <textarea
          style={textareaStyle}
          value={requestForm.notes}
          onChange={(e) =>
            setRequestForm({ ...requestForm, notes: e.target.value })
          }
        />
      </div>

      {requestError && <div style={requestErrorStyle}>{requestError}</div>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={requestSaving}
        style={buttonStyle}
      >
        {requestSaving ? "SUBMITTING REQUEST..." : "SUBMIT REQUEST"}
      </button>
    </div>
  );
}

const pageStyle = {
  padding: 40,
  maxWidth: 900,
};

const eyebrowStyle = {
  fontSize: 12,
  fontWeight: 850,
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  color: "#0891b2",
  marginBottom: 8,
};

const titleStyle = {
  fontSize: 30,
  fontWeight: 800,
  color: "#0f172a",
  marginBottom: 8,
};

const subtitleStyle = {
  color: "#64748b",
  fontSize: 14,
};

const cardStyle = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: 28,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const tenantBannerStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "center",
  border: "1px solid #bae6fd",
  backgroundColor: "#ecfeff",
  borderRadius: 12,
  padding: 16,
  marginBottom: 18,
};

const tenantEyebrowStyle = {
  fontSize: 11,
  fontWeight: 900,
  color: "#0891b2",
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  marginBottom: 4,
};

const tenantTitleStyle = {
  color: "#0f172a",
  fontSize: 14,
  lineHeight: 1.5,
};

const tenantBackLinkStyle = {
  color: "#0f172a",
  border: "1px solid #bae6fd",
  backgroundColor: "#fff",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 800,
  textDecoration: "none",
  whiteSpace: "nowrap" as const,
};

const wizardStepsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
  gap: 10,
  marginBottom: 18,
};

const wizardStepStyle = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  minWidth: 0,
  border: "1px solid #e2e8f0",
  backgroundColor: "#f8fafc",
  borderRadius: 10,
  padding: "10px 12px",
  color: "#334155",
  fontSize: 12,
  fontWeight: 750,
};

const wizardStepNumberStyle = {
  width: 22,
  height: 22,
  borderRadius: 999,
  backgroundColor: "#0f172a",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 900,
};

const noAccessStyle = {
  background: "linear-gradient(135deg, #07111f 0%, #0f172a 58%, #155e75 100%)",
  borderRadius: 14,
  padding: 24,
  color: "#e0f2fe",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 18,
  marginTop: 20,
};

const fieldGroup = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase" as const,
  color: "#475569",
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  fontSize: 14,
};

const textareaStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  fontSize: 14,
  minHeight: 90,
  resize: "vertical" as const,
};

const fieldGroupWithTop = {
  ...fieldGroup,
  marginTop: 18,
};

const helperTextStyle = {
  color: "#64748b",
  fontSize: 12,
  lineHeight: 1.6,
};

const customProviderStyle = {
  marginTop: 18,
  border: "1px solid #dbeafe",
  borderRadius: 12,
  background: "#f8fafc",
  padding: 18,
};

const customHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 4,
};

const simpleConnectStyle = {
  marginTop: 18,
  border: "1px solid #bae6fd",
  borderRadius: 12,
  background: "#ffffff",
  padding: 18,
};

const safeBadgeStyle = {
  border: "1px solid #bae6fd",
  background: "#ecfeff",
  color: "#155e75",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 11,
  fontWeight: 900,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  whiteSpace: "nowrap" as const,
};

const providerWizardSectionStyle = {
  marginTop: 18,
  borderTop: "1px solid #e2e8f0",
  paddingTop: 18,
};

const providerWizardSectionTitleStyle = {
  margin: 0,
  color: "#0f172a",
  fontSize: 16,
  fontWeight: 850,
};

const providerWizardSectionCopyStyle = {
  margin: "6px 0 0 0",
  color: "#64748b",
  fontSize: 13,
  lineHeight: 1.6,
};

const warningStyle = {
  marginTop: 12,
  background: "#fffbeb",
  border: "1px solid #fde68a",
  borderRadius: 10,
  padding: 12,
  color: "#92400e",
  fontSize: 13,
  lineHeight: 1.6,
};

const autoActionsStyle = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap" as const,
  marginTop: 14,
};

const buttonInlineStyle = {
  background: "#0f172a",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer",
};

const emptyNoteLightStyle = {
  marginTop: 12,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: 12,
  color: "#475569",
  fontSize: 13,
  lineHeight: 1.6,
};

const detectionResultStyle = {
  marginTop: 14,
  border: "1px solid #bae6fd",
  background: "#f0f9ff",
  borderRadius: 12,
  padding: 14,
};

const detectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const detectionTitleStyle = {
  color: "#0f172a",
  fontSize: 14,
  fontWeight: 850,
};

const detectionMetaStyle = {
  color: "#64748b",
  fontSize: 12,
  lineHeight: 1.5,
  marginTop: 3,
};

const detectionGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
  marginTop: 12,
};

const detectionWarningStyle = {
  marginTop: 12,
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 10,
  padding: 10,
  color: "#9a3412",
  fontSize: 12,
  lineHeight: 1.6,
};

const progressShellStyle = {
  marginTop: 14,
  border: "1px solid #dbeafe",
  background: "#f8fafc",
  borderRadius: 12,
  padding: 14,
};

const progressHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const progressListStyle = {
  display: "grid",
  gap: 9,
  marginTop: 12,
};

const progressStepStyle = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  border: "1px solid #e2e8f0",
  background: "#fff",
  borderRadius: 10,
  padding: 10,
};

const progressTextStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 3,
  color: "#334155",
  fontSize: 12,
  lineHeight: 1.45,
};

const successPanelStyle = {
  marginTop: 14,
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  borderRadius: 12,
  padding: 16,
};

const failurePanelStyle = {
  marginTop: 14,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  borderRadius: 12,
  padding: 16,
};

const outcomeTitleStyle = {
  color: "#0f172a",
  fontSize: 15,
  fontWeight: 850,
};

const outcomeCopyStyle = {
  marginTop: 6,
  color: "#475569",
  fontSize: 13,
  lineHeight: 1.6,
};

const outcomeGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 10,
  marginTop: 14,
};

const outcomeActionRowStyle = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap" as const,
  marginTop: 12,
};

const advancedTroubleshootingIntroStyle = {
  marginTop: 12,
  color: "#475569",
  fontSize: 13,
  lineHeight: 1.6,
};

function progressDotStyle(state: ProgressStepState) {
  const colors: Record<ProgressStepState, { background: string; color: string }> = {
    waiting: { background: "#e2e8f0", color: "#475569" },
    running: { background: "#cffafe", color: "#155e75" },
    success: { background: "#dcfce7", color: "#166534" },
    warning: { background: "#fef3c7", color: "#92400e" },
    failed: { background: "#fee2e2", color: "#991b1b" },
    skipped: { background: "#f1f5f9", color: "#64748b" },
  };
  return {
    width: 28,
    minWidth: 28,
    height: 28,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 900,
    ...colors[state],
  };
}

const suggestionListStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
  marginTop: 12,
};

const suggestionItemStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
  border: "1px solid #dbeafe",
  background: "#fff",
  borderRadius: 10,
  padding: 10,
  color: "#334155",
  fontSize: 12,
};

const rowPathButtonWrapStyle = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap" as const,
  marginTop: 12,
};

const rowPathButtonStyle = {
  background: "#ffffff",
  color: "#0f172a",
  border: "1px solid #bae6fd",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 850,
  cursor: "pointer",
};

const smallButtonStyle = {
  background: "#0f172a",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 850,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
};

const smallLinkButtonStyle = {
  ...smallButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const debugPreStyle = {
  marginTop: 10,
  background: "#0f172a",
  color: "#e2e8f0",
  borderRadius: 10,
  padding: 12,
  overflow: "auto",
  fontSize: 12,
  lineHeight: 1.5,
  maxHeight: 320,
};

const noticeStyle = {
  marginTop: 18,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  padding: 14,
  borderRadius: 10,
  color: "#334155",
  fontSize: 13,
};

const templatePreviewStyle = {
  marginTop: 18,
  border: "1px solid #dbeafe",
  background: "#f8fafc",
  borderRadius: 12,
  padding: 16,
};

const previewGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
};

const previewMetricStyle = {
  border: "1px solid #e2e8f0",
  background: "#fff",
  borderRadius: 10,
  padding: 12,
};

const previewMetricLabelStyle = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 850,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  marginBottom: 6,
};

const previewMetricValueStyle = {
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 850,
  lineHeight: 1.4,
};

const previewNoteStyle = {
  marginTop: 12,
  color: "#334155",
  fontSize: 13,
  lineHeight: 1.6,
};

const internalTemplateBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid #fed7aa",
  background: "#fff7ed",
  color: "#9a3412",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 11,
  fontWeight: 900,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  marginBottom: 12,
};

const templateAdvancedStyle = {
  marginTop: 14,
  borderTop: "1px solid #e2e8f0",
  paddingTop: 12,
};

const templateAdvancedSummaryStyle = {
  cursor: "pointer",
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 850,
};

const buttonStyle = {
  marginTop: 24,
  background: "#0f172a",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "12px 18px",
  fontWeight: 800,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const emptyTemplateStyle = {
  background: "linear-gradient(135deg, #07111f 0%, #0f172a 58%, #155e75 100%)",
  borderRadius: 18,
  padding: 28,
  color: "#e0f2fe",
  border: "1px solid rgba(14, 165, 233, 0.28)",
};

const emptyBadgeStyle = {
  display: "inline-flex",
  border: "1px solid rgba(125, 211, 252, 0.35)",
  borderRadius: 999,
  padding: "6px 10px",
  color: "#bae6fd",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase" as const,
  letterSpacing: 0,
  marginBottom: 16,
};

const emptyTitleStyle = {
  margin: 0,
  color: "#ffffff",
  fontSize: 24,
  fontWeight: 850,
};

const emptyBodyStyle = {
  color: "#cbd5e1",
  fontSize: 14,
  lineHeight: 1.7,
  maxWidth: 620,
  marginTop: 10,
};

const emptyActionsStyle = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap" as const,
  marginTop: 20,
};

const secondaryLinkStyle = {
  marginTop: 24,
  color: "#e0f2fe",
  border: "1px solid rgba(226, 232, 240, 0.35)",
  borderRadius: 8,
  padding: "12px 18px",
  fontWeight: 800,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const emptyNoteStyle = {
  marginTop: 22,
  background: "rgba(15, 23, 42, 0.55)",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  borderRadius: 12,
  padding: 14,
  color: "#bae6fd",
  fontSize: 13,
};

const errorStyle = {
  marginTop: 16,
  background: "rgba(127, 29, 29, 0.45)",
  border: "1px solid rgba(248, 113, 113, 0.35)",
  borderRadius: 10,
  padding: 12,
  color: "#fecaca",
  fontSize: 13,
};

const requestSectionStyle = {
  marginTop: 18,
  border: "1px solid #dbeafe",
  borderRadius: 12,
  background: "#f8fafc",
  padding: 16,
};

const requestTitleStyle = {
  color: "#0f172a",
  fontWeight: 850,
  fontSize: 15,
};

const requestCopyStyle = {
  margin: "6px 0 0 0",
  color: "#64748b",
  fontSize: 13,
  lineHeight: 1.6,
};

const secondaryButtonStyle = {
  marginTop: 12,
  background: "#ffffff",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer",
};

const requestFormStyle = {
  marginTop: 16,
  borderTop: "1px solid #e2e8f0",
  paddingTop: 16,
};

const requestSuccessStyle = {
  marginTop: 16,
  background: "#ecfeff",
  border: "1px solid #67e8f9",
  borderRadius: 10,
  padding: 14,
  color: "#155e75",
  fontSize: 13,
  lineHeight: 1.6,
};

const requestErrorStyle = {
  marginTop: 12,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 10,
  padding: 12,
  color: "#991b1b",
  fontSize: 13,
};
