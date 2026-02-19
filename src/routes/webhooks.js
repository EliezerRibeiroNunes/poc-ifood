import { withClient } from '../db.js';
import { broadcastQueue, mapStatus } from '../services/queue.js';

export default async function webhooksRoutes(fastify, opts) {
  fastify.post('/webhooks/ifood', async (request, reply) => {
    fastify.log.info(
      {
        headers: request.headers,
        body: request.body
      },
      'Webhook received'
    );
    
    const clientId = request.headers['x-ifood-client-id'];
    const allowedClientId = process.env.IFOOD_CLIENT_ID;

    if (!allowedClientId || clientId !== allowedClientId) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const payload = request.body || {};
    const providerOrderId = payload.orderId || payload.provider_order_id;
    const providerStatus = payload.status;
    if (!providerOrderId || !providerStatus) {
      return reply.code(400).send({ error: 'missing orderId or status' });
    }

    const internalStatus = mapStatus(providerStatus);

    const result = await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const orderRes = await client.query(
          `INSERT INTO orders (provider_order_id, status_provider, status_internal)
           VALUES ($1, $2, $3)
           ON CONFLICT (provider_order_id)
           DO UPDATE SET status_provider = EXCLUDED.status_provider,
                         status_internal = EXCLUDED.status_internal,
                         updated_at = NOW()
           RETURNING id`,
          [providerOrderId, providerStatus, internalStatus]
        );

        const orderId = orderRes.rows[0].id;

        if (Array.isArray(payload.items)) {
          await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
          for (const item of payload.items) {
            await client.query(
              `INSERT INTO order_items (order_id, name, quantity)
               VALUES ($1, $2, $3)`,
              [orderId, item.name || 'Item', item.quantity || 1]
            );
          }
        }

        await client.query(
          `INSERT INTO order_status_events (order_id, provider_status, internal_status, payload)
           VALUES ($1, $2, $3, $4)`,
          [orderId, providerStatus, internalStatus, payload]
        );

        await client.query('COMMIT');
        return { orderId, internalStatus };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if (result.internalStatus === 'ACCEPTED' || result.internalStatus === 'IN_PRODUCTION' || result.internalStatus === 'READY') {
      await broadcastQueue(fastify.io);
    }

    return reply.send({ ok: true });
  });
}
