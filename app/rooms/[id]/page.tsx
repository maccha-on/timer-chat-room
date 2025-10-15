'use client';

import { supabase } from '../../lib/supabaseClient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';

type Message = {
  id: number;
  user_id: string | null;
  body: string;
  created_at: string;
};

type TimerRow = {
  room_id: string;
  deadline_at: string | null;      // 0になる時刻（UTC）
  duration_seconds: number | null; // 入力された合計秒
  updated_at?: string;
};

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const roomId = id as string;

  // 認証/本人情報
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');

  // チャット
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  // タイマー
  const [timer, setTimer] = useState<TimerRow | null>(null);
  const [tick, setTick] = useState(0); // 1秒ごとに再描画
  const [minStr, setMinStr] = useState('0');
  const [secStr, setSecStr] = useState('30');

  // お題＆役割
  const [roundId, setRoundId] = useState<number | null>(null);
  const [roundTopic, setRoundTopic] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<'presenter' | 'insider' | 'common' | null>(null);
  const [issuing, setIssuing] = useState(false);

  // ゴング音
  const gongRef = useRef<HTMLAudioElement | null>(null);
  const gongPlayedRef = useRef(false);

  // ========== 認証 & プロフィール ==========
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        location.href = '/login';
        return;
      }
      setReady(true);
      setUserId(data.session.user.id);

      const { data: p } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', data.session.user.id)
        .single();
      setUsername(p?.username ?? '(anonymous)');
    })();
  }, []);

  // ========== 初期ロード ==========
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const { data: msg } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('id', { ascending: true })
        .limit(200);
      setMessages((msg as Message[] | null) ?? []);

      const { data: t } = await supabase
        .from('timers')
        .select('room_id, deadline_at, duration_seconds, updated_at')
        .eq('room_id', roomId)
        .single();
      setTimer((t as TimerRow | null) ?? null);

      await fetchLatestRoundAndMyRole();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, roomId]);

  // ヘルパー：最新ラウンド＆自分の役割
  const fetchLatestRoundAndMyRole = async () => {
    const { data: latest } = await supabase
      .from('rounds')
      .select('id, topic, room_id, created_at')
      .eq('room_id', roomId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      setRoundId(null);
      setRoundTopic(null);
      setMyRole(null);
      return;
    }

    const latestId = (latest as { id: number; topic: string }).id;
    const latestTopic = (latest as { id: number; topic: string }).topic;
    setRoundId(latestId);

    let role: 'presenter' | 'insider' | 'common' | null = null;
    if (userId) {
      const { data: my } = await supabase
        .from('round_roles')
        .select('role')
        .eq('round_id', latestId)
        .eq('user_id', userId)
        .maybeSingle();
      role = ((my as { role?: 'presenter' | 'insider' | 'common' } | null)?.role) ?? 'common';
    }

    setMyRole(role);
    setRoundTopic(role === 'presenter' || role === 'insider' ? latestTopic : null);
  };

  // ========== Realtime 購読 ==========
  useEffect(() => {
    if (!ready || !userId) return;

    const channel = supabase
      .channel(`room:${roomId}`)

      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message]),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'timers', filter: `room_id=eq.${roomId}` },
        (payload) => {
          setTimer(payload.new as TimerRow);
          gongPlayedRef.current = false;
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rounds', filter: `room_id=eq.${roomId}` },
        async () => {
          await fetchLatestRoundAndMyRole();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round_roles', filter: `user_id=eq.${userId}` },
        async () => {
          await fetchLatestRoundAndMyRole();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ready, roomId, userId]);

  // ========== 1秒刻み更新 ==========
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // 残りms（deadline_at まで）
  const remainMs = useMemo(() => {
    if (!timer?.deadline_at) return 0;
    const deadline = new Date(timer.deadline_at).getTime();
    return Math.max(0, deadline - Date.now());
    // tick で毎秒再計算。余計な依存は入れない（lint警告回避）
  }, [timer?.deadline_at, tick]);

  // 0になったらゴング
  useEffect(() => {
    if (!timer?.deadline_at) {
      gongPlayedRef.current = false;
      return;
    }
    if (remainMs === 0 && !gongPlayedRef.current) {
      gongPlayedRef.current = true;
      void gongRef.current?.play().catch(() => {});
    }
    if (remainMs > 0) gongPlayedRef.current = false;
  }, [remainMs, timer?.deadline_at]);

  const fmt = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  // ========== 操作 ==========
  const issueTopic = async () => {
    if (!userId) return;
    setIssuing(true);
    try {
      const resp = await fetch('/api/generate-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, requesterId: userId }),
      });
      const json = (await resp.json()) as { roundId?: number; myRole?: 'presenter' | 'insider' | 'common'; topic?: string | null; error?: string };
      if (!resp.ok) {
        alert(`お題生成に失敗: ${json.error || 'unknown error'}`);
        return;
      }
      setRoundId(json.roundId ?? null);
      setMyRole(json.myRole ?? null);
      setRoundTopic(json.topic ?? null);
    } finally {
      setIssuing(false);
    }
  };

  const startCountdown = async () => {
    const m = Number.parseInt(minStr, 10);
    const s = Number.parseInt(secStr, 10);
    const mm = Number.isFinite(m) && m > 0 ? m : 0;
    const ss = Number.isFinite(s) && s > 0 ? s : 0;
    const total = mm * 60 + ss;
    if (total <= 0) return alert('1秒以上を入力してください');

    const deadline = new Date(Date.now() + total * 1000).toISOString();

    const { data: existing } = await supabase
      .from('timers')
      .select('room_id')
      .eq('room_id', roomId)
      .maybeSingle();
    if (!existing) {
      await supabase.from('timers').insert({ room_id: roomId, deadline_at: deadline, duration_seconds: total });
    } else {
      await supabase.from('timers').update({ deadline_at: deadline, duration_seconds: total }).eq('room_id', roomId);
    }
  };

  const resetCountdown = async () => {
    const { data: existing } = await supabase
      .from('timers')
      .select('room_id')
      .eq('room_id', roomId)
      .maybeSingle();
    if (!existing) {
      await supabase.from('timers').insert({ room_id: roomId, deadline_at: null, duration_seconds: null });
    } else {
      await supabase.from('timers').update({ deadline_at: null, duration_seconds: null }).eq('room_id', roomId);
    }
    gongPlayedRef.current = false;
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    await supabase.from('messages').insert({ room_id: roomId, body: input, user_id: u.user?.id ?? null });
    setInput('');
  };

  if (!ready) return <p>Loading...</p>;

  return (
    <div style={{ maxWidth: 980, margin: '20px auto' }}>
      {/* ヘッダー：画像＋退出＋ユーザー名＆役割 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <Image src="/top.png" alt="Top" width={480} height={120} style={{ height: 'auto' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => {
              location.href = '/';
            }}
            style={{ background: '#6b7280', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}
          >
            退出
          </button>
          <div style={{ minWidth: 200, textAlign: 'right', fontWeight: 600 }}>
            {username}
            {myRole && (
              <span style={{ marginLeft: 8, fontWeight: 500, color: '#2563eb' }}>
                {myRole === 'presenter' ? '（出題者）' : myRole === 'insider' ? '（インサイダー）' : '（一般）'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* お題 */}
      <section style={{ marginBottom: 16 }}>
        <h2>お題</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button
            onClick={issueTopic}
            disabled={issuing}
            style={{ background: '#9333ea', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8 }}
            title="ルーム全員からランダムに 出題者とインサイダー を選び、2人だけにお題を表示します"
          >
            {issuing ? '出題中…' : '出題'}
          </button>

          <div style={{ marginLeft: 12, fontSize: 20 }}>
            {roundId ? (roundTopic ? <span>お題：<b>{roundTopic}</b></span> : <span>お題：<i>???（非表示）</i></span>) : <span style={{ opacity: 0.7 }}>まだ出題はありません</span>}
          </div>
        </div>
        <p style={{ opacity: 0.7, margin: 0 }}>※ 出題者とインサイダー以外には、お題は表示されません（Realtimeで全員に反映）。</p>
      </section>

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: '1fr 1fr' }}>
        {/* チャット */}
        <section>
          <h2>Chat</h2>
          <div style={{ border: '1px solid #ccc', height: 360, overflow: 'auto', padding: 8 }}>
            {messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 6 }}>
                <span style={{ opacity: 0.6, marginRight: 6 }}>{new Date(m.created_at).toLocaleTimeString()}</span>
                <span>{m.body}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type message..."
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              style={{ flex: 1, border: '1px solid #9ca3af', padding: '6px 8px', borderRadius: 6 }}
            />
            <button onClick={sendMessage} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8 }}>
              Send
            </button>
          </div>
        </section>

        {/* カウントダウン */}
        <section>
          <h2>Shared Countdown</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label>Minutes</label>
            <input
              type="number"
              min={0}
              value={minStr}
              onChange={(e) => setMinStr(e.target.value)}
              style={{ width: 100, border: '1px solid #9ca3af', padding: '6px 8px', borderRadius: 6 }}
            />
            <label>Seconds</label>
            <input
              type="number"
              min={0}
              max={59}
              value={secStr}
              onChange={(e) => setSecStr(e.target.value)}
              style={{ width: 100, border: '1px solid #9ca3af', padding: '6px 8px', borderRadius: 6 }}
            />
          </div>

          <div style={{ fontSize: 48, margin: '16px 0' }}>{fmt(remainMs)}</div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={startCountdown} style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8 }}>
              Start
            </button>
            <button onClick={resetCountdown} style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8 }}>
              Reset
            </button>
          </div>

          <audio ref={gongRef} src="/gong.mp3" preload="auto" />
        </section>
      </div>
    </div>
  );
}
