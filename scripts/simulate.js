import { setTimeout as sleep } from 'node:timers/promises';
import { fetch } from 'undici';

const apiUrl = process.env.API_URL || 'http://localhost:3000/webhooks/ifood';
const secret = process.env.WEBHOOK_SECRET || 'supersecret';

const baseOrder = {
  orderId: `POC-${Date.now()}`,
  items: [
    { name: 'Burger', quantity: 1 },
    { name: 'Fries', quantity: 2 }
  ]
};

const statuses = ['ACCEPTED', 'IN_PRODUCTION', 'READY'];

for (const status of statuses) {
  const payload = { ...baseOrder, status };
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ifood-signature': secret
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  console.log(status, res.status, text);
  await sleep(500);
}
