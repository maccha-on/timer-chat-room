// app/api/generate-topic/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type Body = { roomId: string; requesterId: string; difficulty?: Difficulty };
type RoomMemberRow = { user_id: string };
type RoundRow = { id: number };

type Difficulty = 'normal' | 'hard' | 'expert';

const topicFileMap: Record<Difficulty, string> = {
  normal: 'normal.json',
  hard: 'hard.json',
  expert: 'expert.json',
};

const supaAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
);

export async function POST(req: NextRequest) {
  try {
    const { roomId, requesterId, difficulty: requestedDifficulty } = (await req.json()) as Body;

    if (!roomId || !requesterId) {
      return NextResponse.json({ error: 'roomId/requesterId required' }, { status: 400 });
    }

    const difficulty: Difficulty = (requestedDifficulty && requestedDifficulty in topicFileMap
      ? requestedDifficulty
      : 'normal') as Difficulty;

    // 1) ルームメンバー取得
    const { data: members, error: memErr } = await supaAdmin
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId);

    if (memErr) throw memErr;

    const ids = (members as RoomMemberRow[] | null)?.map((m) => m.user_id) ?? [];
    if (ids.length < 2) {
      return NextResponse.json({ error: 'メンバーが2人以上必要です' }, { status: 400 });
    }

    if (!ids.includes(requesterId)) {
      return NextResponse.json({ error: 'ルームに参加していません' }, { status: 403 });
    }

    // 2) お題生成
    const topicFile = topicFileMap[difficulty];
    const filePath = path.join(process.cwd(), 'public', topicFile);
    const raw = await readFile(filePath, 'utf-8').catch(() => null);

    if (!raw) {
      throw new Error('お題リストの読み込みに失敗しました。');
    }

    const topics = JSON.parse(raw) as unknown;
    const topicList = Array.isArray(topics) ? topics.filter((item): item is string => typeof item === 'string') : [];

    if (topicList.length === 0) {
      throw new Error('お題リストが空です。');
    }

    const topic = topicList[Math.floor(Math.random() * topicList.length)];

    // 3) 役割抽選
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    const presenter = shuffled[0];
    const insider = shuffled[1] ?? shuffled[0];

    // 4) rounds 作成
    const { data: round, error: rErr } = await supaAdmin
      .from('rounds')
      .insert({ room_id: roomId, topic, created_by: requesterId })
      .select()
      .single();

    if (rErr || !round) throw rErr;
    const roundId = (round as RoundRow).id;

    // 5) round_roles 追加
    const rows = ids.map((uid) => ({
      round_id: roundId,
      user_id: uid,
      role: uid === presenter ? 'presenter' : uid === insider ? 'insider' : 'common',
    }));
    const { error: rrErr } = await supaAdmin.from('round_roles').insert(rows);
    if (rrErr) throw rrErr;

    const myRole = rows.find((r) => r.user_id === requesterId)?.role ?? 'common';
    const canSee = myRole === 'presenter' || myRole === 'insider';

    return NextResponse.json({ roundId, myRole, topic: canSee ? topic : null });
  } catch (e: unknown) {
    const message =
      typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : 'server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
