import type { FastifyInstance } from 'fastify';
import type { ApiResponse } from '@huddle/shared';

export async function configRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => {
    const response: ApiResponse<{ livekitUrl: string }> = {
      data: {
        livekitUrl: process.env['LIVEKIT_PUBLIC_URL'] || '',
      },
    };
    return response;
  });
}
