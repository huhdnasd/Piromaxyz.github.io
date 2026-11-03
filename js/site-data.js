import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://pebvzrjgaqsmorkavudh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqemR1Z3dzdWduaWljbGRjcGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzI5NDgsImV4cCI6MjEwODM0ODk0OH0._KQRIg2EkwbERasuG5S-FmAQXxu10Dz4AbbFrwkN3kA";

export const isSupabaseConfigured =
    !SUPABASE_URL.includes("YOUR-PROJECT") &&
    !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY");

export const supabase = isSupabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export const DEFAULT_SITE_DATA = {
    memberCount: 487,
    communityRating: 4.6,
    pricing: { free: 0, premium: 500, ultimate: 1000 },
    status: {
        bot: "Online",
        api: "Online",
        database: "Online",
        discord: "Online"
    },
    incident: "No incidents reported at this time.",
    reviews: []
};

export async function loadSiteData() {
    if (!isSupabaseConfigured) return DEFAULT_SITE_DATA;

    const { data, error } = await supabase
        .from("site_settings")
        .select("settings")
        .eq("id", "public")
        .single();

    if (error) {
        console.error("Could not load site settings:", error.message);
        return DEFAULT_SITE_DATA;
    }

    const settings = data?.settings ?? {};
    return {
        ...DEFAULT_SITE_DATA,
        ...settings,
        pricing: { ...DEFAULT_SITE_DATA.pricing, ...settings.pricing },
        status: { ...DEFAULT_SITE_DATA.status, ...settings.status },
        reviews: Array.isArray(settings.reviews) ? settings.reviews : []
    };
}