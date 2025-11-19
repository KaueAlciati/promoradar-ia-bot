require("dotenv").config();
const fs = require("fs");
const { Telegraf, Markup } = require("telegraf");
const puppeteer = require("puppeteer");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const WHATS_SERVER_URL =
  process.env.WHATS_SERVER_URL ||
  `http://localhost:${process.env.WHATS_SERVER_PORT || 3000}`;

if (!BOT_TOKEN) {
  console.error("Erro: BOT_TOKEN não definido no .env");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ===============================
// ARMAZENAMENTO DE GRUPOS (Telegram)
// ===============================
const GROUPS_FILE = "groups.json";

function loadGroups() {
  try {
    const raw = fs.readFileSync(GROUPS_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
  } catch (e) {
    // arquivo ainda não existe ou está vazio
  }
  return [];
}

function saveGroups(groups) {
  try {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2), "utf8");
  } catch (e) {
    console.error("Erro ao salvar groups.json:", e.message || e);
  }
}

// lista de grupos registrados: [{ id, title }]
let telegramGroups = loadGroups();

// garante que um grupo esteja no array
function ensureGroupRegistered(chat) {
  if (!chat) return;
  if (chat.type !== "group" && chat.type !== "supergroup") return;

  const exists = telegramGroups.find((g) => g.id === chat.id);
  if (exists) return;

  const title =
    chat.title || chat.username || `Grupo ${chat.id.toString().slice(-6)}`;

  telegramGroups.push({ id: chat.id, title });
  saveGroups(telegramGroups);
}

// ===============================
// ARMAZENAMENTO DE GRUPOS (WhatsApp)
// ===============================
const WHATS_GROUPS_FILE = "whatsapp_groups.json";

function loadWhatsGroups() {
  try {
    const raw = fs.readFileSync(WHATS_GROUPS_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
  } catch (e) {
    // arquivo ainda não existe ou está vazio
  }
  return [];
}

function saveWhatsGroups(groups) {
  try {
    fs.writeFileSync(
      WHATS_GROUPS_FILE,
      JSON.stringify(groups, null, 2),
      "utf8"
    );
  } catch (e) {
    console.error("Erro ao salvar whatsapp_groups.json:", e.message || e);
  }
}

// lista de "grupos" de WhatsApp registrados: [{ id, title }]
let whatsappGroups = loadWhatsGroups();

// ===============================
// SESSÕES POR CHAT
// ===============================
const sessions = new Map();

// ===============================
// UTILS
// ===============================
function formatBRL(value) {
  if (typeof value !== "number" || isNaN(value)) return value;
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// teclado principal (opções da promoção)
function getOptionsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📝 Nome", "opt_nome")],

    [
      Markup.button.callback("💰 Preço", "opt_preco"),
      Markup.button.callback("💰 A partir de", "opt_apartir"),
    ],

    [
      Markup.button.callback("🧾 Parcelas", "opt_parcelas"),
      Markup.button.callback("💲 Detalhes do preço", "opt_detalhes_preco"),
    ],

    [Markup.button.callback("⚖️ Preço por unidade", "opt_preco_unidade")],

    [Markup.button.callback("📊 Preço Comparação", "opt_preco_comparacao")],

    [Markup.button.callback("📢 Mensagem do topo", "opt_msg_topo")],

    [Markup.button.callback("✏️ Mensagem do final", "opt_msg_final")],

    [
      Markup.button.callback("🏬 Loja", "opt_loja"),
      Markup.button.callback("🎟 Cupom", "opt_cupom"),
    ],

    [Markup.button.callback("✨ Observações com IA", "opt_obs_ia")],

    [Markup.button.callback("🗒 Observações", "opt_obs")],

    [Markup.button.callback("🖼 Alterar imagem", "opt_img")],

    [
      Markup.button.callback(
        "🌐 Ativar Promoção / Postar no site",
        "opt_ativar"
      ),
    ],

    [Markup.button.callback("📱 Disparar no WhatsApp", "opt_whats")],

    [Markup.button.callback("🤖 Disparar no Telegram", "opt_telegram")],

    [
      Markup.button.callback(
        "📸 Gerar Story p/ Instagram",
        "opt_story_instagram"
      ),
    ],
  ]);
}

