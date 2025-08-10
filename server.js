import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Email configuration (optional)
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: !!Number(process.env.SMTP_SECURE || 0),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// Order Handling
app.post('/api/order', async (req, res) => {
  const { name, phone, email, payMethod, txid, items, subtotal, fees, total } = req.body;
  if (!txid && (payMethod === 'bkash' || payMethod === 'nagad')) {
    return res.status(400).json({ error: 'TxID_REQUIRED' });
  }

  // Send receipt email
  if (transporter) {
    const toList = [email, 'nishadjr875@gmail.com']; // তোমার ইমেইল কপি/পেস্ট করো
    await transporter.sendMail({
      from: process.env.MAIL_FROM || `"SubFusion" <${process.env.SMTP_USER}>`,
      to: toList.join(','),
      subject: `New Order ${Date.now()}`,
      html: `
        <h3>অর্ডার সিকিউরড হয়েছে</h3>
        <p>নাম: ${name}, মোবাইল: ${phone}, পেমেন্ট মেথড: ${payMethod}, TxID: ${txid}</p>
        <p>সামগ্রিক মূল্য: ${total}</p>
      `
    });
  }

  res.json({ ok: true, message: 'Order placed successfully' });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on port ${process.env.PORT || 3000}`);
});
