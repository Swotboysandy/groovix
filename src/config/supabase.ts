import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './private';


export const supabase = createClient(SUPABASE_URL || 'https://jam-disabled.invalid', SUPABASE_ANON_KEY || 'disabled', {
    auth: {
        storage: AsyncStorage,
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
    },
});
