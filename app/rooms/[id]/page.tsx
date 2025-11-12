'use client';

import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

type Member = { id: string; username: string };
type MessageRow = { id: number; body: string; created_at: string; user_id: string | null };
type TimerRow = { room_id: string; deadline_at: string | null; duration_seconds: number | null };
type Role = 'presenter' | 'insider' | 'common';

const roleLabels: Record<Role, string> = {
  presenter: 'マスター',
  insider: 'インサイダー',
  common: '庶民',
};

const formatTime = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const roomId = params.id;
  const router = useRouter();

  const [initializing, setInitializing] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('(anonymous)');
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [timerRow, setTimerRow] = useState<TimerRow | null>(null);
  const [, forceTick] = useState(0);
  const [minInput, setMinInput] = useState('0');
  const [secInput, setSecInput] = useState('30');
  const [chatInput, setChatInput] = useState('');
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [currentTopic, setCurrentTopic] = useState<string | null>(null);
  const [hasTopic, setHasTopic] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const gongRef = useRef<HTMLAudioElement | null>(null);
  const gongPlayedRef = useRef(false);

  const usernameMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((member) => {
      map.set(member.id, member.username);
    });
    return map;
  }, [members]);

  useEffect(() => {
    const interval = setInterval(() => {
      forceTick((value) => value + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [forceTick]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        location.href = '/login';
        return;
      }

      if (cancelled) return;

      const uid = data.session.user.id;
      setUserId(uid);

      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', uid)
        .maybeSingle();

      const displayName = profile?.username?.trim() || '(anonymous)';
      if (!cancelled) {
        setUsername(displayName);
      }

      const token = data.session.access_token;
      if (!token) {
        alert('有効なセッションが見つかりませんでした。もう一度ログインしてください。');
        router.replace('/login');
        return;
      }

      const response = await fetch('/api/room-members', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomId, username: displayName }),
      });

      if (!response.ok) {
        let message = response.statusText;
        try {
          const payload = (await response.json()) as { message?: string; error?: string };
          message = payload.message ?? payload.error ?? message;
        } catch {
          // ignore JSON parse errors
        }
        alert(`ルームへの参加に失敗しました: ${message}`);
        router.replace('/');
        return;
      }

      if (!cancelled) {
        setInitializing(false);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [roomId, router]);

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase
      .from('room_members')
      .select('user_id, username')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });

    if (error) {
      console.error('Failed to load room members', error.message);
      return;
    }

    const list = (data ?? []).map((row) => ({
      id: row.user_id,
      username: (row.username ?? 'anonymous').trim() || 'anonymous',
    }));

    setMembers(list);
  }, [roomId]);

  const loadMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('id, body, created_at, user_id')
      .eq('room_id', roomId)
      .order('id', { ascending: true });

    if (error) {
      console.error('Failed to load messages', error.message);
      return;
    }

    setMessages((data ?? []) as MessageRow[]);
  }, [roomId]);

  const loadScores = useCallback(async () => {
    const { data, error } = await supabase
      .from('room_scores')
      .select('user_id, score')
      .eq('room_id', roomId);

    if (error) {
      console.error('Failed to load scores', error.message);
      return;
    }

    const next: Record<string, number> = {};
    (data ?? []).forEach((row) => {
      if (row.user_id) {
        next[row.user_id] = row.score ?? 0;
      }
    });

    setScores(next);
  }, [roomId]);

  const loadTimer = useCallback(async () => {
    const { data, error } = await supabase
      .from('timers')
      .select('room_id, deadline_at, duration_seconds')
      .eq('room_id', roomId)
      .maybeSingle();

    if (error) {
      console.error('Failed to load timer', error.message);
      return;
    }

    setTimerRow(data ?? null);
    gongPlayedRef.current = false;
  }, [roomId]);

  const loadRound = useCallback(
    async (targetRoundId?: number) => {
      if (!userId) return;

      let round: { id: number; topic: string; room_id?: string | null } | null = null;

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
        const { data: latest, error } = await supabase
          .from('rounds')
          .select('id, topic')
          .eq('room_id', roomId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('Failed to load round', error.message);
          return;
        }

        round = latest ?? null;
      }

      if (!round) {
        setHasTopic(false);
        setMyRole(null);
        setCurrentTopic(null);
        return;
      }

      setHasTopic(true);

      const { data: roleRows, error: roleError } = await supabase
        .from('round_roles')
        .select('user_id, role')
        .eq('round_id', round.id);

      if (roleError) {
        console.error('Failed to load round roles', roleError.message);
        setMyRole(null);
        setCurrentTopic(null);
        return;
      }

      const mine = roleRows?.find((row) => row.user_id === userId)?.role as Role | undefined;
      const nextRole: Role | null = mine ?? null;
      setMyRole(nextRole);
      const canSee = nextRole === 'presenter' || nextRole === 'insider';
      setCurrentTopic(canSee ? round.topic : null);
    },
    [roomId, userId]
  );

  useEffect(() => {
    if (initializing || !userId) return;

    void loadMembers();
    void loadMessages();
    void loadScores();
    void loadTimer();
    void loadRound();
  }, [initializing, userId, loadMembers, loadMessages, loadScores, loadTimer, loadRound]);

  useEffect(() => {
    if (initializing) return;

    const channel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, () => {
        void loadMembers();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => {
        const newMessage = payload.new as MessageRow;
        setMessages((prev) => [...prev, newMessage]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_scores', filter: `room_id=eq.${roomId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as { user_id?: string } | null;
          if (oldRow?.user_id) {
            setScores((prev) => {
              const next = { ...prev };
              delete next[oldRow.user_id as string];
              return next;
            });
          }
          return;
        }

        const newRow = payload.new as { user_id?: string; score?: number } | null;
        if (newRow?.user_id) {
          setScores((prev) => ({ ...prev, [newRow.user_id as string]: newRow.score ?? 0 }));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timers', filter: `room_id=eq.${roomId}` }, (payload) => {
        setTimerRow(payload.new as TimerRow);
        gongPlayedRef.current = false;
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rounds', filter: `room_id=eq.${roomId}` }, (payload) => {
        const newRound = payload.new as { id?: number } | null;
        if (typeof newRound?.id === 'number') {
          void loadRound(newRound.id);
        } else {
          void loadRound();
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'round_roles' }, (payload) => {
        const row = payload.new as { round_id?: number } | null;
        if (typeof row?.round_id === 'number') {
          void loadRound(row.round_id);
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [initializing, roomId, loadMembers, loadRound]);

  const remainingMs = (() => {
    if (!timerRow) return 0;

    if (timerRow.deadline_at) {
      return Math.max(0, new Date(timerRow.deadline_at).getTime() - Date.now());
    }

    if (typeof timerRow.duration_seconds === 'number') {
      return Math.max(0, timerRow.duration_seconds * 1000);
    }

    return 0;
  })();

  useEffect(() => {
    if (!timerRow) return;
    if ((timerRow.duration_seconds ?? 0) <= 0) return;
    if (remainingMs > 0) return;

    if (gongPlayedRef.current) return;

    const audio = gongRef.current;
    if (!audio) return;

    gongPlayedRef.current = true;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Ignore playback failures (e.g. browser autoplay policy)
    });
  }, [remainingMs, timerRow]);

  const isRunning = Boolean(timerRow?.deadline_at) && remainingMs > 0;
  const isPaused = !timerRow?.deadline_at && (timerRow?.duration_seconds ?? 0) > 0;

  const startTimer = async () => {
    const minutes = Number.parseInt(minInput, 10);
    const seconds = Number.parseInt(secInput, 10);
    const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
    const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
    const total = Math.max(0, safeMinutes * 60 + safeSeconds);

    if (total <= 0) {
      const { error } = await supabase
        .from('timers')
        .upsert({ room_id: roomId, deadline_at: null, duration_seconds: 0 }, { onConflict: 'room_id' });
      if (error) alert(`タイマー更新に失敗しました: ${error.message}`);
      return;
    }

    const deadline = new Date(Date.now() + total * 1000).toISOString();
    const { error } = await supabase
      .from('timers')
      .upsert({ room_id: roomId, deadline_at: deadline, duration_seconds: total }, { onConflict: 'room_id' });

    if (error) {
      alert(`タイマー更新に失敗しました: ${error.message}`);
    } else {
      gongPlayedRef.current = false;
    }
  };

  // Start timer helper that accepts total seconds (avoids race with setState)
  const startTimerWithTotal = async (totalSeconds: number) => {
    const total = Math.max(0, Math.floor(totalSeconds));

    if (total <= 0) {
      const { error } = await supabase
        .from('timers')
        .upsert({ room_id: roomId, deadline_at: null, duration_seconds: 0 }, { onConflict: 'room_id' });
      if (error) alert(`タイマー更新に失敗しました: ${error.message}`);
      return;
    }

    const deadline = new Date(Date.now() + total * 1000).toISOString();
    const { error } = await supabase
      .from('timers')
      .upsert({ room_id: roomId, deadline_at: deadline, duration_seconds: total }, { onConflict: 'room_id' });

    if (error) {
      alert(`タイマー更新に失敗しました: ${error.message}`);
    } else {
      gongPlayedRef.current = false;
    }
  };

  // Quick action: set inputs to 3:00 and start immediately
  const startThreeMinutes = async () => {
    setMinInput('3');
    setSecInput('0');
    await startTimerWithTotal(3 * 60);
  };
  const startSevenMinutes = async () => {
    setMinInput('7');
    setSecInput('0');
    await startTimerWithTotal(3 * 60);
  };



  const pauseTimer = async () => {
    if (!timerRow) return;

    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const { error } = await supabase
      .from('timers')
      .update({ deadline_at: null, duration_seconds: remainingSeconds })
      .eq('room_id', roomId);

    if (error) {
      alert(`一時停止に失敗しました: ${error.message}`);
    }
  };

  const resumeTimer = async () => {
    const remainingSeconds = Math.max(0, timerRow?.duration_seconds ?? 0);
    if (remainingSeconds <= 0) return;

    const deadline = new Date(Date.now() + remainingSeconds * 1000).toISOString();
    const { error } = await supabase
      .from('timers')
      .update({ deadline_at: deadline })
      .eq('room_id', roomId);

    if (error) {
      alert(`再開に失敗しました: ${error.message}`);
    } else {
      gongPlayedRef.current = false;
    }
  };

  const updateScore = async (targetUserId: string, delta: number) => {
    const current = scores[targetUserId] ?? 0;
    const nextScore = current + delta;
    setScores((prev) => ({ ...prev, [targetUserId]: nextScore }));

    const { error } = await supabase
      .from('room_scores')
      .upsert({ room_id: roomId, user_id: targetUserId, score: nextScore }, { onConflict: 'room_id,user_id' });

    if (error) {
      console.error('Failed to update score', error.message);
      await loadScores();
    }
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || !userId) return;

    const body = chatInput.trim();
    setChatInput('');

    const { error } = await supabase
      .from('messages')
      .insert({ room_id: roomId, body, user_id: userId });

    if (error) {
      alert(`メッセージ送信に失敗しました: ${error.message}`);
      setChatInput(body);
    }
  };

  const generateTopic = async (difficulty: 'normal' | 'hard' | 'expert') => {
    if (!userId) return;

    try {
      const response = await fetch('/api/generate-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, requesterId: userId, difficulty }),
      });

      const payload = (await response.json()) as {
        topic?: string | null;
        error?: string;
        roundId?: number | null;
        myRole?: Role | null;
      };

      if (!response.ok) {
        alert(payload.error ?? '生成に失敗しました');
        return;
      }

      if (payload.roundId) {
        await loadRound(payload.roundId);
      } else {
        await loadRound();
      }

      const canSeeTopicNow = payload.myRole === 'presenter' || payload.myRole === 'insider';

      if (payload.myRole) {
        setMyRole(payload.myRole);
        setCurrentTopic(canSeeTopicNow ? payload.topic ?? null : null);
      }

      if (canSeeTopicNow && payload.topic) {
        alert(`お題: ${payload.topic}`);
      } else if (canSeeTopicNow) {
        alert('お題を取得できませんでした');
      } else {
        alert('あなたの役割ではお題は表示されません');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成に失敗しました';
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

  // Clear past room data: messages, rounds, round_roles, timers, room_scores
  const clearRoomData = async () => {
    if (!confirm('本当にこの部屋の過去データ（ラウンド・スコア・タイマー）を削除しますか？この操作は取り消せません。')) {
      return;
    }

    setIsClearing(true);

    try {
      // 1) delete messages
      const { error: msgErr } = await supabase.from('messages').delete().eq('room_id', roomId);
      if (msgErr) throw msgErr;

      // 2) find rounds for this room
      // 修正前コード
      //const { data: rounds, error: roundsErr } = await supabase.from('rounds').select('id').eq('room_id', roomId);
      //if (roundsErr) throw roundsErr;
      //
      //const roundIds = (rounds ?? []).map((r: any) => r.id).filter((v: any) => typeof v === 'number');

      // 2) find rounds for this room
      const { data: rounds, error: roundsErr } = await supabase
        .from('rounds')
        .select('id')
        .eq('room_id', roomId);

      if (roundsErr) throw roundsErr;

      // rounds が null の場合も想定して、型を明示
      type RoundRecord = { id: number | string | null }; // DBの型に合わせて修正可

      const roundIds = (rounds ?? [])
        .map((r: RoundRecord) => r.id)
        .filter((v): v is number => typeof v === 'number');



      // 3) delete round_roles for those rounds
      if (roundIds.length > 0) {
        const { error: rrErr } = await supabase.from('round_roles').delete().in('round_id', roundIds);
        if (rrErr) throw rrErr;

        const { error: delRoundsErr } = await supabase.from('rounds').delete().in('id', roundIds);
        if (delRoundsErr) throw delRoundsErr;
      }

      // 4) delete timers
      const { error: timersErr } = await supabase.from('timers').delete().eq('room_id', roomId);
      if (timersErr) throw timersErr;

      // 5) delete scores
      const { error: scoresErr } = await supabase.from('room_scores').delete().eq('room_id', roomId);
      if (scoresErr) throw scoresErr;

      // Refresh local state
      await Promise.all([loadMessages(), loadRound(), loadScores(), loadTimer()]);

      alert('部屋のデータを削除しました。');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      alert(`削除に失敗しました: ${message}`);
      console.error('clearRoomData error', e);
    } finally {
      setIsClearing(false);
    }
  };

  if (initializing) {
    return <p style={{ padding: '40px 0', textAlign: 'center' }}>Loading...</p>;
  }

  const myRoleLabel = myRole ? roleLabels[myRole] : '役割未設定';
  const canSeeTopic = myRole === 'presenter' || myRole === 'insider';

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <Image src="/top.png" alt="Top" width={160} height={40} style={{ height: 'auto' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600 }}>ユーザー名: {username}</div>
          <button onClick={clearRoomData} disabled={isClearing} style={{ background: isClearing ? '#f3c6c6' : '#ffdede' }}>
            {isClearing ? '削除中...' : 'データ削除'}
          </button>
          <button onClick={leaveRoom}>退出</button>
        </div>
      </header>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            flex: '0 0 460px',
            maxWidth: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          <section>
            <h3 style={{ marginBottom: 12 }}>入室中のユーザー</h3>
            {members.length === 0 ? (
              <p style={{ color: '#6b7280' }}>表示できるメンバーがいません。</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {members.map((member) => (
                  <li
                    key={member.id}
                    style={{
                      // border: '1px solid #e5e7eb',
                      // borderRadius: 8,
                      padding: '2px 12px',
                      background: '#fdfdf8',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{member.username}</div>
                    <div>得点: {scores[member.id] ?? 0}</div>
                    {/* 修正前のコード
                    <button onClick={() => updateScore(member.id, +1)}>＋</button>
                    <button onClick={() => updateScore(member.id, -1)}>－</button>
                    */}
                    <button
                      style={{ fontSize: '0.8rem', padding: '2px 6px' }}
                      onClick={() => updateScore(member.id, +1)}
                    >
                      ＋
                    </button>
                    <button
                      style={{ fontSize: '0.8rem', padding: '2px 6px' }}
                      onClick={() => updateScore(member.id, -1)}
                    >
                      －
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 style={{ marginBottom: 12 }}>タイマー</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label>
                <input value={minInput} onChange={(e) => setMinInput(e.target.value)} style={{ width: 60 }} /> 分
              </label>
              <label>
                <input value={secInput} onChange={(e) => setSecInput(e.target.value)} style={{ width: 60 }} /> 秒
              </label>
              <button onClick={startTimer}>スタート</button>
              <button onClick={startThreeMinutes}>3分</button>
              <button onClick={startSevenMinutes}>7分</button>
              {isRunning ? <button onClick={pauseTimer}>一時停止</button> : null}
              {isPaused ? <button onClick={resumeTimer}>再開</button> : null}
            </div>
            <div style={{ fontSize: 46, fontWeight: 'bold', marginTop: 8 }}>{formatTime(remainingMs)}</div>
          </section>

          <section>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              <h3 style={{ margin: 0 }}>お題生成</h3>
              <div style={{ fontSize: 14, color: '#1f2937' }}>役割: {myRoleLabel}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => generateTopic('normal')}>普通</button>
              <button onClick={() => generateTopic('hard')}>辛口</button>
              <button onClick={() => generateTopic('expert')}>激辛</button>
            </div>
            <div style={{ marginTop: 12, fontSize: 14 }}>
              {hasTopic ? (
                canSeeTopic ? (
                  <div>お題: {currentTopic ?? ''}</div>
                ) : (
                  <div style={{ color: '#6b7280' }}>お題はあなたには表示されません</div>
                )
              ) : (
                <div style={{ color: '#6b7280' }}>お題はまだ生成されていません</div>
              )}
            </div>
          </section>
        </div>

        <section style={{ flex: 1, minWidth: 280 }}>
          <h3 style={{ marginBottom: 12 }}>チャット</h3>
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              height: 360,
              overflowY: 'auto',
              padding: 12,
              background: '#f9fafb',
            }}
          >
            {messages.length === 0 ? (
              <p style={{ color: '#6b7280' }}>まだメッセージはありません。</p>
            ) : (
              messages.map((message) => {
                const author = message.user_id ? usernameMap.get(message.user_id) ?? 'anonymous' : 'anonymous';
                return (
                  <div key={message.id} style={{ marginBottom: 6 }}>
                    <span style={{ color: '#6b7280' }}>{author}：</span> {message.body}
                  </div>
                );
              })
            )}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="メッセージを入力..."
              style={{ flex: 1 }}
            />
            <button onClick={sendMessage}>送信</button>
          </div>
        </section>
      </div>

      <div
        style={{
          marginTop: 18,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#ffffff',
          padding: 12,
          maxWidth: 960,
        }}
      >
        <p style={{ margin: '1px 0px', fontSize: '0.8rem', fontWeight: 'bold' }}>インサイダーゲーム用 ルール例</p>
        <p style={{ margin: '1px 0px', fontSize: '0.8rem' }}>　1. マスターはお題を確認し、他のプレイヤーの質問にYes/Noで答えます。</p>
        <p style={{ margin: '1px 0px', fontSize: '0.8rem' }}>　2. 全員でお題を推理します。インサイダーは正体を隠しつつ、正解が出るように誘導します。</p>
        <p style={{ margin: '1px 0px', fontSize: '0.8rem' }}>　3. 庶民は協力してお題を推理し、制限時間内に答えを導きます。</p>
        <p style={{ margin: '1px 0px', fontSize: '0.8rem' }}>　4. 正解が出たら、インサイダーが誰かを話し合って投票します。</p>
        <p style={{ margin: '1px 0px', fontSize: '0.8rem' }}>　（時間の目安 お題当て 5～10分、インサイダーの推理 3分）</p>
        <p style={{ margin: '4px 4px', fontSize: '0.8rem' }}>得点:</p>
{/*        <p style={{ margin: '1px 0px', fontSize: '0.8rem' }}>　お題当てに失敗: 全プレイヤー -1点</p>*/}
        <p style={{ margin: '1px 0px', fontSize: '0.8rem' }}>　インサイダーの推理成功: インサイダーを除く全プレイヤー +1点</p>
        <p style={{ margin: '1px 0px', fontSize: '0.8rem' }}>　インサイダーの推理失敗: インサイダー、インサイダーと間違われた庶民 +1点</p>
      </div>

      <audio ref={gongRef} src="/gong.mp3" preload="auto" />
    </div>
  );
}
