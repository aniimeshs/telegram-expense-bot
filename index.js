require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { google } = require("googleapis");
const express = require("express");

/* ================== BASIC SETUP ================== */

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.BOT_TOKEN);

/* ================== GOOGLE SHEETS ================== */

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

/* ================== HELPERS ================== */

async function appendRow(row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: "Transactions!A:H",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

async function getAllTransactions() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "Transactions!A2:H",
  });
  return res.data.values || [];
}

function isSameDay(d) {
  const x = new Date(d);
  const t = new Date();
  return (
    x.getDate() === t.getDate() &&
    x.getMonth() === t.getMonth() &&
    x.getFullYear() === t.getFullYear()
  );
}

function isSameMonth(d) {
  const x = new Date(d);
  const t = new Date();
  return x.getMonth() === t.getMonth() && x.getFullYear() === t.getFullYear();
}

/* ================== PARSER ================== */

function parseMessage(text) {
  const p = text.trim().split(" ");
  const now = new Date().toLocaleString();

  // salary
  if (p[0] === "salary") {
    return [[now, p[1], "INCOME", "salary", p[2], "Salary Credit", "", text]];
  }

  // borrow
  if (p[0] === "borrow") {
    return [[now, p[1], "BORROWED", p[4], p[3], `Borrowed from ${p[2]}`, p[2], text]];
  }

  // receive
  if (p[0] === "receive") {
    return [[now, p[1], "RECEIVED", p[4], p[3], `Received from ${p[2]}`, p[2], text]];
  }

  // transfer
  if (p[2] === "transfer") {
    return [
      [now, p[0], "TRANSFER_OUT", "transfer", p[1], `Transfer to ${p[3]}`, p[3], text],
      [now, p[0], "TRANSFER_IN", "transfer", p[3], `Transfer from ${p[1]}`, p[1], text],
    ];
  }

  // normal / investment
  return [[
    now,
    p[0],
    p[p.length - 1] === "invest" ? "INVESTMENT" : "EXPENSE",
    p[p.length - 1],
    p[p.length - 2],
    p.slice(1, -2).join(" "),
    "",
    text,
  ]];
}

/* ================== MESSAGE HANDLER ================== */

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  // ----- COMMANDS -----
  if (text.startsWith("/")) {
    const rows = await getAllTransactions();

    if (text === "/help") {
      return bot.sendMessage(chatId,
`/today – today expense
/month – monthly summary
/borrowed – pending borrowed`);
    }

    if (text === "/today") {
      let sum = 0;
      rows.forEach(([d, a, f]) => f === "EXPENSE" && isSameDay(d) && (sum += +a));
      return bot.sendMessage(chatId, `Today Expense: ₹${sum}`);
    }

    if (text === "/month") {
      let e = 0, i = 0, inv = 0;
      rows.forEach(([d, a, f]) => {
        if (!isSameMonth(d)) return;
        if (f === "EXPENSE") e += +a;
        if (f === "INCOME") i += +a;
        if (f === "INVESTMENT") inv += +a;
      });
      return bot.sendMessage(chatId,
`This Month
Expense: ₹${e}
Income: ₹${i}
Investment: ₹${inv}`);
    }

    if (text === "/borrowed") {
      let b = 0, r = 0;
      rows.forEach(([, a, f]) => {
        if (f === "BORROWED") b += +a;
        if (f === "RECEIVED") r += +a;
      });
      return bot.sendMessage(chatId, `Pending Borrowed: ₹${b - r}`);
    }

    return;
  }

  // ----- LOGGING -----
  try {
    const rows = parseMessage(text);
    for (const r of rows) await appendRow(r);
    bot.sendMessage(chatId, "✅ Logged");
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, "❌ Error logging entry");
  }
});

/* ================== WEBHOOK ================== */

app.post("/telegram-webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (_, res) => res.send("Telegram Expense Bot running 🚀"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log("🌐 Server running on port", PORT);

  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/telegram-webhook`;
  await bot.setWebHook(webhookUrl);
  console.log("🔗 Webhook set:", webhookUrl);
});
