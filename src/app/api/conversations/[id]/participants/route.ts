import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandler } from '@/lib/api-utils';

// GET /api/conversations/[id]/participants - Get conversation participants
export const GET = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: conversationId } = await params;
  const client = getSupabaseClient();

  const { data: conversation, error } = await client
    .from('conversations')
    .select('id, participant_ids, is_collaborative')
    .eq('id', conversationId)
    .maybeSingle();

  if (error || !conversation) {
    return apiError('对话不存在', { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND' });
  }

  const participantIds: string[] = (conversation as { participant_ids: string[] | null }).participant_ids || [];

  let participants: Array<{ id: string; name: string; role: string }> = [];
  if (participantIds.length > 0) {
    const { data: users } = await client
      .from('users')
      .select('id, name, role')
      .in('id', participantIds);

    participants = (users || []) as Array<{ id: string; name: string; role: string }>;
  }

  return apiSuccess({
    participants,
    is_collaborative: (conversation as { is_collaborative: boolean }).is_collaborative,
  });
});

// POST /api/conversations/[id]/participants - Add participant
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: conversationId } = await params;
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;
  const { user_id } = (body ?? {}) as { user_id?: string };

  if (!user_id) {
    return apiError('用户ID不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const client = getSupabaseClient();

  const { data: conversation, error: convError } = await client
    .from('conversations')
    .select('id, participant_ids')
    .eq('id', conversationId)
    .maybeSingle();

  if (convError || !conversation) {
    return apiError('对话不存在', { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND' });
  }

  const existingParticipants: string[] = (conversation as { participant_ids: string[] | null }).participant_ids || [];
  if (existingParticipants.includes(user_id)) {
    return apiError('该用户已是参与者', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const updatedParticipants = [...existingParticipants, user_id];
  await client
    .from('conversations')
    .update({
      participant_ids: updatedParticipants,
      is_collaborative: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return apiSuccess({ success: true, participant_ids: updatedParticipants });
});

// DELETE /api/conversations/[id]/participants - Remove participant
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: conversationId } = await params;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');

  if (!userId) {
    return apiError('用户ID不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const client = getSupabaseClient();

  const { data: conversation, error: convError } = await client
    .from('conversations')
    .select('id, participant_ids')
    .eq('id', conversationId)
    .maybeSingle();

  if (convError || !conversation) {
    return apiError('对话不存在', { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND' });
  }

  const existingParticipants: string[] = (conversation as { participant_ids: string[] | null }).participant_ids || [];
  const updatedParticipants = existingParticipants.filter((id: string) => id !== userId);

  await client
    .from('conversations')
    .update({
      participant_ids: updatedParticipants,
      is_collaborative: updatedParticipants.length > 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return apiSuccess({ success: true, participant_ids: updatedParticipants });
});
