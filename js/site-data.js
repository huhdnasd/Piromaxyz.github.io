import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://pebvzrjgaqsmorkavudh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_64n9k6O1TcuN_Tv-TjnDjg_UslY7Pph";

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

export async function loadSiteData({ fallbackOnError = true } = {}) {
    if (!isSupabaseConfigured) return DEFAULT_SITE_DATA;

    const { data, error } = await supabase
        .from("site_settings")
        .select("settings")
        .eq("id", "public")
        .single();

    if (error) {
        console.error("Could not load site settings:", error.message);
        if (!fallbackOnError) throw error;
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