import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true })); // SSL success POST পড়ে
app.use(express.static('.')); // serve index/product

/* ---------- Mailer (optional) ---------- */
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: !!Number(process.env.SMTP_SECURE || 0),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

/* ---------- Helpers ---------- */
const b64 = {
  enc: (obj)=> Buffer.from(JSON.stringify(obj)).toString('base64'),
  dec: (s)=> { try{ return JSON.parse(Buffer.from(s,'base64').toString('utf8')); }catch{ return null; } }
};
const fmtBDT = n => `৳${Number(n).toLocaleString('en-IN')}`;

function renderReceiptHTML(order){
  const rows = order.items.map(i=>{
    const meta = i.meta && Object.keys(i.meta).length
      ? `<div style="color:#94a3b8;font-size:12px;margin-top:2px">${Object.entries(i.meta).map(([k,v])=>`${k}: ${String(v)}`).join(' • ')}</div>`
      : '';
    return `<tr><td style="padding:10px 12px;border-bottom:1px solid #0f172a24">
        <div style="font-weight:700">${i.pid} — ${i.plan} × ${i.qty}</div>${meta}
      </td><td style="padding:10px 12px;border-bottom:1px solid #0f172a24;text-align:right;font-weight:800">
        ${fmtBDT(i.price*i.qty)}</td></tr>`;
  }).join('');
  return `
  <div style="background:#0b1220;padding:24px;color:#e2e8f0;font-family:Inter,Segoe UI,Arial,sans-serif">
    <table width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#0f172a;border:1px solid #1e293b;border-radius:16px">
      <tr><td style="padding:20px 24px;border-bottom:1px solid #1e293b">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;background:linear-gradient(135deg,#00a3ff,#12c2e9);border-radius:10px"></div>
          <div><div style="font-weight:900;font-size:18px">SubFusion — Payment Receipt</div>
            <div style="color:#94a3b8;font-size:12px">Order <b>${order.id}</b> • ${new Date().toLocaleString()}</div></div>
        </div></td></tr>
      <tr><td style="padding:0 24px">
        <table width="100%" style="border-collapse:collapse;margin:14px 0">${rows}</table>
        <div style="margin:8px 0 0;color:#94a3b8;font-size:13px">Subtotal: <b>${fmtBDT(order.subtotal)}</b> • Fees: <b>${fmtBDT(order.fees)}</b></div>
        <div style="margin:6px 0 12px;font-size:20px;font-weight:900">Total: ${fmtBDT(order.total)}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px;background:#0b1220;border:1px solid #1e293b;border-radius:12px;padding:12px">
            <div style="color:#94a3b8;font-size:12px">Customer</div>
            <div style="font-weight:700">${order.customer?.name||'-'}</div>
            <div style="color:#94a3b8;font-size:12px">${order.customer?.phone||''}${order.customer?.email?' • '+order.customer.email:''}</div>
          </div>
          <div style="flex:1;min-width:220px;background:#0b1220;border:1px solid #1e293b;border-radius:12px;padding:12px">
            <div style="color:#94a3b8;font-size:12px">Payment</div>
            <div style="font-weight:700">Online Card (SSLCommerz)</div>
            <div style="color:#94a3b8;font-size:12px">Transaction ID: ${order.tran_id||'-'}</div>
          </div>
        </div>
        <div style="margin-top:12px;color:#64748b;font-size:12px">Need help? Reply to this email with your Order ID.</div>
      </td></tr>
      <tr><td style="border-top:1px solid #1e293b;padding:10px 24px;color:#475569;font-size:12px;text-align:center">© SubFusion • Bangladesh</td></tr>
    </table>
  </div>`;
}

/* ---------- Create SSL session ---------- */
app.post('/api/payment/create', async (req, res) => {
  const { items = [], customer = {} } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error:'EMPTY_CART' });

  const subtotal = items.reduce((s,i)=> s + i.price * i.qty, 0);
  const fees = Math.round(subtotal * 0.02);
  const total = subtotal + fees;
  const tran_id = 'SF' + Date.now();

  if (!process.env.SSL_STORE_ID || !process.env.SSL_STORE_PASSWD) {
    // demo when no creds
    return res.json({ demo:true, demoUrl:'https://sandbox.sslcommerz.com/EasyCheckOut/test' });
  }

  const base = (process.env.BASE_URL || '').replace(/\/+$/,'') || 'http://localhost:5173';
  const payload = {
    store_id: process.env.SSL_STORE_ID,
    store_passwd: process.env.SSL_STORE_PASSWD,
    total_amount: Math.max(10, Math.round(total)), // নিরাপদে রাউন্ড
    currency: 'BDT',
    tran_id,
    success_url: `${base}/api/payment/success`,
    fail_url: `${base}/api/payment/fail`,
    cancel_url: `${base}/api/payment/cancel`,
    ipn_url: `${base}/api/payment/ipn`,
    product_category: 'digital',
    product_profile: 'non-physical-goods',
    product_name: 'SubFusion Cart Items',
    cus_name: customer.name || 'Customer',
    cus_email: customer.email || 'customer@example.com',
    cus_add1: 'BD', cus_city: 'Dhaka', cus_country: 'Bangladesh',
    shipping_method: 'NO', num_of_item: items.length,

    // Custom fields (later we will read these on success)
    value_a: b64.enc({ tran_id, items, customer, subtotal, fees, total })
  };

  try{
    const r = await fetch('https://securepay.sslcommerz.com/gwprocess/v4/api.php', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const data = await r.json();
    res.json(data);
  }catch(e){ console.error('SSL session error:', e); res.status(500).json({ error:'SSL_SESSION_FAILED' }); }
});

