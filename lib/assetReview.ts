export function isPendingAssetReview(asset: any) {
  return (
    String(asset?.status || "").trim().toLowerCase() === "active" &&
    String(asset?.billing_status || "").trim().toLowerCase() === "unreviewed" &&
    !Boolean(asset?.intelligence_enabled)
  );
}
