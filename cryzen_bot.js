// ╔══════════════════════════════════════════════════════════════╗
// ║          CRYZEN DATING BOT  v3.0  —  FINAL                  ║
// ║   Stack : Node.js  +  node-telegram-bot-api                  ║
// ║   Setup : npm install node-telegram-bot-api                  ║
// ║   Run   : node cryzen_bot.js                                 ║
// ║   24/7  : pm2 start cryzen_bot.js --name cryzen             ║
// ╚══════════════════════════════════════════════════════════════╝

"use strict";
const TelegramBot = require("node-telegram-bot-api");

// ════════════════════════════════════════════════════════════════
//  ⚙️  CONFIG  —  SIRF YAHAN APNA DATA DAALO
// ════════════════════════════════════════════════════════════════
const CONFIG = {
  TOKEN        : "YOUR_BOT_TOKEN_HERE",   // @BotFather se milega
  ADMIN_ID     : 123456789,               // apna Telegram numeric ID
  BOT_USERNAME : "CryzenDatingBot",       // @username (without @)
  REFER_HOURS  : 2,                       // refer karne par free VIP hours
  STARS        : { "1d":199, "7d":499, "30d":999, "180d":2999 },
};
// ════════════════════════════════════════════════════════════════

const bot = new TelegramBot(CONFIG.TOKEN, {
  polling: { interval:300, autoStart:true, params:{ timeout:10 } }
});

// ── DATABASE (in-memory) ─────────────────────────────────────
const DB = {
  users       : {},   // id → user object
  waitQueue   : [],   // free random queue
  premQueue   : [],   // premium priority queue
  activeChats : {},   // userId ↔ partnerId
  reportLog   : {},   // userId → timestamp
};

// ── USER FACTORY ─────────────────────────────────────────────
function user(id) {
  if (!DB.users[id]) DB.users[id] = {
    id, name:null, age:null, gender:null, country:null,
    step:"start", premium:false, premiumExpiry:null,
    referCode:String(id), referredBy:null, referCount:0,
    totalChats:0, banned:false, reportCount:0,
    joinedAt:new Date(),
  };
  return DB.users[id];
}

// ── PREMIUM HELPERS ──────────────────────────────────────────
function isPrem(id) {
  const u = user(id);
  if (!u.premium) return false;
  if (u.premiumExpiry && new Date() > u.premiumExpiry) { u.premium=false; return false; }
  return true;
}

function grantPrem(id, hours) {
  const u   = user(id);
  const now = new Date();
  u.premiumExpiry = u.premiumExpiry && u.premiumExpiry > now
    ? new Date(u.premiumExpiry.getTime() + hours*3600000)
    : new Date(now.getTime() + hours*3600000);
  u.premium = true;
}

