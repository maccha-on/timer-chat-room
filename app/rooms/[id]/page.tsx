/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
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

      // ユーザー名取得
      const { data: p } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', data.session.user.id)
        .single();
      const profileUsernameRaw = (p?.username ?? '').trim();
      const profileUsername = profileUsernameRaw || '(anonymous)';
      setUsername(profileUsername);

      // ✅ 入室登録
      await supabase.from('room_members').upsert(
        { room_id: roomId, user_id: data.session.user.id, username: profileUsername },
        { onConflict: 'room_id,user_id' }
      );

      // ✅ スコア初期化
      await supabase.from('room_scores').upsert(
        { room_id: roomId, user_id: data.session.user.id, score: 0 },
        { onConflict: 'room_id,user_id' }
      );
    })();
  }, [roomId]);


  // メンバー一覧
  const fetchMembers = async () => {
    const { data: rms } = await supabase.from('room_members').select('user_id').eq('room_id', roomId);
    const ids = (rms ?? []).map((r) => r.user_id as string);
    if (ids.length === 0) return setMembers([]);
    const { data: profs } = await supabase.from('profiles').select('id, username').in('id', ids);
    const map = new Map<string, string>((profs ?? []).map((p) => [p.id as string, p.username as string]));
    setMembers(ids.map((id) => ({ id, username: map.get(id) ?? 'anonymous' })));
  };

  const fetchScores = async () => {
    const { data } = await supabase.from('room_scores').select('*').eq('room_id', roomId);
    const dict: Record<string, number> = {};
    (data ?? []).forEach((r: any) => (dict[r.user_id] = r.score));
    setScores(dict);
  };

  const fetchAll = async () => {
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
    const { data: t } = await supabase.from('timers').select('*').eq('room_id', roomId).single();
    setTimer(t ?? null);
  };

  useEffect(() => {
    if (!ready) return;
    (async () => {
      await fetchAll();
      await fetchMembers();
      await fetchScores();
    })();
  }, [ready, roomId]);

  const updateScore = async (uid: string, delta: number) => {
    const newVal = (scores[uid] ?? 0) + delta;
    setScores((prev) => ({ ...prev, [uid]: newVal }));
    await supabase.from('room_scores').upsert({ room_id: roomId, user_id: uid, score: newVal });
  };

  // realtime購読
  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_scores', filter: `room_id=eq.${roomId}` }, fetchScores)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, fetchMembers)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => {
        setMessages((prev) => [...prev, payload.new as Message]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'timers', filter: `room_id=eq.${roomId}` }, (payload) => {
        setTimer(payload.new as TimerRow);
        gongPlayedRef.current = false;
      })
      .subscribe();
    // return () => supabase.removeChannel(channel);
    return() => void supabase.removeChannel(channel);
  }, [ready, roomId]);

  // タイマー
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const remainMs = useMemo(() => {
    if (!timer?.deadline_at) return 0;
    return Math.max(0, new Date(timer.deadline_at).getTime() - Date.now());
  }, [timer?.deadline_at, tick]);

  const startCountdown = async () => {
    const total = parseInt(minStr) * 60 + parseInt(secStr);
    const deadline = new Date(Date.now() + total * 1000).toISOString();
    await supabase.from('timers').upsert({ room_id: roomId, deadline_at: deadline, duration_seconds: total });
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    await supabase.from('messages').insert({ room_id: roomId, body: input, user_id: userId });
    setInput('');
  };

  const generateTopic = async () => {
    const res = await fetch('/api/generate-topic', { method: 'POST', body: JSON.stringify({ roomId }) });
    const data = await res.json();
    alert(data.topic ?? '生成に失敗しました');
  };

  if (!ready) return <p>Loading...</p>;

  return (
    <div style={{ maxWidth: 980, margin: '20px auto' }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
        <Image src="/top.png" alt="Top" width={320} height={80} />
        <div style={{ fontWeight: 600 }}>ユーザー名: {username}</div>
      </div>

      {/* 入室者一覧 + スコア */}
      <h3>入室中のユーザー</h3>
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
        {members.map((m) => (
          <li key={m.id}>
            <span style={{ fontWeight: 600 }}>{m.username}</span>　
            <span>得点: {scores[m.id] ?? 0}</span>　
            <button onClick={() => updateScore(m.id, +1)}>＋</button>　
            <button onClick={() => updateScore(m.id, -1)}>－</button>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 13, color: '#666' }}>
        ※得点は全員で共有されます。+ / - ボタンでどのメンバーの得点も変更できます。
      </p>

      {/* タイマー */}
      <div style={{ marginTop: 20 }}>
        <h3>タイマー</h3>
        <input value={minStr} onChange={(e) => setMinStr(e.target.value)} style={{ width: 40 }} />分　
        <input value={secStr} onChange={(e) => setSecStr(e.target.value)} style={{ width: 40 }} />秒　
        <button onClick={startCountdown}>スタート</button>
        <div style={{ fontSize: 32, fontWeight: 'bold', marginTop: 8 }}>
          {String(Math.floor(remainMs / 1000 / 60)).padStart(2, '0')}:
          {String(Math.floor((remainMs / 1000) % 60)).padStart(2, '0')}
        </div>
      </div>

      {/* 出題 */}
      <div style={{ marginTop: 20 }}>
        <h3>お題生成</h3>
        <button onClick={generateTopic}>出題</button>
      </div>

      {/* チャット */}
      <div style={{ marginTop: 20 }}>
        <h3>チャット</h3>
        <div
          style={{
            border: '1px solid #ccc',
            borderRadius: 8,
            height: 200,
            overflowY: 'auto',
            padding: 8,
            background: '#f9fafb',
          }}
        >
          {messages.map((m) => (
            <div key={m.id}>
              <span style={{ color: '#666' }}>
                {new Date(m.created_at).toLocaleTimeString()} {m.username}：
              </span>{' '}
              {m.body}
            </div>
          ))}
        </div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: '80%', marginTop: 8 }}
          placeholder="メッセージを入力..."
        />
        <button onClick={sendMessage} style={{ marginLeft: 8 }}>
          送信
        </button>
      </div>

      <audio ref={gongRef} src="/gong.mp3" preload="auto" />
    </div>
  );
}
