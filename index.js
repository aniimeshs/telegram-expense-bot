require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { google } = require("googleapis");

/* ================== TELEGRAM BOT ================== */

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
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

  // SALARY
  if (parts[0] === "salary") {
    amount = Number(parts[1]);
    account = parts[2];
    category = "salary";
    description = "Salary Credit";
    flowType = "INCOME";
  }

  // BORROWED
  else if (parts[0] === "borrow") {
    amount = Number(parts[1]);
    reference = parts[2];
    account = parts[3];
    category = parts[4];
    description = `Borrowed from ${reference}`;
    flowType = "BORROWED";
  }

  // RECEIVED
  else if (parts[0] === "receive") {
    amount = Number(parts[1]);
    reference = parts[2];
    account = parts[3];
    category = parts[4];
    description = `Received from ${reference}`;
    flowType = "RECEIVED";
  }

  // NORMAL / INVESTMENT
  else {
    amount = Number(parts[0]);
    if (isNaN(amount)) return null;

    account = parts[parts.length - 2];
    category = parts[parts.length - 1];
    description = parts.slice(1, -2).join(" ");

    if (category === "invest") {
      flowType = "INVESTMENT";
    }
  }

  if (isNaN(amount)) return null;

  return {
    date: new Date().toLocaleString(),
    amount: Math.abs(amount),
    flowType,
    category,
    account,
    description,
    reference,
    raw: text,
  };
}

/* ================== BOT LISTENER ================== */

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  const data = parseMessage(text);

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