/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { supabase } from '../../lib/supabaseClient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';

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
type Role = 'presenter' | 'insider' | 'common';

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const roomId = id as string;
  const router = useRouter();

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
  const [roundRoles, setRoundRoles] = useState<Record<string, Role>>({});
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [currentTopic, setCurrentTopic] = useState<string | null>(null);
  const [hasTopic, setHasTopic] = useState(false);
  const gongRef = useRef<HTMLAudioElement | null>(null);
  const gongPlayedRef = useRef(false);

  const usernameMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => {
      map.set(m.id, m.username);
    });
    return map;
  }, [members]);

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

  const loadRound = useCallback(
    async (targetRoundId?: number) => {
      type RoundRecord = { id: number; topic: string; room_id?: string };

      let round: RoundRecord | null = null;

      if (targetRoundId) {
        const { data: specific } = await supabase
          .from('rounds')
          .select('id, topic, room_id')
          .eq('id', targetRoundId)
          .maybeSingle();
        if (specific && specific.room_id === roomId) {
          round = specific;
        }
      }

      if (!round) {
        const { data: latest } = await supabase
          .from('rounds')
          .select('id, topic')
          .eq('room_id', roomId)
          .order('created_at', { ascending: false })
          .limit(1);
        round = (latest && latest[0]) ?? null;
      }

      if (!round) {
        setRoundRoles({});
        setMyRole(null);
        setCurrentTopic(null);
        setHasTopic(false);
        return;
      }

      const { data: roleRows } = await supabase
        .from('round_roles')
        .select('user_id, role')
        .eq('round_id', round.id);

      const map: Record<string, Role> = {};
      (roleRows ?? []).forEach((row: { user_id: string; role: Role }) => {
        if (row.user_id) {
          map[row.user_id] = row.role;
        }
      });

      setRoundRoles(map);
      setHasTopic(Boolean(round.topic));

      if (userId) {
        const mine = map[userId] ?? null;
        setMyRole(mine);
        const canSee = mine === 'presenter' || mine === 'insider';
        setCurrentTopic(canSee ? round.topic : null);
      } else {
        setMyRole(null);
        setCurrentTopic(null);
      }
    },
    [roomId, userId]
  );

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

  useEffect(() => {
    if (!ready || !userId) return;
    void loadRound();
  }, [ready, roomId, userId, loadRound]);

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
        const inserted = payload.new as Message;
        const displayName =
          (inserted.user_id ? usernameMap.get(inserted.user_id) : undefined) ?? inserted.username ?? 'anonymous';
        setMessages((prev) => [...prev, { ...inserted, username: displayName }]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'timers', filter: `room_id=eq.${roomId}` }, (payload) => {
        setTimer(payload.new as TimerRow);
        gongPlayedRef.current = false;
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rounds', filter: `room_id=eq.${roomId}` }, (payload) => {
        const newRound = payload.new as { id?: number };
        void loadRound(typeof newRound?.id === 'number' ? newRound.id : undefined);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'round_roles' }, (payload) => {
        const newRole = payload.new as { round_id?: number };
        if (typeof newRole?.round_id === 'number') {
          void loadRound(newRole.round_id);
        }
      })
      .subscribe();
    // return () => supabase.removeChannel(channel);
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ready, roomId, loadRound, usernameMap]);

  // タイマー
  useEffect(() => {
    if (!timer?.deadline_at) return undefined;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [timer?.deadline_at]);

  const remainMs = useMemo(() => {
    if (!timer) return 0;
    if (timer.deadline_at) {
      return Math.max(0, new Date(timer.deadline_at).getTime() - Date.now());
    }
    if (typeof timer.duration_seconds === 'number') {
      return Math.max(0, timer.duration_seconds * 1000);
    }
    return 0;
  }, [timer?.deadline_at, timer?.duration_seconds, tick]);

  useEffect(() => {
    if (!timer) return;
    if (remainMs > 0) return;
    if ((timer.duration_seconds ?? 0) <= 0) return;
    const audio = gongRef.current;
    if (!audio || gongPlayedRef.current) return;
    gongPlayedRef.current = true;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // ignore playback errors (e.g., browser restrictions)
    });
  }, [remainMs, timer?.duration_seconds]);

  const isRunning = Boolean(timer?.deadline_at) && remainMs > 0;
  const isPaused = !timer?.deadline_at && (timer?.duration_seconds ?? 0) > 0;

  const startCountdown = async () => {
    const minutes = Number.parseInt(minStr, 10);
    const seconds = Number.parseInt(secStr, 10);
    const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
    const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
    const total = Math.max(0, safeMinutes * 60 + safeSeconds);
    if (total <= 0) {
      await supabase.from('timers').upsert({ room_id: roomId, deadline_at: null, duration_seconds: 0 });
      return;
    }
    const deadline = new Date(Date.now() + total * 1000).toISOString();
    await supabase
      .from('timers')
      .upsert({ room_id: roomId, deadline_at: deadline, duration_seconds: total });
  };

  const pauseCountdown = async () => {
    if (!timer?.deadline_at) return;
    const remainingSeconds = Math.max(0, Math.ceil(remainMs / 1000));
    await supabase
      .from('timers')
      .update({ deadline_at: null, duration_seconds: remainingSeconds })
      .eq('room_id', roomId);
  };

  const resumeCountdown = async () => {
    const remainingSeconds = Math.max(0, timer?.duration_seconds ?? 0);
    if (remainingSeconds <= 0) return;
    const deadline = new Date(Date.now() + remainingSeconds * 1000).toISOString();
    await supabase
      .from('timers')
      .update({ deadline_at: deadline })
      .eq('room_id', roomId);
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    await supabase.from('messages').insert({ room_id: roomId, body: input, user_id: userId });
    setInput('');
  };

  const generateTopic = async () => {
    if (!userId) {
      alert('ユーザー情報の取得に失敗しました');
      return;
    }

    try {
      const res = await fetch('/api/generate-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, requesterId: userId }),
      });
      const data = (await res.json()) as { topic?: string | null; error?: string; roundId?: number | null };
      if (!res.ok) {
        alert(data?.error ?? '生成に失敗しました');
        return;
      }
      if (data?.roundId) {
        await loadRound(data.roundId ?? undefined);
      }
      if (data?.topic) {
        alert(`お題: ${data.topic}`);
      } else {
        alert('あなたの役割ではお題は表示されません');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === 'string' ? err : '生成に失敗しました';
      alert(message);
    }
  };

  const leaveRoom = async () => {
    if (!userId) {
      router.push('/');
      return;
    }

    try {
      await supabase.from('room_members').delete().eq('room_id', roomId).eq('user_id', userId);
      await supabase.from('room_scores').delete().eq('room_id', roomId).eq('user_id', userId);
    } finally {
      router.push('/');
    }
  };

  if (!ready) return <p>Loading...</p>;

  const roleLabels: Record<Role, string> = {
    presenter: 'マスター',
    insider: 'インサイダー',
    common: '庶民',
  };
  const canSeeTopic = myRole === 'presenter' || myRole === 'insider';

  return (
    <div style={{ maxWidth: 980, margin: '20px auto' }}>
      {/* ヘッダー */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Image src="/top.png" alt="Top" width={320} height={80} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontWeight: 600 }}>ユーザー名: {username}</div>
          <button onClick={leaveRoom}>退出</button>
        </div>
      </div>

      {/* 入室者一覧 + スコア */}
      <h3>入室中のユーザー</h3>
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
        {members.map((m) => (
          <li key={m.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{m.username}</div>
                <div style={{ fontSize: 12, color: '#555' }}>
                  {roundRoles[m.id] ? roleLabels[roundRoles[m.id]] : '役割未設定'}
                </div>
              </div>
              <div>得点: {scores[m.id] ?? 0}</div>
              <button onClick={() => updateScore(m.id, +1)}>＋</button>
              <button onClick={() => updateScore(m.id, -1)}>－</button>
            </div>
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
        {isRunning ? (
          <button onClick={pauseCountdown} style={{ marginLeft: 8 }}>
            一時停止
          </button>
        ) : null}
        {isPaused ? (
          <button onClick={resumeCountdown} style={{ marginLeft: 8 }}>
            再開
          </button>
        ) : null}
        <div style={{ fontSize: 32, fontWeight: 'bold', marginTop: 8 }}>
          {String(Math.floor(remainMs / 1000 / 60)).padStart(2, '0')}:
          {String(Math.floor((remainMs / 1000) % 60)).padStart(2, '0')}
        </div>
      </div>

      {/* 出題 */}
      <div style={{ marginTop: 20 }}>
        <h3>お題生成</h3>
        <button onClick={generateTopic}>出題</button>
        <div style={{ marginTop: 8, fontSize: 14, color: '#333' }}>
          <div>あなたの役割: {myRole ? roleLabels[myRole] : '未設定'}</div>
          {hasTopic ? (
            myRole ? (
              canSeeTopic ? (
                <div style={{ marginTop: 4 }}>お題: {currentTopic ?? ''}</div>
              ) : (
                <div style={{ marginTop: 4, color: '#777' }}>お題はあなたには表示されません</div>
              )
            ) : (
              <div style={{ marginTop: 4, color: '#777' }}>役割がまだ割り当てられていません</div>
            )
          ) : (
            <div style={{ marginTop: 4, color: '#777' }}>お題はまだ生成されていません</div>
          )}
        </div>
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
