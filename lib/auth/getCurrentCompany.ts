// lib/auth/getCurrentCompany.ts
import { supabaseAdmin } from "../supabaseAdmin";

export async function getCurrentCompany(userId: string) {
  const { data: companyUser, error } = await supabaseAdmin
    .from("company_users")
    .select("company_id")
    .eq("user_id", userId)
    .single();

  if (error || !companyUser) throw new Error("User not associated with any company");

  const { data: company, error: cError } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug")
    .eq("id", companyUser.company_id)
    .single();

  if (cError || !company) throw new Error("Company not found");

  return company;
}
