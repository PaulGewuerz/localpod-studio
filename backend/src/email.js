const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'LocalPod Studio <hello@localpod.co>';
const STUDIO_URL = process.env.FRONTEND_URL || 'https://app.localpod.co';

async function sendWelcomeEmail({ to, showName }) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Welcome to LocalPod — ${showName} is live`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:22px;font-weight:600;margin-bottom:8px">You're all set.</h1>
        <p style="color:#555;margin-bottom:24px">
          <strong>${showName}</strong> is now active on LocalPod Studio.
          You can start generating and publishing podcast episodes right away.
        </p>
        <a href="${STUDIO_URL}/studio"
           style="display:inline-block;background:#2563eb;color:#fff;font-weight:600;
                  padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px">
          Open Studio →
        </a>
        <p style="color:#999;font-size:12px;margin-top:40px">
          LocalPod Studio · If you have questions, reply to this email.
        </p>
      </div>
    `,
  });
}

module.exports = { sendWelcomeEmail };