// teclado com grupos do Telegram
function getTelegramGroupsKeyboard() {
  const rows = [];

  if (telegramGroups.length === 0) {
    rows.push([
      Markup.button.callback("Nenhum grupo registrado", "tg_no_groups"),
    ]);
  } else {
    rows.push([
      Markup.button.callback("📱 Todos os Grupos", "tg_all_groups"),
    ]);

    for (let i = 0; i < telegramGroups.length; i += 2) {
      const row = [];
      row.push(
        Markup.button.callback(
          telegramGroups[i].title,
          `tg_group_${telegramGroups[i].id}`
        )
      );
      if (telegramGroups[i + 1]) {
        row.push(
          Markup.button.callback(
            telegramGroups[i + 1].title,
            `tg_group_${telegramGroups[i + 1].id}`
          )
        );
      }
      rows.push(row);
    }
  }

  rows.push([Markup.button.callback("⬅️ Voltar", "back_main_menu")]);

  return Markup.inlineKeyboard(rows);
}

// teclado com "grupos" de WhatsApp
function getWhatsGroupsKeyboard() {
  const rows = [];

  if (whatsappGroups.length === 0) {
    rows.push([
      Markup.button.callback("Nenhum grupo Whats cadastrado", "wa_no_groups"),
    ]);
  } else {
    rows.push([
      Markup.button.callback("📱 Todos os Grupos Whats", "wa_all_groups"),
    ]);

    for (let i = 0; i < whatsappGroups.length; i += 2) {
      const row = [];
      row.push(
        Markup.button.callback(
          whatsappGroups[i].title,
          `wa_group_${whatsappGroups[i].id}`
        )
      );
      if (whatsappGroups[i + 1]) {
        row.push(
          Markup.button.callback(
            whatsappGroups[i + 1].title,
            `wa_group_${whatsappGroups[i + 1].id}`
          )
        );
      }
      rows.push(row);
    }
  }

  rows.push([Markup.button.callback("⬅️ Voltar", "back_main_menu")]);

  return Markup.inlineKeyboard(rows);
}

