import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { ClaimAttestationService } from '@/server/services/claim-attestation-service';

const attestationService = new ClaimAttestationService();

/**
 * GET /api/attestations?messageId=xxx
 * Returns claim attestations for a message.
 */
// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export const GET = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ request }) => {
    const { searchParams } = request.nextUrl;
    const messageId = searchParams.get('messageId');

    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const attestations = await attestationService.getByMessageId(messageId);
      return new Response(JSON.stringify({ attestations }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to fetch attestations' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
