// whats-server.js
require("dotenv").config();

const express = require("express");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const PORT = process.env.WHATS_SERVER_PORT || 3000;

const app = express();
app.use(express.json());

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("QR do WhatsApp gerado! Escaneia com o número que vai disparar 👇");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ WhatsApp Web conectado e pronto para enviar mensagens.");
});

client.on("auth_failure", (msg) => {
  console.error("Falha de autenticação no WhatsApp:", msg);
});

client.on("disconnected", (reason) => {
  console.log("WhatsApp desconectado:", reason);
});

client.initialize();

// === Função para enviar mensagem para grupo pelo NOME ===
async function sendToGroup({ groupTitle, message, imageUrl }) {
  const chats = await client.getChats();

  const group = chats.find(
    (c) =>
      c.isGroup &&
      c.name &&
      c.name.trim().toLowerCase() === groupTitle.trim().toLowerCase()
  );

  if (!group) {
    throw new Error(`Grupo não encontrado no WhatsApp: ${groupTitle}`);
  }

  if (imageUrl) {
    const media = await MessageMedia.fromUrl(imageUrl);
    await client.sendMessage(group.id._serialized, media, {
      caption: message,
    });
  } else {
    await client.sendMessage(group.id._serialized, message);
  }
}

// === Rota HTTP que o bot do Telegram vai chamar ===
app.post("/whats/send", async (req, res) => {
  const { groupTitle, message, imageUrl } = req.body;

  if (!groupTitle || !message) {
    return res.status(400).json({
      ok: false,
      error: "Parâmetros obrigatórios: groupTitle, message",
    });
  }

  try {
    await sendToGroup({ groupTitle, message, imageUrl });
    return res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao enviar mensagem para grupo:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Whats ouvindo em http://localhost:${PORT}`);
});
