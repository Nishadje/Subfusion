import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // serve index.html + product.html

/* ---------- Email Transport ---------- */
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: !!Number(process.env.SMTP_SECURE || 0),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

/* ---------- VIP Email Template ---------- */
function renderReceiptHTML(order){
  const rows = order.items.map(i=>{
    const meta = i.meta && Object.keys(i.meta).length
      ? `<div style="color:#94a3b8;font-size:12px;margin-top:2px">
           ${Object.entries(i.meta).map(([k,v])=>`${k}: ${String(v)}`).join(' • ')}
         </div>` : '';
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #0f172a24">
          <div style="font-weight:700">${i.pid} — ${i.plan} × ${i.qty}</div>
          ${meta}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #0f172a24;text-align:right;font-weight:800">
          ৳${(i.price*i.qty).toLocaleString('en-IN')}
        </td>
      </tr>`;
  }).join('');

  return `
  <div style="background:#0b1220;padding:24px;color:#e2e8f0;font-family:Inter,Segoe UI,Arial,sans-serif">
    <table width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#0f172a;border:1px solid #1e293b;border-radius:16px">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #1e293b">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;background:linear-gradient(135deg,#00a3ff,#12c2e9);border-radius:10px"></div>
            <div>
              <div style="font-weight:900;font-size:18px;letter-spacing:.2px">SubFusion — VIP Receipt</div>
              <div style="color:#94a3b8;font-size:12px">Order <b>${order.id}</b> • ${new Date(order.createdAt).toLocaleString()}</div>
            </div>
          </div>
        </td>
      </tr>
      <tr><td style="padding:0 24px">
        <table width="100%" style="border-collapse:collapse;margin:14px 0">${rows}</table>
        <div style="margin:8px 0 0;color:#94a3b8;font-size:13px">
          Subtotal: <b>${order.subtotal}</b> • Fees: <b>${order.fees}</b>
        </div>
        <div style="margin:6px 0 12px;font-size:20px;font-weight:900">Total: ${order.total}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px;background:#0b1220;border:1px solid #1e293b;border-radius:12px;padding:12px">
            <div style="color:#94a3b8;font-size:12px">Customer</div>
            <div style="font-weight:700">${order.name}</div>
            <div style="color:#94a3b8;font-size:12px">${order.phone}${order.email?' • '+order.email:''}</div>
          </div>
          <div style="flex:1;min-width:220px;background:#0b1220;border:1px solid #1e293b;border-radius:12px;padding:12px">
            <div style="color:#94a3b8;font-size:12px">Payment</div>
            <div style="font-weight:700;text-transform:uppercase">${order.pay}</div>
            <div style="color:#94a3b8;font-size:12px">TxID: ${order.txid || '-'}</div>
          </div>
        </div>
        <div style="margin-top:12px;color:#64748b;font-size:12px">
          Need help? Reply to this email with your Order ID.
        </div>
      </td></tr>
      <tr><td style="border-top:1px solid #1e293b;padding:10px 24px;color:#475569;font-size:12px;text-align:center">
        © SubFusion • Bangladesh
      </td></tr>
    </table>
  </div>`;
}

/* ---------- API: Order + Email ---------- */
app.post('/api/order', async (req, res) => {
  try{
    const order = req.body;
    if (transporter) {
      const toList = [order.ownerEmail].concat(order.email ? [order.email] : []);
      await transporter.sendMail({
        from: process.env.MAIL_FROM || `"SubFusion" <${process.env.SMTP_USER}>`,
        to: toList.join(','),
        subject: `New Order ${order.id} • ${order.total}`,
        html: renderReceiptHTML(order)
      });
      return res.json({ ok:true, emailed:true });
    } else {
      console.log('Email not configured. Order:', order.id);
      return res.json({ ok:true, emailed:false });
    }
  }catch(e){
    console.error('Order error:', e);
    res.status(500).json({ ok:false, error:'ORDER_FAILED' });
  }
});

/* ---------- API: SSLCOMMERZ Hosted Checkout ---------- */
app.post('/api/payment/create', async (req, res) => {
  const items = req.body.items || [];
  const amount = items.reduce((s,i)=> s + i.price * i.qty, 0) * 1.02;
  const tran_id = 'SF' + Date.now();

  if (!process.env.SSL_STORE_ID || !process.env.SSL_STORE_PASSWD) {
    return res.json({ demo:true, demoUrl:'https://sandbox.sslcommerz.com/EasyCheckOut/test' });
  }

  const payload = {
    store_id: process.env.SSL_STORE_ID,
    store_passwd: process.env.SSL_STORE_PASSWD,
    total_amount: Math.round(amount),
    currency: 'BDT',
    tran_id,
    success_url: process.env.BASE_URL + '/api/payment/success',
    fail_url: process.env.BASE_URL + '/api/payment/fail',
    cancel_url: process.env.BASE_URL + '/api/payment/cancel',
    ipn_url: process.env.BASE_URL + '/api/payment/ipn',
    product_category: 'digital',
    product_profile: 'non-physical-goods',
    product_name: 'SubFusion Cart Items',
    cus_name: 'Customer',
    cus_email: 'customer@example.com',
    cus_add1: 'BD', cus_city: 'Dhaka', cus_country: 'Bangladesh',
    shipping_method: 'NO', num_of_item: items.length
  };

  try{
    const r = await fetch('https://securepay.sslcommerz.com/gwprocess/v4/api.php', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const data = await r.json(); res.json(data);
  }catch(e){ console.error('SSL session error:', e); res.status(500).json({ error:'SSL_SESSION_FAILED' }); }
});

/* ---------- Optional IPN ---------- */
app.post('/api/payment/ipn', (req, res) => { console.log('IPN:', req.body); res.json({ ok:true }); });
app.get('/api/payment/success', (req,res)=>res.send('Payment Success — complete order in DB here.'));
app.get('/api/payment/fail', (req,res)=>res.send('Payment Failed'));
app.get('/api/payment/cancel', (req,res)=>res.send('Payment Cancelled'));

const PORT = process.env.PORT || 5173;
app.listen(PORT, ()=> console.log(`SubFusion server running on http://localhost:${PORT}`));
