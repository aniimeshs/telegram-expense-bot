require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { google } = require("googleapis");

/* ================== TELEGRAM BOT ================== */

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: false,
});

/* ================== GOOGLE AUTH ================== */

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

/* ================== MESSAGE PARSER ================== */

function parseMessage(text) {
  const parts = text.trim().split(" ");
  let flowType = "EXPENSE";
  let amount, description, account, category, reference = "";

  // ===== SALARY =====
  if (parts[0] === "salary") {
    amount = Number(parts[1]);
    account = parts[2];
    category = "salary";
    description = "Salary Credit";
    flowType = "INCOME";

    return {
      entries: [{
        date: new Date().toLocaleString(),
        amount,
        flowType,
        category,
        account,
        description,
        reference: "",
        raw: text
      }]
    };
  }

  // ===== BORROWED =====
  if (parts[0] === "borrow") {
    amount = Number(parts[1]);
    reference = parts[2];
    account = parts[3];
    category = parts[4];

    return {
      entries: [{
        date: new Date().toLocaleString(),
        amount,
        flowType: "BORROWED",
        category,
        account,
        description: `Borrowed from ${reference}`,
        reference,
        raw: text
      }]
    };
  }

  // ===== RECEIVED =====
  if (parts[0] === "receive") {
    amount = Number(parts[1]);
    reference = parts[2];
    account = parts[3];
    category = parts[4];

    return {
      entries: [{
        date: new Date().toLocaleString(),
        amount,
        flowType: "RECEIVED",
        category,
        account,
        description: `Received from ${reference}`,
        reference,
        raw: text
      }]
    };
  }

  // ===== TRANSFER =====
  if (parts[2] === "transfer") {
    amount = Number(parts[0]);
    const fromAccount = parts[1];
    const toAccount = parts[3];

    return {
      entries: [
        {
          date: new Date().toLocaleString(),
          amount,
          flowType: "TRANSFER_OUT",
          category: "transfer",
          account: fromAccount,
          description: `Transfer to ${toAccount}`,
          reference: toAccount,
          raw: text
        },
        {
          date: new Date().toLocaleString(),
          amount,
          flowType: "TRANSFER_IN",
          category: "transfer",
          account: toAccount,
          description: `Transfer from ${fromAccount}`,
          reference: fromAccount,
          raw: text
        }
      ]
    };
  }

  // ===== NORMAL / INVESTMENT =====
  amount = Number(parts[0]);
  if (isNaN(amount)) return null;

  account = parts[parts.length - 2];
  category = parts[parts.length - 1];
  description = parts.slice(1, -2).join(" ");

  flowType = category === "invest" ? "INVESTMENT" : "EXPENSE";

  return {
    entries: [{
      date: new Date().toLocaleString(),
      amount,
      flowType,
      category,
      account,
      description,
      reference: "",
      raw: text
    }]
  };
}

/* ================== BOT LISTENER ================== */

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || !text.startsWith("/")) return;

  try {
    const rows = await getAllTransactions();

    // /help
    if (text === "/help") {
      return bot.sendMessage(
        chatId,
        `
📘 *Expense Bot Commands*

/today → Today's expense
/month → Monthly summary
/borrowed → Outstanding borrowed
/help → Command list

🧾 Log examples:
250 lunch kotak foodout
salary 60000 icici income
borrow 5000 friend sbi misc
receive 3000 friend kotak misc
5000 sip icici invest
        `,
        { parse_mode: "Markdown" }
      );
    }

    // /today
    if (text === "/today") {
      let total = 0;
      rows.forEach(([date, amount, flow]) => {
        if (flow === "EXPENSE" && isSameDay(date)) {
          total += Number(amount);
        }
      });

      return bot.sendMessage(chatId, `📅 Today’s Expense: ₹${total}`);
    }

    // /month
    if (text === "/month") {
      let expense = 0, income = 0, investment = 0;

      rows.forEach(([date, amount, flow]) => {
        if (!isSameMonth(date)) return;
        if (flow === "EXPENSE") expense += Number(amount);
        if (flow === "INCOME") income += Number(amount);
        if (flow === "INVESTMENT") investment += Number(amount);
      });

      return bot.sendMessage(
        chatId,
        `📊 *This Month*
Expense: ₹${expense}
Income: ₹${income}
Investment: ₹${investment}`,
        { parse_mode: "Markdown" }
      );
    }

    // /borrowed
    if (text === "/borrowed") {
      let borrowed = 0, received = 0;

      rows.forEach(([, amount, flow]) => {
        if (flow === "BORROWED") borrowed += Number(amount);
        if (flow === "RECEIVED") received += Number(amount);
      });

      const pending = borrowed - received;

      return bot.sendMessage(
        chatId,
        `🤝 Borrowed Summary
Borrowed: ₹${borrowed}
Received: ₹${received}
Pending: ₹${pending}`
      );
    }

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Error processing command");
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  const parsed = parseMessage(text);
  if (!parsed) {
    bot.sendMessage(chatId, "❌ Invalid format");
    return;
  }

  for (const data of parsed.entries) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: "Transactions!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          data.date,
          data.amount,
          data.flowType,
          data.category,
          data.account,
          data.description,
          data.reference,
          data.raw
        ]]
      }
    });
  }


  if (!data) {
    bot.sendMessage(
      chatId,
      `❌ Invalid format

Examples:
250 lunch kotak foodout
salary 60000 icici income
borrow 5000 friend sbi misc
receive 3000 friend kotak misc
5000 sip icici invest`
    );
    return;
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: "Transactions!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          data.date,
          data.amount,
          data.flowType,
          data.category,
          data.account,
          data.description,
          data.reference,
          data.raw,
        ]],
      },
    });

    bot.sendMessage(chatId, `✅ Logged ₹${data.amount}`);
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "❌ Failed to save entry");
  }
});

async function getAllTransactions() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "Transactions!A2:H", // skip header
  });

  return res.data.values || [];
}

function isSameDay(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
}

function isSameMonth(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

async function startBot() {
  try {
    await bot.stopPolling(); // safety
    await bot.startPolling();
    console.log("🤖 Telegram polling started safely");
  } catch (err) {
    console.error("Polling start error:", err.message);
  }
}

startBot();

console.log("🚀 Expense Bot is running...");


const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Telegram Expense Bot is running 🚀");
});

app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
});