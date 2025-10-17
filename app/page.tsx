'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabaseClient';

type Room = { id: string; name: string; created_at?: string };

export default function Home() {
  const [sessionReady, setSessionReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        location.href = '/login';
        return;
      }
      setSession(data.session);
      setSessionReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) {
        location.href = '/login';
        return;
      }
      setSession(newSession);
      setSessionReady(true);
    });

    return () => {
      active = false;
      subscription?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    supabase
      .from('profiles')
      .select('username')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setUsername(data?.username ?? '(anonymous)');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const fetchRooms = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        location.href = '/login';
        return;
      }

      const response = await fetch('/api/rooms', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (cancelled) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        console.error('Failed to load rooms', body.message ?? response.statusText);
        setRooms([]);
        return;
      }

      const body = (await response.json()) as { rooms?: Room[] };
      setRooms(body.rooms ?? []);
    };

    void fetchRooms();

    const channel = supabase
      .channel('rooms:all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
        void fetchRooms();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [session]);

  const createRoom = async () => {
    if (!name.trim()) return;
    const { data: u, error: uerr } = await supabase.auth.getUser();
    if (uerr || !u.user) return alert(uerr?.message ?? 'Not signed in');
    const owner = u.user.id;

    const { data: room, error: rerr } = await supabase
      .from('rooms')
      .insert({ name, owner })
      .select()
      .single();
    if (rerr || !room) return alert(`rooms insert failed: ${rerr?.message}`);

    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', owner)
      .single();
    const profileUsernameRaw = (profile?.username ?? (username || '')).trim();
    const profileUsername = profileUsernameRaw || '(anonymous)';

    const { error: merr } = await supabase
      .from('room_members')
      .insert({ room_id: (room as Room).id, user_id: owner, username: profileUsername });
    if (merr) return alert(`room_members insert failed: ${merr.message}`);

    location.href = `/rooms/${(room as Room).id}`;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    location.href = '/login';
  };

  if (!sessionReady) return <p>Loading...</p>;

  return (
    <div style={{ maxWidth: 720, margin: '20px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
        <Image src="/top.png" alt="Top" width={320} height={80} style={{ height: 'auto' }} />
        <div style={{ fontWeight: 600 }}>ユーザー名: {username}</div>
      </div>

      <h1>Rooms</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1, border: '1px solid #9ca3af', padding: '6px 8px', borderRadius: 6 }}
        />
        <button
          onClick={createRoom}
          style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8 }}
        >
          Create
        </button>
        <button
          onClick={logout}
          style={{ background: '#6b7280', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8 }}
        >
          Logout
        </button>
      </div>

      <ul style={{ paddingLeft: 18 }}>
        {rooms.map((r) => (
          <li key={r.id} style={{ marginBottom: 6 }}>
            <a href={`/rooms/${r.id}`}>{r.name}</a>
          </li>
        ))}
        {rooms.length === 0 && <li style={{ opacity: 0.7 }}>（利用可能なルームはまだありません）</li>}
      </ul>
    </div>
  );
}
