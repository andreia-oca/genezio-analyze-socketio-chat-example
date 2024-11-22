import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import mongoose from 'mongoose'

mongoose.connect(process.env["CHATROOM_DATABASE_URL"]);

const messageSchema = new mongoose.Schema({
  id: {
    type: Number,
    unique: true,
    required: true
  },
  content: String,
  clientOffset: {
    type: String,
    unique: true
  }
}, {
  timestamps: true
});

const Message = mongoose.model('Message', messageSchema);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
  // adapter: createAdapter()
});

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', async (socket) => {
  socket.on('chat message', async (msg, clientOffset, callback) => {
    let result;
    try {
      const message = new Message({
        id: await Message.findOne().sort('-id').then(lastMsg => (lastMsg?.id || 0) + 1),
        content: msg,
        clientOffset
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
        id: { $gt: socket.handshake.auth.serverOffset || 0 }
      });
      messages.forEach(message => {
        socket.emit('chat message', message.content, message.id);
      });
    } catch (e) {
      console.error(e);
    }
  }
});

const port = process.env.PORT || 8080;

server.listen(port, () => {
  console.log(`server running at http://localhost:${port}`);
});
