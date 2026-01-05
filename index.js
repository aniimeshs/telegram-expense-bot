require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { google } = require("googleapis");
const express = require("express");

/* ================== TELEGRAM BOT ================== */

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

/* ================== GOOGLE AUTH ================== */

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

/* ================== HELPERS ================== */

async function getAllTransactions() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "Transactions!A2:H",
  });
  return res.data.values || [];
}

function isSameDay(dateStr) {
  const d = new Date(dateStr);
  const t = new Date();
  return (
    d.getDate() === t.getDate() &&
    d.getMonth() === t.getMonth() &&
    d.getFullYear() === t.getFullYear()
  );
}

function isSameMonth(dateStr) {
  const d = new Date(dateStr);
  const t = new Date();
  return d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
}

/* ================== MESSAGE PARSER ================== */

function parseMessage(text) {
  const p = text.trim().split(" ");
  const now = new Date().toLocaleString();

  // Salary
  if (p[0] === "salary") {
    return [{
      date: now,
      amount: Number(p[1]),
      flow: "INCOME",
      category: "salary",
      account: p[2],
      description: "Salary Credit",
      ref: "",
      raw: text,
    }];
  }

  // Borrowed
  if (p[0] === "borrow") {
    return [{
      date: now,
      amount: Number(p[1]),
      flow: "BORROWED",
      category: p[4],
      account: p[3],
      description: `Borrowed from ${p[2]}`,
      ref: p[2],
      raw: text,
    }];
  }

  // Received
  if (p[0] === "receive") {
    return [{
      date: now,
      amount: Number(p[1]),
      flow: "RECEIVED",
      category: p[4],
      account: p[3],
      description: `Received from ${p[2]}`,
      ref: p[2],
      raw: text,
    }];
  }

  // Transfer
  if (p[2] === "transfer") {
    return [
      {
        date: now,
        amount: Number(p[0]),
        flow: "TRANSFER_OUT",
        category: "transfer",
        account: p[1],
        description: `Transfer to ${p[3]}`,
        ref: p[3],
        raw: text,
      },
      {
        date: now,
        amount: Number(p[0]),
        flow: "TRANSFER_IN",
        category: "transfer",
        account: p[3],
        description: `Transfer from ${p[1]}`,
        ref: p[1],
        raw: text,
      },
    ];
  }

  // Normal / investment
  return [{
    date: now,
    amount: Number(p[0]),
    flow: p[p.length - 1] === "invest" ? "INVESTMENT" : "EXPENSE",
    category: p[p.length - 1],
    account: p[p.length - 2],
    description: p.slice(1, -2).join(" "),
    ref: "",
    raw: text,
  }];
}

/* ================== SINGLE MESSAGE HANDLER ================== */

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  // -------- COMMANDS --------
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
      return bot.sendMessage(chatId, `Today: ₹${sum}`);
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
`Expense: ₹${e}
Income: ₹${i}
Investment: ₹${inv}`);
    }

    if (text === "/borrowed") {
      let b = 0, r = 0;
      rows.forEach(([, a, f]) => {
        if (f === "BORROWED") b += +a;
        if (f === "RECEIVED") r += +a;
      });
      return bot.sendMessage(chatId, `Pending: ₹${b - r}`);
    }

    return;
  }

  // -------- LOGGING --------
  try {
    const entries = parseMessage(text);
    for (const e of entries) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: "Transactions!A:H",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            e.date, e.amount, e.flow, e.category,
            e.account, e.description, e.ref, e.raw
          ]],
        },
      });
    }
    bot.sendMessage(chatId, "✅ Logged");
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Error");
  }
});

/* ================== SAFE POLLING START ================== */

(async () => {
  await bot.stopPolling().catch(() => {});
  await bot.startPolling();
  console.log("🤖 Telegram polling started safely");
})();

/* ================== EXPRESS (RENDER) ================== */

const app = express();
app.get("/", (_, res) => res.send("Bot running"));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 HTTP server ready")
);
