import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api-utils';
import { ClaimAttestationService } from '@/server/services/claim-attestation-service';

const attestationService = new ClaimAttestationService();

/**
 * GET /api/attestations?messageId=xxx
 * Returns claim attestations for a message.
 */
// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const messageId = searchParams.get('messageId');

  if (!messageId) {
    return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
  }

  try {
    const attestations = await attestationService.getByMessageId(messageId);
    return NextResponse.json({ attestations });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch attestations' },
      { status: 500 }
    );
  }
}
