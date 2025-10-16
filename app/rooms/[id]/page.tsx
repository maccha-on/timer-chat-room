'use client';

import { supabase } from '../../lib/supabaseClient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from '@supabase/supabase-js';

type Message = {
  id: number;
  user_id: string | null;
  body: string;
  created_at: string;
  username?: string;
};

type TimerRow = {
  room_id: string;
  deadline_at: string | null;
  duration_seconds: number | null;
  updated_at?: string;
};

type Profile = { username: string; id: string };
type Score = { room_id: string; user_id: string; score: number };

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const roomId = id as string;

  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [timer, setTimer] = useState<TimerRow | null>(null);
  const [tick, setTick] = useState(0);
  const [minStr, setMinStr] = useState('0');
  const [secStr, setSecStr] = useState('30');

  const [members, setMembers] = useState<Profile[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const gongRef = useRef<HTMLAudioElement | null>(null);
  const gongPlayedRef = useRef(false);

  // 認証と入室登録
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        location.href = '/login';
        return;
      }
      setReady(true);
      setUserId(data.session.user.id);
      const { data: p } = await supabase.from('profiles').select('username').eq('id', data.session.user.id).single();
      setUsername(p?.username ?? '(anonymous)');
      // room_members 登録
      await supabase.from('room_members').upsert(
        { room_id: roomId, user_id: data.session.user.id },
        { onConflict: 'room_id,user_id' }
      );
      // room_scores 登録（初期値0）
      await supabase.from('room_scores').upsert(
        { room_id: roomId, user_id: data.session.user.id, score: 0 },
        { onConflict: 'room_id,user_id' }
      );
    })();
  }, [roomId]);

  // 各データロード
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const { data: msg } = await supabase
        .from('messages')
        .select('*, profiles(username)')
        .eq('room_id', roomId)
        .order('id', { ascending: true });
      const mapped = (msg ?? []).map((m: any) => ({
        id: m.id,
        body: m.body,
        created_at: m.created_at,
        user_id: m.user_id,
        username: m.profiles?.username ?? 'anonymous',
      }));
      setMessages(mapped);
      const { data: t } = await supabase
        .from('timers')
        .select('room_id, deadline_at, duration_seconds, updated_at')
        .eq('room_id', roomId)
        .single();
      setTimer(t ?? null);
      await fetchMembers();
      await fetchScores();
    })();
  }, [ready, roomId]);

  // メンバー一覧
  const fetchMembers = async () => {
    const { data } = await supabase
      .from('room_members')
      .select('user_id, profiles(username)')
      .eq('room_id', roomId);
    setMembers((data ?? []).map((m: any) => ({ id: m.user_id, username: m.profiles?.username ?? 'anonymous' })));
  };

  // スコア一覧
  const fetchScores = async () => {
    const { data } = await supabase.from('room_scores').select('*').eq('room_id', roomId);
    const dict: Record<string, number> = {};
    (data ?? []).forEach((r: any) => (dict[r.user_id] = r.score));
    setScores(dict);
  };

  // スコア変更
  const updateScore = async (uid: string, delta: number) => {
    const newVal = (scores[uid] ?? 0) + delta;
    setScores((prev) => ({ ...prev, [uid]: newVal }));
    await supabase.from('room_scores').upsert({ room_id: roomId, user_id: uid, score: newVal });
  };

  // Realtime購読
  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload: RealtimePostgresInsertPayload<Message>) => {
          fetchMembers();
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'timers', filter: `room_id=eq.${roomId}` },
        (payload: RealtimePostgresUpdatePayload<TimerRow>) => {
          setTimer(payload.new);
          gongPlayedRef.current = false;
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_scores', filter: `room_id=eq.${roomId}` }, () =>
        fetchScores()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ready, roomId]);

  // タイマー同期
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const remainMs = useMemo(() => {
    if (!timer?.deadline_at) return 0;
    const deadline = new Date(timer.deadline_at).getTime();
    return Math.max(0, deadline - Date.now());
  }, [timer?.deadline_at, tick]);

  useEffect(() => {
    if (!timer?.deadline_at) return;
    if (remainMs === 0 && !gongPlayedRef.current) {
      gongPlayedRef.current = true;
      void gongRef.current?.play().catch(() => {});
    }
  }, [remainMs, timer?.deadline_at]);

  const fmt = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  const startCountdown = async () => {
    const total = parseInt(minStr) * 60 + parseInt(secStr);
    const deadline = new Date(Date.now() + total * 1000).toISOString();
    const { data: existing } = await supabase
      .from('timers')
      .select('room_id')
      .eq('room_id', roomId)
      .maybeSingle();
    if (!existing)
      await supabase.from('timers').insert({ room_id: roomId, deadline_at: deadline, duration_seconds: total });
    else await supabase.from('timers').update({ deadline_at: deadline, duration_seconds: total }).eq('room_id', roomId);
  };

  const resetCountdown = async () => {
    await supabase.from('timers').update({ deadline_at: null, duration_seconds: null }).eq('room_id', roomId);
    gongPlayedRef.current = false;
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    await supabase.from('messages').insert({ room_id: roomId, body: input, user_id: userId });
    setInput('');
  };

  if (!ready) return <p>Loading...</p>;

  return (
    <div style={{ maxWidth: 980, margin: '20px auto' }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
        <Image src="/top.png" alt="Top" width={320} height={80} style={{ height: 'auto' }} />
        <div style={{ fontWeight: 600 }}>ユーザー名: {username}</div>
      </div>

      {/* メンバー + スコア */}
      <section style={{ marginBottom: 12 }}>
        <h3>入室中のユーザー</h3>
        <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
          {members.map((m) => (
            <li key={m.id} style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 600, marginRight: 8 }}>{m.username}</span>
              <span style={{ marginRight: 8 }}>得点: {scores[m.id] ?? 0}</span>
              <button
                onClick={() => updateScore(m.id, +1)}
                style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '2px 8px' }}
              >
                +
              </button>
              <button
                onClick={() => updateScore(m.id, -1)}
                style={{
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '2px 8px',
                  marginLeft: 4,
                }}
              >
                -
              </button>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: 14, color: '#6b7280', marginTop: 8 }}>
          ※得点は全員がリアルタイムで共有されます。<br />
          ＋／－ボタンで、どのメンバーの得点も変更できます。
        </p>
      </section>

      {/* 残りは同じ（チャット＋タイマー） */}
      {/* ・・・上のコードと同様・・・ */}
    </div>
  );
}
