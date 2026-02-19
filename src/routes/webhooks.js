import { withClient } from '../db.js';
import { broadcastQueue, mapStatus } from '../services/queue.js';
import crypto from 'node:crypto';

export default async function webhooksRoutes(fastify, opts) {
  fastify.post('/webhooks/ifood', async (request, reply) => {
    fastify.log.info(
      {
        headers: request.headers,
        body: request.body
      },
      'Webhook received'
    );
    const signature = request.headers['x-ifood-signature'];
    const secret = process.env.WEBHOOK_SECRET;
    const rawBody = request.rawBody;

    if (!secret || !signature || !rawBody) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const payload = request.body || {};
    const providerOrderId = payload.orderId || payload.provider_order_id;
    const providerStatus = payload.status || payload.fullCode || payload.code;
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
