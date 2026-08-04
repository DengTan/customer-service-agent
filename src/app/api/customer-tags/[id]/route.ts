import { GET as defineGet } from '@/lib/api/with-api';
import { CustomerTagService } from '@/server/services/customer-tag-service';

const customerTagService = new CustomerTagService();

export const GET = defineGet(
  { auth: 'required', perm: { resource: 'customers', action: 'read' } },
  async ({ params }) => {
    const { id } = (await params) as { id: string };
    const tag = await customerTagService.getTagById(id);
    if (!tag) {
      return Response.json({ error: '标签不存在' }, { status: 404 });
    }
    return Response.json({ tag });
  },
);
