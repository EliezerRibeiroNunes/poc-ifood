import { query } from '../db.js';
import { broadcastQueue, getQueue } from '../services/queue.js';

export default async function ordersRoutes(fastify, opts) {
  fastify.get('/orders/queue', async (request, reply) => {
    const queue = await getQueue();
    return reply.send(queue);
  });

  fastify.patch('/orders/:id/ready', async (request, reply) => {
    const orderId = request.params.id;
    const { rowCount } = await query(
      `UPDATE orders
       SET status_internal = 'READY', status_provider = 'READY', updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    if (rowCount === 0) {
      return reply.code(404).send({ error: 'order not found' });
    }

    await query(
      `INSERT INTO order_status_events (order_id, provider_status, internal_status, payload)
       VALUES ($1, $2, $3, $4)`,
      [orderId, 'READY', 'READY', { source: 'manual' }]
    );

    const queue = await broadcastQueue(fastify.io);
    return reply.send({ ok: true, queue });
  });
}
