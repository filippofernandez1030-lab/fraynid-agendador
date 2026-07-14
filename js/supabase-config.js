// ---------- Conexión con Supabase ----------
// Estos dos valores están en tu proyecto de Supabase:
// Dashboard > Project Settings > API
//   Project URL      -> SUPABASE_URL
//   anon public key  -> SUPABASE_ANON_KEY
//
// Es seguro exponer estos valores en el frontend (son públicos por diseño):
// la anon key solo puede hacer lo que las políticas de Row Level Security
// permitan. Ver supabase-schema.sql para esas políticas.
var SUPABASE_URL = "https://cgjfbfnbungfvpcxabjc.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_3179BDXg2Z8vlWStLyFkZg_1M7IAHrZ";

var supabaseClient = null;

if (SUPABASE_URL.indexOf("TU_") !== 0 && window.supabase) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.warn("Supabase no está configurado todavía: completa js/supabase-config.js");
}
