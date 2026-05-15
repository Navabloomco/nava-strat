import { reverseGeocode } from "../location/reverseGeocode";
import { supabaseAdmin } from "../supabaseAdmin";

export type FleetLocationBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

type FleetLocationOptions = {
  maxAgeMinutes?: number;
  includeLocation?: boolean;
};

type CountryDefinition = {
  name: string;
  bounds: FleetLocationBounds;
  aliases: string[];
};

const DEFAULT_MAX_AGE_MINUTES = 30;

const COUNTRY_DEFINITIONS: CountryDefinition[] = [
  {
    name: "Uganda",
    bounds: { minLat: -1.6, maxLat: 4.3, minLng: 29.5, maxLng: 35.1 },
    aliases: ["uganda"],
  },
  {
    name: "Kenya",
    bounds: { minLat: -4.8, maxLat: 5.3, minLng: 33.9, maxLng: 42.1 },
    aliases: ["kenya"],
  },
  {
    name: "Tanzania",
    bounds: { minLat: -11.8, maxLat: -0.9, minLng: 29.2, maxLng: 40.5 },
    aliases: ["tanzania"],
  },
  {
    name: "Rwanda",
    bounds: { minLat: -2.9, maxLat: -1.0, minLng: 28.8, maxLng: 30.9 },
    aliases: ["rwanda"],
  },
  {
    name: "Ethiopia",
    bounds: { minLat: 3.4, maxLat: 14.9, minLng: 32.9, maxLng: 48.0 },
    aliases: ["ethiopia"],
  },
  {
    name: "South Sudan",
    bounds: { minLat: 3.5, maxLat: 12.3, minLng: 23.4, maxLng: 35.9 },
    aliases: ["south sudan"],
  },
  {
    name: "Democratic Republic of Congo",
    bounds: { minLat: -13.5, maxLat: 5.4, minLng: 12.1, maxLng: 31.3 },
    aliases: [
      "democratic republic of congo",
      "drc",
      "congo",
      "dr congo",
    ],
  },
];

function validCoordinate(latitude: any, longitude: any) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function inBounds(latitude: number, longitude: number, bounds: FleetLocationBounds) {
  return (
    latitude >= bounds.minLat &&
    latitude <= bounds.maxLat &&
    longitude >= bounds.minLng &&
    longitude <= bounds.maxLng
  );
}

function normalizeCountryName(countryName: string) {
  const normalized = countryName.trim().toLowerCase();
  return COUNTRY_DEFINITIONS.find((country) =>
    country.aliases.includes(normalized)
  );
}

async function enrichLocation(
  latitude: number,
  longitude: number,
  includeLocation?: boolean
) {
  if (!includeLocation) return null;

  const loc = await reverseGeocode(latitude, longitude);
  return loc?.town || loc?.display_name || null;
}

export async function getCurrentFleetLocations(
  companyId: string,
  options: FleetLocationOptions = {}
) {
  const maxAgeMinutes = options.maxAgeMinutes ?? DEFAULT_MAX_AGE_MINUTES;
  const since = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  const { data: assets, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("truck_id, registration, latitude, longitude, last_seen_at, status")
    .eq("company_id", companyId)
    .eq("status", "active")
    .gte("last_seen_at", since.toISOString())
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (error) throw error;

  const trucks = [];

  for (const asset of assets || []) {
    if (!validCoordinate(asset.latitude, asset.longitude)) continue;

    const latitude = Number(asset.latitude);
    const longitude = Number(asset.longitude);
    const freshnessMinutes = asset.last_seen_at
      ? Math.floor((Date.now() - new Date(asset.last_seen_at).getTime()) / 60000)
      : null;
    const location = await enrichLocation(
      latitude,
      longitude,
      options.includeLocation
    );

    trucks.push({
      truck_id: asset.truck_id,
      registration: asset.registration || asset.truck_id,
      latitude,
      longitude,
      last_seen_at: asset.last_seen_at,
      freshness_minutes: freshnessMinutes,
      status: asset.status,
      location,
    });
  }

  return trucks;
}

export async function getCurrentTrucksInBounds(
  companyId: string,
  bounds: FleetLocationBounds,
  options: FleetLocationOptions = {}
) {
  const trucks = await getCurrentFleetLocations(companyId, {
    maxAgeMinutes: options.maxAgeMinutes,
  });

  const trucksInBounds = trucks.filter((truck) =>
    inBounds(truck.latitude, truck.longitude, bounds)
  );

  if (!options.includeLocation) return trucksInBounds;

  return Promise.all(
    trucksInBounds.map(async (truck) => ({
      ...truck,
      location: await enrichLocation(
        truck.latitude,
        truck.longitude,
        options.includeLocation
      ),
    }))
  );
}

export async function getCurrentTrucksInCountry(
  companyId: string,
  countryName: string,
  options: FleetLocationOptions = {}
) {
  const country = normalizeCountryName(countryName);
  if (!country) return [];

  return getCurrentTrucksInBounds(companyId, country.bounds, options);
}

export function detectSupportedCountryName(text: string) {
  const lower = text.toLowerCase();

  const country = COUNTRY_DEFINITIONS.find((definition) =>
    definition.aliases.some((alias) => lower.includes(alias))
  );

  return country?.name || null;
}