// ===============================
// SCRAPING DO MERCADO LIVRE
// ===============================
async function scrapeProduct(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  const data = await page.evaluate(() => {
    const getText = (sel) =>
      document.querySelector(sel)?.innerText?.trim() || null;

    // título
    let title =
      getText("h1.ui-pdp-title") ||
      getText("h1") ||
      document.title ||
      "Produto sem título";

    // preço atual
    let price = null;
    const priceMeta = document.querySelector('meta[itemprop="price"]');
    if (priceMeta) {
      const raw = priceMeta.getAttribute("content");
      if (raw) price = parseFloat(raw.replace(",", "."));
    }

    // preço anterior
    let originalPrice = null;
    const prevFraction = document.querySelector(
      ".andes-money-amount--previous .andes-money-amount__fraction"
    );
    if (prevFraction && prevFraction.innerText) {
      const raw = prevFraction.innerText
        .replace(/\./g, "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");
      originalPrice = parseFloat(raw);
    }

    // parcelamento
    let installmentsQty = null;
    let installmentsAmount = null;
    const instEl =
      document.querySelector(".ui-pdp-price__subtitles") ||
      document.querySelector('[data-testid="installments"]');
    if (instEl && instEl.innerText) {
      const txt = instEl.innerText.replace(/\s+/g, " ");
      const m = txt.match(/(\d+)\s*x\s*de\s*R?\$?\s*([\d.,]+)/i);
      if (m) {
        installmentsQty = parseInt(m[1]);
        const raw = m[2].replace(/\./g, "").replace(",", ".");
        installmentsAmount = parseFloat(raw);
      }
    }

    // imagem
    let imageUrl =
      document.querySelector(".ui-pdp-gallery__figure img")?.src ||
      document.querySelector("img.ui-pdp-image")?.src ||
      document.querySelector('img[fetchpriority="high"]')?.src ||
      document.querySelector("img")?.src ||
      null;

    // ======== vendedor / loja =========
    const limparTexto = (text) => {
      if (!text) return null;
      return text
        .replace(/Acesse a Loja Oficial de/gi, "")
        .replace(/Loja Oficial de/gi, "")
        .replace(/Loja oficial de/gi, "")
        .replace(/Loja oficial/gi, "")
        .replace(/Visite a página e encontre todos os produtos de/gi, "")
        .replace(/Ver mais anúncios/gi, "")
        .trim();
    };

    const lixoPalavras = [
      "receba grátis",
      "frete grátis",
      "frete",
      "entrega",
      "hoje",
      "amanhã",
      "novo |",
      "novos |",
      "vendidos",
      "vendas",
      "cupons",
      "cupom",
      "compartilhar",
    ];

    const isTextoRuim = (txt) => {
      if (!txt) return true;
      const lower = txt.toLowerCase();
      return lixoPalavras.some((w) => lower.includes(w));
    };

    const acharLojaOficial = () => {
      const badge = Array.from(
        document.querySelectorAll("span, div, p, strong")
      ).find((el) => {
        const t = el.innerText && el.innerText.trim().toLowerCase();
        return t === "loja oficial";
      });

      if (!badge) return null;

      let container =
        badge.closest("section, header, div, article") || badge.parentElement;
      if (!container) return null;

      const nodes = Array.from(
        container.querySelectorAll("a, span, div, strong")
      );

      const textos = nodes
        .map((el) => ({
          tag: el.tagName,
          text: el.innerText ? el.innerText.trim().replace(/\s+/g, " ") : "",
        }))
        .filter((x) => x.text && x.text.length > 1);

      const candidatosLink = textos.filter(
        (x) =>
          x.tag === "A" &&
          !/loja oficial/i.test(x.text) &&
          !isTextoRuim(x.text)
      );
      if (candidatosLink.length > 0) {
        const melhor = limparTexto(candidatosLink[0].text);
        if (melhor && !isTextoRuim(melhor)) return melhor;
      }

      for (const x of textos) {
        if (/loja oficial/i.test(x.text)) continue;
        if (isTextoRuim(x.text)) continue;
        const limpo = limparTexto(x.text);
        if (!limpo || isTextoRuim(limpo)) continue;

        const partes = limpo.split(" ");
        if (partes.length > 5) continue;

        return limpo;
      }

      return null;
    };

    let sellerName = acharLojaOficial();

    const sellerSelectors = [
      '[data-testid="store-see-all-products"]',
      "a[href*='stores']",
      "a[href*='perfil']",
      "a.ui-pdp-media__title",
      '[data-testid="seller-name"]',
      ".ui-pdp-seller__link-trigger",
      ".ui-pdp-seller__link",
      ".store-info__name",
      ".andes-card__header-link",
      ".ui-pdp-header__subtitle",
      ".ui-pdp-seller-info__status",
    ];

    if (!sellerName) {
      for (const sel of sellerSelectors) {
        const el = document.querySelector(sel);
        if (!el || !el.innerText) continue;

        let raw = el.innerText.trim().replace(/\s+/g, " ");
        if (/loja oficial/i.test(raw)) continue;
        if (isTextoRuim(raw)) continue;

        const limpo = limparTexto(raw);
        if (!limpo || isTextoRuim(limpo)) continue;

        const partes = limpo.split(" ");
        if (partes.length > 5) continue;

        sellerName = limpo;
        break;
      }
    }

    if (!sellerName && document.title) {
      const m = document.title.match(/Loja\s+Oficial\s+(.+)/i);
      if (m) sellerName = m[1].trim();
    }

    if (!sellerName) sellerName = "Vendedor";

    return {
      title,
      price,
      originalPrice,
      installmentsQty,
      installmentsAmount,
      sellerName,
      imageUrl,
    };
  });

  await browser.close();
  return data;
}

