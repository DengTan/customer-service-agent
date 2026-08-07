import { apiSuccess, apiError } from '@/lib/api-utils';
import { GET, PUT, DELETE } from '@/lib/api/with-api';
import { KnowledgeCategoryService } from '@/server/services/knowledge-category-service';
import { ServiceError } from '@/server/services/service-error';

const categoryService = new KnowledgeCategoryService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'read' },
  },
  async (req) => {
    const { id } = req.params;
    try {
      const category = await categoryService.get(id);
      return apiSuccess(category);
    } catch (error) {
      if (error instanceof ServiceError) {
        return apiError(error.userMessage, { status: error.status, code: error.code });
      }
      throw error;
    }
  }
);

export { GETHandler as GET };

export const PUTHandler = PUT(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'write' },
  },
  async (req) => {
    const { id } = req.params;
    try {
      const body = await req.request.json();
      const category = await categoryService.update(id, body);
      return apiSuccess(category);
    } catch (error) {
      if (error instanceof ServiceError) {
        return apiError(error.userMessage, { status: error.status, code: error.code });
      }
      throw error;
    }
  }
);

export { PUTHandler as PUT };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'delete' },
  },
  async (req) => {
    const { id } = req.params;
    try {
      const result = await categoryService.delete(id);
      return apiSuccess(result);
    } catch (error) {
      if (error instanceof ServiceError) {
        return apiError(error.userMessage, { status: error.status, code: error.code });
      }
      throw error;
    }
  }
);

export { DELETEHandler as DELETE };
