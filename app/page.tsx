'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabaseClient';

type Room = { id: string; name: string; created_at: string | null }; 

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('(anonymous)');
  const [roomName, setRoomName] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        location.href = '/login';
        return;
      }
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;
      if (!newSession) {
        location.href = '/login';
        return;
      }
      setSession(newSession);
      setLoading(false);
    });

    return () => {
      active = false;
      listener?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('Failed to load profile', error.message);
        setUsername('(anonymous)');
        return;
      }

      const name = data?.username?.trim() || '(anonymous)';
      setUsername(name);
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const loadRooms = async () => {
      const { data, error } = await supabase
        .from('rooms')
        .select('id, name, created_at')
        .order('created_at', { ascending: false });

      if (cancelled) return;

      if (error) {
        console.error('Failed to load rooms', error.message);
        setRooms([]);
        return;
      }

      setRooms(data ?? []);
    };

    void loadRooms();

    const channel = supabase
      .channel(`public:rooms:${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
        void loadRooms();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [session]);

  const createRoom = async () => {
    if (!session) return;
    const trimmed = roomName.trim();
    if (!trimmed) return;

    const userId = session.user.id;

    const { data: inserted, error: roomError } = await supabase
      .from('rooms')
      .insert({ name: trimmed, owner: userId })
      .select()
      .single();

    if (roomError || !inserted) {
      alert(`rooms insert failed: ${roomError?.message ?? 'unknown error'}`);
      return;
    }

    setRoomName('');
    router.push(`/rooms/${inserted.id}`);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const formattedRooms = useMemo(
    () =>
      rooms
        .slice()
        .sort((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bTime - aTime;
        }),
    [rooms]
  );

  if (loading) {
    return <p style={{ padding: '40px 0', textAlign: 'center' }}>Loading...</p>;
  }

  return (
    <div style={{ maxWidth: 720, margin: '20px auto', padding: '0 16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <Image src="/top.png" alt="Top" width={320} height={80} style={{ height: 'auto' }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 600 }}>ユーザー名: {username}</div>
          <button onClick={logout} style={{ marginTop: 8 }}>ログアウト</button>
        </div>
      </div>

      <section style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 12 }}>部屋を作成</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            placeholder="Room name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button onClick={createRoom}>作成</button>
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 12 }}>公開されているルーム</h2>
        {formattedRooms.length === 0 ? (
          <p style={{ color: '#6b7280' }}>現在表示できるルームはありません。</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {formattedRooms.map((room) => (
              <li
                key={room.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  padding: '12px 16px',
                  background: '#fff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{room.name}</div>
                  {room.created_at ? (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {new Date(room.created_at).toLocaleString()}
                    </div>
                  ) : null}
                </div>
                <button onClick={() => router.push(`/rooms/${room.id}`)}>入室</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