// ===============================
// MONTAGEM DO CARD
// ===============================
function buildPromoMessage(data) {
  const {
    title,
    price,
    originalPrice,
    installmentsQty,
    installmentsAmount,
    sellerName,
    affiliateUrl,
    cupom,
    pix,
    fromPrice,
    priceDetails,
    unitPriceText,
    comparePriceText,
    parcelasText,
    topMsg,
    finalMsg,
    obsIa,
    obs,
  } = data;

  let msg = "";

  if (topMsg) msg += `${topMsg}\n\n`;

  msg += `*${title}*\n\n`;

  if (originalPrice) msg += `De ${formatBRL(originalPrice)}\n`;

  if (price) {
    const label = fromPrice ? "A partir de" : "Por";
    msg += `${label} ${formatBRL(price)}\n`;
  }

  if (priceDetails) msg += `${priceDetails}\n`;

  if (parcelasText) {
    msg += `${parcelasText}\n`;
  } else if (installmentsQty && installmentsAmount) {
    msg += `Em até ${installmentsQty}x de ${formatBRL(installmentsAmount)}\n`;
  }

  if (unitPriceText) msg += `\n⚖️ ${unitPriceText}\n`;
  if (comparePriceText) msg += `📊 ${comparePriceText}\n`;

  if (pix) msg += `\n💸 Pix: ${pix}\n`;

  if (cupom) msg += `\n📄 Utilize o Cupom: *${cupom}*\n`;

  if (obsIa) msg += `\n✨ ${obsIa}\n`;
  if (obs) msg += `\n🗒 ${obs}\n`;

  if (finalMsg) msg += `\n${finalMsg}\n`;

  msg += `\n🔗 Link do Produto:\n${affiliateUrl}\n\n`;
  msg += `Vendido por: *${sellerName}*`;

  return msg;
}

// atualiza só a legenda + botões
async function updateCardCaption(chatId) {
  const session = sessions.get(chatId);
  if (!session) return;

  const { lastMessageId, data } = session;

  const newCaption = buildPromoMessage(data);
  const keyboard = getOptionsKeyboard();

  await bot.telegram.editMessageCaption(
    chatId,
    lastMessageId,
    undefined,
    newCaption,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard.reply_markup,
    }
  );
}

// troca imagem do card
async function updateCardImage(chatId, newUrl) {
  const session = sessions.get(chatId);
  if (!session) return;

  session.data.imageUrl = newUrl;

  const media = {
    type: "photo",
    media: newUrl,
    caption: buildPromoMessage(session.data),
    parse_mode: "Markdown",
  };

  const keyboard = getOptionsKeyboard();

  await bot.telegram.editMessageMedia(
    chatId,
    session.lastMessageId,
    undefined,
    media,
    { reply_markup: keyboard.reply_markup }
  );
}

