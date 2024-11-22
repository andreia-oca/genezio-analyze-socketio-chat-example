import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { createAdapter } from '@socket.io/redis-adapter';
import { Cluster } from 'ioredis';

const functionInstanceId = Math.floor(Math.random() * 10000);
console.log('Started with instance id ' + functionInstanceId);

mongoose.connect(process.env['MY_MONGODB_DATABASE_URL']);

const messageSchema = new mongoose.Schema(
  {
    id: {
      type: Number,
      unique: true,
      required: true,
    },
    content: String,
    clientOffset: {
      type: String,
      unique: true,
    },
  },
  {
    timestamps: true,
  }
);

const Message = mongoose.model('Message', messageSchema);

const app = express();
const server = createServer(app);

// Redis Cluster Setup with Upstash Redis URL
const pubCluster = new Cluster([{
  url: process.env.UPSTASH_REDIS_URL
}]);
const subCluster = pubCluster.duplicate();

// Add error handlers
pubCluster.on('error', (err) => console.error('Redis Pub Client Error:', err));
subCluster.on('error', (err) => console.error('Redis Sub Client Error:', err));

// Create Socket.IO server and add Redis adapter
const io = new Server(server, {
  connectionStateRecovery: {},
  adapter: createAdapter(pubCluster, subCluster)
});

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
  console.log("Getting / from instance id " + functionInstanceId);
  res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', async (socket) => {
  console.log("Socket connected on instance id " + functionInstanceId);
  socket.on('chat message', async (msg, clientOffset, callback) => {
    console.log("Got chat message on instance id " + functionInstanceId);
    let result;
    try {
      const message = new Message({
        id: await Message.findOne()
          .sort('-id')
          .then((lastMsg) => (lastMsg?.id || 0) + 1),
        content: msg,
        clientOffset,
      });
      result = await message.save();
    } catch (e) {
      console.error(e);
      callback();
      return;
    }
    io.emit('chat message', msg, result.id);
    callback();
  });

  if (!socket.recovered) {
    try {
      const messages = await Message.find({
        id: { $gt: socket.handshake.auth.serverOffset || 0 },
      });
      messages.forEach((message) => {
        socket.emit('chat message', message.content, message.id);
      });
    } catch (e) {
      console.error(e);
    }
  }
});

const port = process.env.PORT || 8080;

server.listen(port, () => {
  console.log(`Server running`);
});