/* ---------- SSL success → validate, email, thank-you ---------- */
async function handleSuccess(req, res){
  try{
    const { status, val_id, value_a } = (req.method === 'POST') ? req.body : req.query;

    if (status !== 'VALID' && status !== 'VALIDATED') {
      return res.status(400).send('Payment not valid.');
    }
    // Validate with validator API
    const vUrl = `https://securepay.sslcommerz.com/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(val_id)}&store_id=${encodeURIComponent(process.env.SSL_STORE_ID)}&store_passwd=${encodeURIComponent(process.env.SSL_STORE_PASSWD)}&v=1&format=json`;
    const vr = await fetch(vUrl); const vdata = await vr.json();
    if (!vdata || (vdata.status !== 'VALID' && vdata.status !== 'VALIDATED')) {
      return res.status(400).send('Validation failed.');
    }

    const payload = b64.dec(value_a || '');
    if (!payload) return res.status(400).send('Missing payload.');
    const order = { ...payload, tran_id: vdata.tran_id || payload.tran_id };

    // send receipt email
    if (transporter) {
      const toList = [process.env.RECEIVER_EMAIL || 'nishadjr875@gmail.com'];
      if (order.customer?.email) toList.push(order.customer.email);
      await transporter.sendMail({
        from: process.env.MAIL_FROM || `"SubFusion" <${process.env.SMTP_USER}>`,
        to: toList.join(','),
        subject: `Payment Success • ${order.tran_id} • ${fmtBDT(order.total)}`,
        html: renderReceiptHTML(order)
      });
    }

    // Success page (clears localStorage cart on client)
    res.set('Content-Type','text/html').send(`
      <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Payment Success — SubFusion</title>
      <link href="https://cdn.jsdelivr.net/npm/remixicon@4.3.0/fonts/remixicon.css" rel="stylesheet">
      <style>body{background:#0b1220;color:#e2e8f0;font-family:Inter,Segoe UI,Arial,sans-serif;display:grid;place-items:center;height:100vh}
      .card{background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:24px;max-width:560px}
      .btn{display:inline-flex;gap:.5rem;align-items:center;background:linear-gradient(90deg,#00a3ff,#12c2e9);color:#fff;padding:.6rem 1rem;border-radius:12px;font-weight:800;text-decoration:none}
      </style></head>
      <body>
        <div class="card">
          <h1 style="margin:0 0 6px;font-size:28px">Payment Successful</h1>
          <div style="color:#94a3b8">Transaction: <b>${order.tran_id}</b></div>
          <div style="margin:12px 0 16px;font-size:18px;font-weight:900">Total Paid: ${fmtBDT(order.total)}</div>
          <p>We emailed your receipt. Need help? Reply to the email with your Order ID.</p>
          <a class="btn" href="/"><i class="ri-store-2-line"></i> Back to Store</a>
        </div>
        <script>try{localStorage.setItem('sf_cart','[]')}catch{}</script>
      </body></html>
    `);
  }catch(e){
    console.error('SUCCESS handler error:', e);
    res.status(500).send('Server error.');
  }
}
app.post('/api/payment/success', handleSuccess);
app.get('/api/payment/success', handleSuccess);

/* ---------- Fail/Cancel/IPN ---------- */
app.all('/api/payment/fail', (req,res)=> res.status(400).send('Payment failed.'));
app.all('/api/payment/cancel', (req,res)=> res.status(400).send('Payment cancelled.'));
app.post('/api/payment/ipn', (req,res)=> { console.log('IPN:', req.body); res.json({ ok:true }); });

/* ---------- Start ---------- */
const PORT = process.env.PORT || 5173;
app.listen(PORT, ()=> console.log(`SubFusion server running on http://localhost:${PORT}`));
