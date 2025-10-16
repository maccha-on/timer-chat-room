'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { supabase } from './lib/supabaseClient';

type Room = { id: string; name: string };
type RoomMember = { room_id: string };

export default function Home() {
  const [sessionReady, setSessionReady] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) location.href = '/login';
      else {
        setSessionReady(true);
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', data.session.user.id)
          .single();
        setUsername(profile?.username ?? '(anonymous)');
      }
    });
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    (async () => {
      const { data: mem } = await supabase.from('room_members').select('room_id');
      const ids = (mem as RoomMember[] | null)?.map((m) => m.room_id) ?? [];
      if (ids.length === 0) return setRooms([]);
      const { data: rms } = await supabase.from('rooms').select('id,name').in('id', ids);
      setRooms((rms as Room[] | null) ?? []);
    })();
  }, [sessionReady]);

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

    const { error: merr } = await supabase
      .from('room_members')
      .insert({ room_id: (room as Room).id, user_id: owner });
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
        {rooms.length === 0 && <li style={{ opacity: 0.7 }}>（参加中のルームはまだありません）</li>}
      </ul>
    </div>
  );
}