// ===============================
// /promo
// ===============================
bot.command("promo", async (ctx) => {
  try {
    const text = ctx.message.text;

    const urls = text.match(/https?:\/\/\S+/g);
    if (!urls || urls.length === 0) {
      return ctx.reply(
        "Me manda assim:\n/promo <link_compartilhado_do_produto> <link_afiliado_sec> [cupom=APROVEITA] [pix=R$ 88,00]"
      );
    }

    const sharedUrl = urls[0];
    const affiliateUrl = urls[1] || urls[0];

    const cupomMatch = text.match(/cupom=([^\s]+)/i);
    const pixMatch = text.match(/pix=([^\n]+)/i);

    const cupom = cupomMatch ? cupomMatch[1] : null;
    const pix = pixMatch ? pixMatch[1].trim() : null;

    await ctx.reply("⏳ Buscando dados do produto...");

    const scraped = await scrapeProduct(sharedUrl);

    const data = {
      ...scraped,
      affiliateUrl,
      cupom,
      pix,
      fromPrice: false,
      priceDetails: null,
      unitPriceText: null,
      comparePriceText: null,
      parcelasText: null,
      topMsg: null,
      finalMsg: null,
      obsIa: null,
      obs: null,
    };

    const caption = buildPromoMessage(data);
    const keyboard = getOptionsKeyboard();

    let sent;
    if (data.imageUrl) {
      sent = await ctx.replyWithPhoto(data.imageUrl, {
        caption,
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    } else {
      sent = await ctx.reply(caption, {
        parse_mode: "Markdown",
        reply_markup: keyboard.reply_markup,
      });
    }

    sessions.set(ctx.chat.id, {
      lastMessageId: sent.message_id,
      data,
      pendingField: null,
    });
  } catch (err) {
    console.error("ERRO AO GERAR PROMOÇÃO:", err.message || err);
    ctx.reply(
      "Não consegui gerar a promoção 😥\nConfere o link e tenta de novo.\nUse assim:\n/promo <link_compartilhado_do_produto> <link_afiliado_sec> [cupom=...] [pix=...]"
    );
  }
});

// ===============================
// /registrargrupo  (rodar DENTRO do grupo)
// ===============================
bot.command("registrargrupo", async (ctx) => {
  ensureGroupRegistered(ctx.chat);
  await ctx.reply("Grupo registrado para disparos ✅");
});

// opcional: listar grupos registrados
bot.command("listagrupos", async (ctx) => {
  if (telegramGroups.length === 0) {
    return ctx.reply("Nenhum grupo registrado ainda.");
  }
  let msg = "Grupos registrados:\n\n";
  telegramGroups.forEach((g) => {
    msg += `- ${g.title} (ID: \`${g.id}\`)\n`;
  });
  ctx.reply(msg, { parse_mode: "Markdown" });
});

// ===============================
// /registrarwhats  (cadastrar nome de grupo de WhatsApp)
// ===============================
bot.command("registrarwhats", async (ctx) => {
  const text = ctx.message.text || "";
  const name = text.replace("/registrarwhats", "").trim();

  if (!name) {
    return ctx.reply(
      "Use assim:\n/registrarwhats Nome do Grupo\n\nExemplo:\n/registrarwhats Promonene 👶 5A\n\nO nome tem que ser IGUAL ao nome do grupo no Whats."
    );
  }

  const id = Date.now(); // ID simples só pra diferenciar

  whatsappGroups.push({ id, title: name });
  saveWhatsGroups(whatsappGroups);

  await ctx.reply(`Grupo de WhatsApp registrado: *${name}* ✅`, {
    parse_mode: "Markdown",
  });
});

// opcional: listar grupos de WhatsApp cadastrados
bot.command("listawhats", async (ctx) => {
  if (whatsappGroups.length === 0) {
    return ctx.reply("Nenhum grupo de WhatsApp registrado ainda.");
  }
  let msg = "Grupos de WhatsApp registrados:\n\n";
  whatsappGroups.forEach((g) => {
    msg += `- ${g.title} (ID interno: \`${g.id}\`)\n`;
  });
  ctx.reply(msg, { parse_mode: "Markdown" });
});

// ===============================
// CALLBACKS DOS BOTÕES
// ===============================
bot.on("callback_query", async (ctx) => {
  const chatId = ctx.chat.id;
  const dataCb = ctx.callbackQuery.data;
  const session = sessions.get(chatId);

  // ==== callbacks específicos dos grupos (Telegram) ====
  if (dataCb === "tg_no_groups") {
    await ctx.answerCbQuery(
      "Nenhum grupo registrado. Adicione o bot em um grupo e mande /registrargrupo.",
      { show_alert: true }
    );
    return;
  }

  if (dataCb === "tg_all_groups") {
    if (!session) {
      await ctx.answerCbQuery("Gera uma promoção primeiro com /promo 😉", {
        show_alert: true,
      });
      return;
    }

    const caption = buildPromoMessage(session.data);
    const imageUrl = session.data.imageUrl;

    for (const g of telegramGroups) {
      try {
        if (imageUrl) {
          await bot.telegram.sendPhoto(g.id, imageUrl, {
            caption,
            parse_mode: "Markdown",
          });
        } else {
          await bot.telegram.sendMessage(g.id, caption, {
            parse_mode: "Markdown",
          });
        }
      } catch (e) {
        console.log(
          `Erro ao enviar promoção para o grupo ${g.title} (${g.id}):`,
          e.message
        );
      }
    }

    await ctx.answerCbQuery("Promoção enviada para todos os grupos ✅", {
      show_alert: true,
    });
    await ctx.reply("Promoção enviada para todos os grupos ✅");
    return;
  }

  if (dataCb.startsWith("tg_group_")) {
    if (!session) {
      await ctx.answerCbQuery("Gera uma promoção primeiro com /promo 😉", {
        show_alert: true,
      });
      return;
    }

    const idStr = dataCb.replace("tg_group_", "");
    const groupId = Number(idStr);
    const group = telegramGroups.find((g) => g.id === groupId);

    if (!group) {
      await ctx.answerCbQuery("Grupo não encontrado na lista.", {
        show_alert: true,
      });
      return;
    }

    const caption = buildPromoMessage(session.data);
    const imageUrl = session.data.imageUrl;

    try {
      if (imageUrl) {
        await bot.telegram.sendPhoto(group.id, imageUrl, {
          caption,
          parse_mode: "Markdown",
        });
      } else {
        await bot.telegram.sendMessage(group.id, caption, {
          parse_mode: "Markdown",
        });
      }

      await ctx.answerCbQuery(`Promoção enviada para ${group.title} ✅`, {
        show_alert: true,
      });
      await ctx.reply(`Promoção enviada para *${group.title}* ✅`, {
        parse_mode: "Markdown",
      });
    } catch (e) {
      console.log(
        `Erro ao enviar promoção para o grupo ${group.title} (${group.id}):`,
        e.message
      );
      await ctx.answerCbQuery(
        "Não consegui enviar para esse grupo (verifique permissões do bot).",
        { show_alert: true }
      );
    }

    return;
  }

  // ==== callbacks específicos dos grupos de WhatsApp ====
  if (dataCb === "wa_no_groups") {
    await ctx.answerCbQuery(
      "Nenhum grupo de WhatsApp cadastrado. Use /registrarwhats Nome do Grupo.",
      { show_alert: true }
    );
    return;
  }

  if (dataCb === "wa_all_groups") {
    if (!session) {
      await ctx.answerCbQuery("Gera uma promoção primeiro com /promo 😉", {
        show_alert: true,
      });
      return;
    }

    const caption = buildPromoMessage(session.data);
    const imageUrl = session.data.imageUrl || null;

    for (const g of whatsappGroups) {
      try {
        await axios.post(
          `${WHATS_SERVER_URL}/whats/send`,
          {
            groupTitle: g.title,
            message: caption,
            imageUrl,
          },
          { timeout: 30000 }
        );
      } catch (e) {
        console.error(
          `Erro ao enviar para grupo Whats ${g.title}:`,
          e.message
        );
      }
    }

    await ctx.answerCbQuery(
      "Disparo solicitado para todos os grupos de WhatsApp ✅",
      { show_alert: true }
    );
    await ctx.reply(
      "📲 Disparo automático solicitado para todos os grupos de WhatsApp cadastrados."
    );
    return;
  }

  if (dataCb.startsWith("wa_group_")) {
    if (!session) {
      await ctx.answerCbQuery("Gera uma promoção primeiro com /promo 😉", {
        show_alert: true,
      });
      return;
    }

    const idStr = dataCb.replace("wa_group_", "");
    const groupId = Number(idStr);
    const group = whatsappGroups.find((g) => g.id === groupId);

    if (!group) {
      await ctx.answerCbQuery("Grupo de Whats não encontrado na lista.", {
        show_alert: true,
      });
      return;
    }

    const caption = buildPromoMessage(session.data);
    const imageUrl = session.data.imageUrl || null;

    try {
      await axios.post(
        `${WHATS_SERVER_URL}/whats/send`,
        {
          groupTitle: group.title,
          message: caption,
          imageUrl,
        },
        { timeout: 30000 }
      );

      await ctx.answerCbQuery(
        `Disparo automático solicitado para ${group.title} ✅`,
        { show_alert: true }
      );
      await ctx.reply(
        `📲 Oferta enviada (ou em envio) para o grupo *${group.title}* no WhatsApp.`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      console.error("Erro ao chamar servidor Whats:", e.message);
      await ctx.answerCbQuery(
        "Erro ao falar com o servidor do Whats. Veja os logs.",
        { show_alert: true }
      );
      await ctx.reply(
        "❌ Não consegui enviar para o WhatsApp. Verifique se o *whats-server.js* está rodando e conectado.",
        { parse_mode: "Markdown" }
      );
    }

    return;
  }

  if (dataCb === "back_main_menu") {
    const keyboard = getOptionsKeyboard();
    await ctx.editMessageReplyMarkup(keyboard.reply_markup);
    await ctx.answerCbQuery("Voltando para as opções da promoção");
    return;
  }

  // ==== daqui pra baixo usa sessão normal (edição de card) ====
  if (!session) {
    await ctx.answerCbQuery("Gera uma promoção primeiro com /promo");
    return;
  }

  const s = session;

  switch (dataCb) {
    case "opt_nome":
      s.pendingField = "title";
      await ctx.answerCbQuery();
      await ctx.reply("Digite o novo *nome do produto*:", {
        parse_mode: "Markdown",
      });
      break;

    case "opt_preco":
      s.pendingField = "price";
      await ctx.answerCbQuery();
      await ctx.reply("Digite o novo *preço* (apenas número, ex: 134.9):", {
        parse_mode: "Markdown",
      });
      break;

    case "opt_apartir":
      s.data.fromPrice = !s.data.fromPrice;
      await ctx.answerCbQuery("Atualizado ✅");
      await updateCardCaption(chatId);
      break;

    case "opt_parcelas":
      s.pendingField = "parcelasText";
      await ctx.answerCbQuery();
      await ctx.reply(
        "Digite o texto das *parcelas* (ex: Em até 10x de R$ 19,90):",
        { parse_mode: "Markdown" }
      );
      break;

    case "opt_detalhes_preco":
      s.pendingField = "priceDetails";
      await ctx.answerCbQuery();
      await ctx.reply(
        "Digite os *detalhes do preço* (ex: à vista no boleto, etc):",
        { parse_mode: "Markdown" }
      );
      break;

    case "opt_preco_unidade":
      s.pendingField = "unitPriceText";
      await ctx.answerCbQuery();
      await ctx.reply(
        "Digite o *preço por unidade* (ex: R$ 1,20 por cápsula):",
        { parse_mode: "Markdown" }
      );
      break;

    case "opt_preco_comparacao":
      s.pendingField = "comparePriceText";
      await ctx.answerCbQuery();
      await ctx.reply(
        "Digite o *preço comparação* (ex: antes custava R$ X na concorrência):",
        { parse_mode: "Markdown" }
      );
      break;

    case "opt_msg_topo":
      s.pendingField = "topMsg";
      await ctx.answerCbQuery();
      await ctx.reply(
        "Digite a *mensagem do topo* (vai aparecer antes do título):",
        { parse_mode: "Markdown" }
      );
      break;

    case "opt_msg_final":
      s.pendingField = "finalMsg";
      await ctx.answerCbQuery();
      await ctx.reply(
        "Digite a *mensagem final* (aparece antes de 'Vendido por'):",
        { parse_mode: "Markdown" }
      );
      break;

    case "opt_loja":
      s.pendingField = "sellerName";
      await ctx.answerCbQuery();
      await ctx.reply("Digite o *nome da loja/vendedor*:", {
        parse_mode: "Markdown",
      });
      break;

    case "opt_cupom":
      s.pendingField = "cupom";
      await ctx.answerCbQuery();
      await ctx.reply("Digite o *cupom* (ex: MEUCUPOM10):", {
        parse_mode: "Markdown",
      });
      break;

    case "opt_obs_ia":
      s.pendingField = "obsIa";
      await ctx.answerCbQuery();
      await ctx.reply(
        "Digite as *observações com IA* (um texto extra que fica no card):",
        { parse_mode: "Markdown" }
      );
      break;

    case "opt_obs":
      s.pendingField = "obs";
      await ctx.answerCbQuery();
      await ctx.reply("Digite as *observações* extras:", {
        parse_mode: "Markdown",
      });
      break;

    case "opt_img":
      s.pendingField = "imageUrl";
      await ctx.answerCbQuery();
      await ctx.reply(
        "Envie a *URL da nova imagem* (link direto da imagem):",
        { parse_mode: "Markdown" }
      );
      break;

    case "opt_ativar":
      await ctx.answerCbQuery("Em breve: integração com site (modo teste) 😄", {
        show_alert: true,
      });
      break;

    case "opt_whats": {
      const kb = getWhatsGroupsKeyboard();
      await ctx.editMessageReplyMarkup(kb.reply_markup);
      await ctx.answerCbQuery();
      await ctx.reply(
        "Selecione o(s) grupo(s) de *WhatsApp* para disparar automaticamente:",
        { parse_mode: "Markdown" }
      );
      break;
    }

    case "opt_telegram": {
      const kb = getTelegramGroupsKeyboard();
      await ctx.editMessageReplyMarkup(kb.reply_markup);
      await ctx.answerCbQuery();
      await ctx.reply("Selecione os grupos para enviar a promoção:");
      break;
    }

    case "opt_story_instagram":
      await ctx.answerCbQuery(
        "Em breve: geração automática de Story (modo teste) 😄",
        { show_alert: true }
      );
      break;

    default:
      await ctx.answerCbQuery();
  }
});

// ===============================
// TRATAMENTO DOS TEXTOS (edições)
// ===============================
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  // ignora comandos (já tratados em bot.command)
  if (text.startsWith("/")) return;

  const session = sessions.get(chatId);
  if (!session || !session.pendingField) {
    await ctx.reply(
      "Pra gerar uma oferta, use:\n/promo <link_compartilhado_do_produto> <link_afiliado_sec> [cupom=...] [pix=...]"
    );
    return;
  }

  const field = session.pendingField;
  const value = text.trim();

  switch (field) {
    case "title":
      session.data.title = value;
      break;

    case "price": {
      const num = parseFloat(value.replace(",", "."));
      if (!isNaN(num)) session.data.price = num;
      break;
    }

    case "parcelasText":
      session.data.parcelasText = value;
      break;

    case "priceDetails":
      session.data.priceDetails = value;
      break;

    case "unitPriceText":
      session.data.unitPriceText = value;
      break;

    case "comparePriceText":
      session.data.comparePriceText = value;
      break;

    case "topMsg":
      session.data.topMsg = value;
      break;

    case "finalMsg":
      session.data.finalMsg = value;
      break;

    case "sellerName":
      session.data.sellerName = value;
      break;

    case "cupom":
      session.data.cupom = value;
      break;

    case "obsIa":
      session.data.obsIa = value;
      break;

    case "obs":
      session.data.obs = value;
      break;

    case "imageUrl":
      session.pendingField = null;
      await updateCardImage(chatId, value);
      await ctx.reply("Imagem atualizada ✅");
      return;

    default:
      break;
  }

  session.pendingField = null;
  await updateCardCaption(chatId);
  await ctx.reply("Card atualizado ✅");
});

// ===============================
// START
// ===============================
bot.start((ctx) => {
  ctx.reply(
    "Bem-vindo ao PromoRadar.ia 🚀\n\n" +
      "Use assim:\n" +
      "/promo <link_compartilhado_do_produto> <link_afiliado_sec> [cupom=...] [pix=...]\n\n" +
      "Para registrar grupos de disparo (Telegram): adicione o bot no grupo e mande /registrargrupo.\n" +
      "Para registrar grupos de WhatsApp: mande /registrarwhats Nome do Grupo aqui no chat do bot (igual está no Whats)."
  );
});

bot.launch().then(() => {
  console.log("PromoRadar.ia rodando no Telegram 🚀");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
