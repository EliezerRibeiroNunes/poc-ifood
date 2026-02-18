import { query } from '../db.js';

export function mapStatus(providerStatus) {
  const status = String(providerStatus || '').toUpperCase();
  if (status === 'ACCEPTED') return 'ACCEPTED';
  if (status === 'IN_PRODUCTION') return 'IN_PRODUCTION';
  if (status === 'READY') return 'READY';
  return null;
}

export async function getQueue() {
  const { rows } = await query(
    `SELECT id, provider_order_id, status_internal, created_at, updated_at
     FROM orders
     WHERE status_internal IN ('ACCEPTED', 'IN_PRODUCTION')
     ORDER BY created_at ASC`
  );
  return rows;
}

export async function broadcastQueue(io) {
  const queue = await getQueue();
  io.emit('kitchen.queue', queue);
  return queue;
}
