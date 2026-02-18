import 'dotenv/config';
import Fastify from 'fastify';
import fastifySocketIO from 'fastify-socket.io';
import ordersRoutes from './routes/orders.js';
import webhooksRoutes from './routes/webhooks.js';
import { broadcastQueue } from './services/queue.js';

const fastify = Fastify({ logger: true });

await fastify.register(fastifySocketIO, {
  cors: {
    origin: '*'
  }
});

fastify.register(ordersRoutes);
fastify.register(webhooksRoutes);

fastify.io.on('connection', async (socket) => {
  await broadcastQueue(fastify.io);
});

const port = Number(process.env.PORT || 3000);
fastify.listen({ port, host: '0.0.0.0' });
