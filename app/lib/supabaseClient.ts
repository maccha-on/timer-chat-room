// lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

// Supabase の URL と anon key を環境変数から取得
// ※ これらは Vercel の「Environment Variables」に設定しておく
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// createClient は1度だけ呼び出す
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true, // セッションを維持（ログイン状態保持）
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 5, // Realtime購読の更新頻度制御
    },
  },
});

export default supabase;