function timeLeft(id) {
  const u  = user(id);
  if (!u.premiumExpiry) return "—";
  const ms = u.premiumExpiry - new Date();
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── QUEUE HELPERS ────────────────────────────────────────────
function dequeue(id) {
  [DB.waitQueue, DB.premQueue].forEach(q => {
    const i = q.findIndex(x => x.userId===id);
    if (i!==-1) q.splice(i,1);
  });
}

function endChat(id) {
  const p = DB.activeChats[id];
  if (!p) return null;
  delete DB.activeChats[id];
  delete DB.activeChats[p];
  return p;
}

function badge(u) {
  const crown = isPrem(u.id) ? "👑 " : "";
  const g = u.gender==="male"?"👨":u.gender==="female"?"👩":"✨";
  return `${crown}${u.name} ${g}  •  🎂${u.age}  •  🌍${u.country}`;
}

// ════════════════════════════════════════════════════════════════
//  ⌨️  KEYBOARDS
// ════════════════════════════════════════════════════════════════

// ── BOTTOM REPLY KEYBOARD  (screenshot green circle) ─────────
function mainKB(id) {
  const p = isPrem(id);
  return {
    keyboard:[
      [{ text:"🎲 Find a partner" }],
      [
        { text: p ? "💃 Find a Girl"  : "🔒 Find a Girl"  },
        { text: p ? "🕺 Find a Guy"   : "🔒 Find a Guy"   },
      ],
      [
        { text:"🛠 Profile" },
        { text:"🏆 VIP access" },
        { text:"👫 Friends" },
      ],
    ],
    resize_keyboard:true,
    is_persistent:true,   // always visible, never disappears
  };
}

// ── VIP INLINE BUTTONS ───────────────────────────────────────
function vipKB() {
  return { inline_keyboard:[
    [
      { text:"1 Day — 199 ⭐",    callback_data:"buy_1d"    },
      { text:"7 Days — 499 ⭐",   callback_data:"buy_7d"    },
    ],
    [
      { text:"30 Days — 999 ⭐",  callback_data:"buy_30d"   },
      { text:"180 Days — 2999 ⭐",callback_data:"buy_180d"  },
    ],
    [{ text:"👫 Get FREE VIP by Referring Friends →", callback_data:"show_refer" }],
  ]};
}

// ── GENDER SELECT (onboarding) ───────────────────────────────
function genderKB() {
  return { inline_keyboard:[
    [
      { text:"👨 Male",             callback_data:"g_male"      },
      { text:"👩 Female",           callback_data:"g_female"    },
    ],
    [
      { text:"✨ Non-binary",       callback_data:"g_nonbinary" },
      { text:"🤫 Prefer not to say",callback_data:"g_other"     },
    ],
  ]};
}

// ════════════════════════════════════════════════════════════════
//  📋  BOT COMMANDS  (screenshot red circle — auto set on start)
// ════════════════════════════════════════════════════════════════
async function setCommands() {
  await bot.setMyCommands([
    { command:"next",    description:"🎭 Find a chat partner"  },
    { command:"stop",    description:"❌ End the conversation" },
    { command:"balance", description:"💰 Check VIP balance"    },
    { command:"report",  description:"⚠️ Send a complaint"    },
    { command:"earn",    description:"👫 Affiliate program"    },
    { command:"vip",     description:"🏆 Try VIP"             },
    { command:"profile", description:"🧑 Your profile"         },
    { command:"rules",   description:"📌 Chat rules"           },
    { command:"start",   description:"💜 Restart the bot"      },
  ]).catch(e => console.error("setCommands:", e.message));
}

// ════════════════════════════════════════════════════════════════
//  🎬  ONBOARDING  (Name → Age → Gender → Country)
// ════════════════════════════════════════════════════════════════
function startOnboarding(id) {
  const u = user(id);
  u.step = "name";
  send(id,
    `🔥 *Welcome to Cryzen Dating!*\n\n` +
    `The most unique anonymous dating experience on Telegram.\n\n` +
    `Let's set up your profile in *4 quick steps!*\n\n` +
    `👤 *Step 1 / 4* — Enter your name or nickname:`
  );
}

function handleOnboard(id, text) {
  const u = user(id);
  const t = text.trim();

  if (u.step==="name") {
    if (t.length<2||t.length>30) { send(id,"⚠️ Name must be 2–30 chars. Try again:"); return; }
    u.name=t; u.step="age";
    send(id, `Nice, *${u.name}!* 🙌\n\n🎂 *Step 2 / 4* — How old are you? _(13–99)_`);

  } else if (u.step==="age") {
    const a=parseInt(t);
    if (isNaN(a)||a<13||a>99) { send(id,"⚠️ Enter a valid age (13–99):"); return; }
    u.age=a; u.step="gender";
    bot.sendMessage(id, `⚡ *Step 3 / 4* — Select your gender:`,
      { parse_mode:"Markdown", reply_markup:genderKB() });

  } else if (u.step==="country") {
    if (t.length<2||t.length>40) { send(id,"⚠️ Enter a valid country name:"); return; }
    u.country=t; u.step="done";
    doneOnboard(id);
  }
}

function doneOnboard(id) {
  const u = user(id);
  bot.sendMessage(id,
    `🎉 *Profile Complete!*\n\n` +
    `👤 *${u.name}*  🎂 ${u.age}  🌍 ${u.country}\n` +
    `⚡ Gender: *${u.gender}*\n` +
    `🏆 Status: 🆓 Free\n\n` +
    `You're all set! Use the buttons below 👇`,
    { parse_mode:"Markdown", reply_markup:mainKB(id) }
  );
}

// ════════════════════════════════════════════════════════════════
//  💘  MATCHING ENGINE
// ════════════════════════════════════════════════════════════════
function tryMatch(entry, queue) {
  for (let i=0; i<queue.length; i++) {
    const c  = queue[i];
    if (c.userId===entry.userId) continue;
    const cu = user(c.userId), nu = user(entry.userId);
    const cOk = !c.genderPref       || c.genderPref       === nu.gender;
    const nOk = !entry.genderPref   || entry.genderPref   === cu.gender;
    if (cOk && nOk) { queue.splice(i,1); return c; }
  }
  return null;
}

function findMatch(id, genderPref) {
  const u = user(id);
  if (u.banned)          { send(id,"🚫 You are banned from Cryzen."); return; }
  if (u.step!=="done")   { startOnboarding(id); return; }

  dequeue(id);
  const entry = { userId:id, genderPref };
  const match = tryMatch(entry, DB.premQueue) || tryMatch(entry, DB.waitQueue);

  if (match) {
    DB.activeChats[id]          = match.userId;
    DB.activeChats[match.userId]= id;
    user(id).totalChats++;
    user(match.userId).totalChats++;

    const hint = `\n\n_/stop — end chat   •   /next — new partner_`;
    bot.sendMessage(id,
      `✅ *Partner found!*\n\n${badge(user(match.userId))}${hint}`,
      { parse_mode:"Markdown", reply_markup:mainKB(id) });
    bot.sendMessage(match.userId,
      `✅ *Partner found!*\n\n${badge(u)}${hint}`,
      { parse_mode:"Markdown", reply_markup:mainKB(match.userId) });
  } else {
    if (isPrem(id)) DB.premQueue.push(entry);
    else            DB.waitQueue.push(entry);
    send(id,`🔍 *Searching for a partner...*\n\n_You'll be connected as soon as someone is available!_\n\n_/stop — cancel_`);
  }
}

// ════════════════════════════════════════════════════════════════
//  📺  SCREENS
// ════════════════════════════════════════════════════════════════
function showProfile(id) {
  const u = user(id);
  if (u.step!=="done") { startOnboarding(id); return; }
  bot.sendMessage(id,
    `🧑 *Your Profile*\n\n` +
    `👤 Name: *${u.name}*\n` +
    `🎂 Age: *${u.age}*\n` +
    `⚡ Gender: *${u.gender}*\n` +
    `🌍 Country: *${u.country}*\n` +
    `🏆 Status: ${isPrem(id)?"👑 Premium":"🆓 Free"}\n` +
    `⏱ VIP Left: *${isPrem(id)?timeLeft(id):"—"}*\n` +
    `💬 Total Chats: *${u.totalChats}*\n` +
    `👫 Referrals: *${u.referCount}*`,
    { parse_mode:"Markdown",
      reply_markup:{ inline_keyboard:[
        [
          { text:"✏️ Edit Name",    callback_data:"ed_name"    },
          { text:"✏️ Edit Age",     callback_data:"ed_age"     },
        ],
        [{ text:"✏️ Edit Country",  callback_data:"ed_country" }],
      ]}
    }
  );
}

function showVIP(id) {
  bot.sendMessage(id,
    `🏆 *Cryzen VIP — Premium Access*\n\n` +
    `${isPrem(id)?`✅ *Active!*  Time left: *${timeLeft(id)}*\n\n`:``}` +
    `🔍 Search by gender (Male / Female / Non-binary)\n` +
    `⚡ Priority matching queue — match faster!\n` +
    `♾ Unlimited dialogue creation\n` +
    `👑 Premium badge on your profile\n\n` +
    `*Choose a plan:*`,
    { parse_mode:"Markdown", reply_markup:vipKB() }
  );
}

function showRefer(id) {
  const u    = user(id);
  const link = `https://t.me/${CONFIG.BOT_USERNAME}?start=${u.referCode}`;
  bot.sendMessage(id,
    `👫 *Refer & Earn Free VIP!*\n\n` +
    `Every friend who joins via your link = *${CONFIG.REFER_HOURS} hours* free VIP for you — automatically!\n\n` +
    `📊 *Your Stats:*\n` +
    `├ Invited: ${u.referCount}\n` +
    `└ Registered: ${u.referCount}\n\n` +
    `🔗 *Your Personal Link:*\n` +
    `👉 \`${link}\`\n\n` +
    `_(Tap to copy, then share anywhere!)_`,
    { parse_mode:"Markdown",
      reply_markup:{ inline_keyboard:[[
        { text:"📤 Share my link", switch_inline_query:`Join Cryzen Dating Bot! ${link}` }
      ]]}
    }
  );
}

function showBalance(id) {
  const p = isPrem(id);
  bot.sendMessage(id,
    `💰 *Your Balance*\n\n` +
    `VIP Status: ${p?"✅ Active":"❌ Inactive"}\n` +
    `Time Remaining: *${p?timeLeft(id):"None"}*`,
    { parse_mode:"Markdown", reply_markup: p ? undefined : vipKB() }
  );
}

function showRules(id) {
  send(id,
    `📌 *Cryzen Chat Rules*\n\n` +
    `1. Respect all partners\n` +
    `2. No spam, scam, or phishing\n` +
    `3. No illegal content of any kind\n` +
    `4. No harassment or threats\n` +
    `5. Keep personal info private\n` +
    `6. No unsolicited adult content\n\n` +
    `⚠️ Violations = *permanent ban* with no appeal.\n` +
    `Stay safe & have fun! ❤️`
  );
}

function doReport(id) {
  const pid = DB.activeChats[id];
  if (!pid) { send(id,"⚠️ You must be in an active chat to report someone."); return; }
  const now = Date.now();
  if (DB.reportLog[id] && now-DB.reportLog[id]<60000) { send(id,"⚠️ Wait 1 minute before reporting again."); return; }
  DB.reportLog[id] = now;
  const rep = user(pid);
  rep.reportCount++;
  send(id,"✅ Report submitted. Thank you for keeping Cryzen safe! 🛡️");
  bot.sendMessage(CONFIG.ADMIN_ID,
    `🚨 *Report Received*\n\nReporter: \`${id}\`\nReported: \`${pid}\`\nTotal reports on reported: *${rep.reportCount}*`,
    { parse_mode:"Markdown" }
  );
  if (rep.reportCount>=3) {
    rep.banned=true;
    const p2=endChat(pid);
    if (p2) {
      send(p2,  "⛔ Your partner was removed for violating Cryzen rules.");
      send(pid, "🚫 You have been banned for multiple violations.");
    }
  }
}

// ── helper ───────────────────────────────────────────────────
function send(id, text) {
  return bot.sendMessage(id, text, { parse_mode:"Markdown" });
}

// ════════════════════════════════════════════════════════════════
//  🤖  /start  (with referral handling)
// ════════════════════════════════════════════════════════════════
bot.onText(/\/start(.*)/, (msg, m) => {
  const id    = msg.from.id;
  const param = (m[1]||"").trim();
  const u     = user(id);

  if (u.banned) { send(id,"🚫 You are banned from Cryzen."); return; }

  // ── referral tracking ──
  if (param && param!==String(id)) {
    const ref = Object.values(DB.users).find(x=>x.referCode===param);
    if (ref && !u.referredBy) {
      u.referredBy = ref.id;
      ref.referCount++;
      grantPrem(ref.id, CONFIG.REFER_HOURS);
      bot.sendMessage(ref.id,
        `🎉 *New Referral!*\n\nSomeone just joined using your link!\n` +
        `You got *${CONFIG.REFER_HOURS} hours* of free VIP! 👑\n\n` +
        `Total referrals: *${ref.referCount}*`,
        { parse_mode:"Markdown" }
      );
    }
  }

  if (u.step==="done") {
    bot.sendMessage(id, `👋 Welcome back, *${u.name}!* 🔥\nReady to chat?`,
      { parse_mode:"Markdown", reply_markup:mainKB(id) });
  } else {
    startOnboarding(id);
  }
});

// ════════════════════════════════════════════════════════════════
//  📌  SLASH COMMANDS  (screenshot red circle options)
// ════════════════════════════════════════════════════════════════
bot.onText(/\/next/,    msg => {
  const id = msg.from.id;
  if (user(id).step!=="done") { startOnboarding(id); return; }
  const p = endChat(id);
  if (p) send(p, "😔 Partner moved to next chat.\n\n_/next — find new partner_");
  findMatch(id, null);
});

bot.onText(/\/stop/,    msg => {
  const id = msg.from.id;
  dequeue(id);
  const p = endChat(id);
  if (p) {
    bot.sendMessage(id, "❌ Chat ended.\n\n_/next — find a new partner_",
      { parse_mode:"Markdown", reply_markup:mainKB(id) });
    bot.sendMessage(p, "😔 Your partner has left.\n\n_/next — find a new partner_",
      { parse_mode:"Markdown", reply_markup:mainKB(p) });
  } else {
    bot.sendMessage(id, "✅ Search cancelled.", { reply_markup:mainKB(id) });
  }
});

bot.onText(/\/balance/, msg => showBalance(msg.from.id));
bot.onText(/\/report/,  msg => doReport(msg.from.id));
bot.onText(/\/earn/,    msg => showRefer(msg.from.id));
bot.onText(/\/vip/,     msg => showVIP(msg.from.id));
bot.onText(/\/profile/, msg => showProfile(msg.from.id));
bot.onText(/\/rules/,   msg => showRules(msg.from.id));

// ════════════════════════════════════════════════════════════════
//  👮  ADMIN COMMANDS
// ════════════════════════════════════════════════════════════════
bot.onText(/\/admin (.+)/, (msg, m) => {
  if (msg.from.id!==CONFIG.ADMIN_ID) return;
  const args = m[1].split(" ");
  const cmd  = args[0];

  if (cmd==="stats") {
    const total  = Object.keys(DB.users).length;
    const pCount = Object.values(DB.users).filter(u=>isPrem(u.id)).length;
    send(CONFIG.ADMIN_ID,
      `📊 *Cryzen Stats*\n\n` +
      `👥 Total Users: ${total}\n` +
      `👑 Premium: ${pCount}\n` +
      `💬 Active Chats: ${Math.floor(Object.keys(DB.activeChats).length/2)}\n` +
      `🔍 Free Queue: ${DB.waitQueue.length}\n` +
      `⚡ VIP Queue: ${DB.premQueue.length}`
    );
  }
  else if (cmd==="ban" && args[1]) {
    const tid = parseInt(args[1]);
    user(tid).banned=true;
    endChat(tid); dequeue(tid);
    send(CONFIG.ADMIN_ID,`✅ Banned user ${args[1]}`);
    send(tid,"🚫 You have been banned from Cryzen.").catch(()=>{});
  }
  else if (cmd==="unban" && args[1]) {
    user(parseInt(args[1])).banned=false;
    send(CONFIG.ADMIN_ID,`✅ Unbanned user ${args[1]}`);
  }
  else if (cmd==="givevip" && args[1] && args[2]) {
    const tid=parseInt(args[1]), h=parseInt(args[2]);
    grantPrem(tid,h);
    send(CONFIG.ADMIN_ID,`✅ Gave ${h}h VIP to ${args[1]}`);
    send(tid,`🎁 You received *${h} hours* of free VIP from Admin! 👑`).catch(()=>{});
  }
  else if (cmd==="broadcast" && args.length>1) {
    const txt = args.slice(1).join(" ");
    Object.keys(DB.users).forEach(id => {
      bot.sendMessage(parseInt(id),`📢 *Announcement*\n\n${txt}`,{parse_mode:"Markdown"}).catch(()=>{});
    });
    send(CONFIG.ADMIN_ID,"✅ Broadcast sent to all users.");
  }
  else {
    send(CONFIG.ADMIN_ID,
      `*Admin Commands:*\n\n` +
      `/admin stats\n` +
      `/admin ban USER\\_ID\n` +
      `/admin unban USER\\_ID\n` +
      `/admin givevip USER\\_ID HOURS\n` +
      `/admin broadcast MESSAGE`
    );
  }
});

// ════════════════════════════════════════════════════════════════
//  🔘  CALLBACK QUERIES (inline buttons)
// ════════════════════════════════════════════════════════════════
bot.on("callback_query", async query => {
  const id   = query.from.id;
  const data = query.data;
  const u    = user(id);
  bot.answerCallbackQuery(query.id).catch(()=>{});

  // ── gender selection (onboarding) ──
  if (data.startsWith("g_")) {
    if (u.step!=="gender") return;
    u.gender = data.slice(2);   // male / female / nonbinary / other
    u.step   = "country";
    send(id,`🌍 *Step 4 / 4* — Which country are you from?\n\n_(Type your country name)_`);
    return;
  }

  // ── profile edit ──
  const eds = { ed_name:"name", ed_age:"age", ed_country:"country" };
  if (eds[data]) {
    u.step = eds[data];
    const p = { name:"Enter your new name:", age:"Enter your new age:", country:"Enter your new country:" };
    send(id,`✏️ ${p[eds[data]]}`); return;
  }

  // ── VIP purchase ──
  if (data.startsWith("buy_")) {
    const plan  = data.slice(4);
    const days  = { "1d":1,"7d":7,"30d":30,"180d":180 }[plan];
    const stars = CONFIG.STARS[plan];
    try {
      await bot.sendInvoice(id,
        `Cryzen VIP — ${days} Day${days>1?"s":""}`,
        `Gender filter · Priority queue · Premium badge — ${days} day${days>1?"s":""}.`,
        `vip_${plan}_${id}`, "XTR",
        [{ label:`VIP ${days}d`, amount:stars }]
      );
    } catch(e) { send(id,`⚠️ Payment error: ${e.message}`); }
    return;
  }

  if (data==="show_refer") { showRefer(id); return; }
});

// ════════════════════════════════════════════════════════════════
//  💳  PAYMENTS
// ════════════════════════════════════════════════════════════════
bot.on("pre_checkout_query", q =>
  bot.answerPreCheckoutQuery(q.id,true).catch(()=>{})
);

bot.on("successful_payment", msg => {
  const id    = msg.from.id;
  const plan  = msg.successful_payment.invoice_payload.split("_")[1];
  const hours = { "1d":24,"7d":168,"30d":720,"180d":4320 }[plan]||24;
  grantPrem(id,hours);
  bot.sendMessage(id,
    `🎉 *Payment Successful!*\n\n` +
    `👑 VIP is now *ACTIVE!*\n` +
    `⏱ Expires in: *${timeLeft(id)}*\n\n` +
    `Enjoy gender filter, priority matching & your premium badge! 🚀`,
    { parse_mode:"Markdown", reply_markup:mainKB(id) }
  );
  bot.sendMessage(CONFIG.ADMIN_ID,`💰 New purchase! User: ${id} | Plan: ${plan} | ${hours}h`);
});

// ════════════════════════════════════════════════════════════════
//  💬  MESSAGE HANDLER  (relay + menu buttons)
// ════════════════════════════════════════════════════════════════
bot.on("message", msg => {
  const id   = msg.from.id;
  const u    = user(id);
  const text = msg.text || "";

  // ignore banned & commands
  if (u.banned) return;
  if (text.startsWith("/")) return;

  // ── onboarding ──
  if (u.step && u.step!=="done") {
    handleOnboard(id, text); return;
  }

  // ── reply keyboard buttons ──
  if (text==="🎲 Find a partner")                        { findMatch(id,null);    return; }
  if (text==="💃 Find a Girl" || text==="🔒 Find a Girl") {
    if (!isPrem(id)) { showVIP(id); return; }
    findMatch(id,"female"); return;
  }
  if (text==="🕺 Find a Guy"  || text==="🔒 Find a Guy")  {
    if (!isPrem(id)) { showVIP(id); return; }
    findMatch(id,"male"); return;
  }
  if (text==="🛠 Profile")     { showProfile(id); return; }
  if (text==="🏆 VIP access")  { showVIP(id);     return; }
  if (text==="👫 Friends")     { showRefer(id);    return; }

  // ── active chat relay ──
  const pid = DB.activeChats[id];
  if (pid) {
    const fwd = p => p.catch(()=>{});
    if      (msg.photo)      fwd(bot.sendPhoto(pid,     msg.photo[msg.photo.length-1].file_id, { caption:msg.caption||"" }));
    else if (msg.sticker)    fwd(bot.sendSticker(pid,   msg.sticker.file_id));
    else if (msg.voice)      fwd(bot.sendVoice(pid,     msg.voice.file_id));
    else if (msg.video)      fwd(bot.sendVideo(pid,     msg.video.file_id, { caption:msg.caption||"" }));
    else if (msg.video_note) fwd(bot.sendVideoNote(pid, msg.video_note.file_id));
    else if (msg.document)   fwd(bot.sendDocument(pid,  msg.document.file_id, { caption:msg.caption||"" }));
    else if (msg.animation)  fwd(bot.sendAnimation(pid, msg.animation.file_id));
    else if (msg.audio)      fwd(bot.sendAudio(pid,     msg.audio.file_id));
    else if (text)           fwd(bot.sendMessage(pid,   text));
    return;
  }

  // ── not in chat ──
  bot.sendMessage(id,
    "💬 You're not in a chat.\nUse buttons below to find a partner! 👇",
    { reply_markup:mainKB(id) }
  );
});

// ════════════════════════════════════════════════════════════════
//  🛡️  ERROR HANDLING  (keeps bot alive 24/7)
// ════════════════════════════════════════════════════════════════
bot.on("polling_error", err =>
  console.error(`[${new Date().toISOString()}] Polling:`, err.message)
);
process.on("uncaughtException",  err =>
  console.error(`[${new Date().toISOString()}] Exception:`, err.message)
);
process.on("unhandledRejection", r =>
  console.error(`[${new Date().toISOString()}] Rejection:`, r)
);

// ════════════════════════════════════════════════════════════════
//  🚀  BOOT
// ════════════════════════════════════════════════════════════════
console.log("╔══════════════════════════════════╗");
console.log("║   CRYZEN DATING BOT  v3.0        ║");
console.log("║   Status: LIVE  🟢               ║");
console.log("╚══════════════════════════════════╝");
setCommands();
