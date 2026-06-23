import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Exportando o objeto direto para o index.js conseguir usar o .from().eq()
export const supabase = createClient(supabaseUrl, supabaseKey);