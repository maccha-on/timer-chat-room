// app/api/generate-topic/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

type Body = { roomId: string; requesterId: string };
type RoomMemberRow = { user_id: string };
type RoundRow = { id: number };

const fallbackTopics = ['りんご', 'コーヒー', '自転車', '本', '時計', '橋', '山', '海', '椅子', '電話'];

const supaAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { roomId, requesterId } = (await req.json()) as Body;

    if (!roomId || !requesterId) {
      return NextResponse.json({ error: 'roomId/requesterId required' }, { status: 400 });
    }

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
    const prompt =
      '日本語で、大人ならほとんどの人が知っている一般名詞を1語だけ出してください。' +
      '固有名詞や専門用語は避け、出力は単語のみ（記号・説明なし）。';

    const completion = await openai.chat.completions
      .create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful topic generator.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 10,
      })
      .catch((err: unknown) => {
        const message =
          typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'OpenAI API request failed';
        throw new Error(message);
      });

    const topic = completion.choices[0]?.message?.content?.trim()?.replace(/[^\p{L}\p{N}\u3000\u3040-\u30FF\u4E00-\u9FFF]/gu, '') ?? '';
    if (!topic) {
      throw new Error('OpenAIから有効なお題を取得できませんでした。');
    }

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
