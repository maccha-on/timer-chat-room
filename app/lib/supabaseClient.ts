'use client';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabaseクライアント（Next.jsクライアント側用）
 * .env.local から環境変数を読み取ります。
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,     // セッションをブラウザに保持
      autoRefreshToken: true,   // トークン期限を自動延長
    },
  }
);

await supabase.from('room_members').upsert(
  { room_id, user_id: session.user.id },
  { onConflict: 'room_id,user_id' }
);
