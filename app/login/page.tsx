'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '../lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    const name = username.trim();
    if (!name) return alert('ユーザー名を入力してください');
    setBusy(true);

    // 未使用変数を出さないように、error のみ取り出す
    const { error: signErr } = await supabase.auth.signInAnonymously();
    if (signErr) {
      setBusy(false);
      return alert(`anonymous sign-in failed: ${signErr.message}`);
    }

    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      setBusy(false);
      return alert('サインインに失敗しました（uidなし）');
    }

    const { error: upsertErr } = await supabase
      .from('profiles')
      .upsert({ id: uid, username: name }, { onConflict: 'id' });

    if (upsertErr) {
      setBusy(false);
      return alert(`ユーザー名の登録に失敗: ${upsertErr.message}`);
    }

    router.replace('/');
  };

  return (
    <div style={{ maxWidth: 420, margin: '40px auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <Image src="/top.png" alt="Top" width={320} height={80} style={{ height: 'auto' }} />
      </div>

      <h1 style={{ marginBottom: 10 }}>ユーザー名で入室</h1>
      <p style={{ opacity: 0.7, marginBottom: 12 }}>
        Googleやメールは不要です。任意のユーザー名を入力して入室してください。
      </p>

      <input
        placeholder="ユーザー名（例: tanaka）"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !busy && enter()}
        disabled={busy}
        style={{ width: '100%', padding: 8, border: '1px solid #9ca3af', borderRadius: 6 }}
      />

      <button
        onClick={enter}
        disabled={busy}
        style={{
          marginTop: 10,
          width: '100%',
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          padding: '10px 12px',
          borderRadius: 8,
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? '入室中…' : '入室'}
      </button>

      <p style={{ opacity: 0.6, marginTop: 10, fontSize: 12 }}>
        ※ 匿名セッションはブラウザに保存されます。サインアウトや保存削除で別人扱いになります。
      </p>
    </div>
  );
}
