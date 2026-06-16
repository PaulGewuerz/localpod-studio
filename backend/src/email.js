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
        <p style="color:#555;margin-bottom:16px">
          <strong>${showName}</strong> is now active on LocalPod Studio.
          You can start generating and publishing podcast episodes right away.
        </p>
        <p style="color:#555;margin-bottom:24px">
          Your podcast will appear on Apple Podcasts, Spotify, and all major apps within 72 hours.
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

async function sendTrialEndingEmail({ to, showName, plan, amount, interval, chargeDate }) {
  const planName = plan === 'solo' ? 'LocalPod Solo' : 'LocalPod Publisher';
  const dateStr = chargeDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const amountStr = amount != null
    ? `$${amount % 1 === 0 ? amount : amount.toFixed(2)}`
    : null;
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Your LocalPod free trial ends on ${dateStr}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:22px;font-weight:600;margin-bottom:8px">Your free trial is ending soon.</h1>
        <p style="color:#555;margin-bottom:16px">
          The free trial for <strong>${showName}</strong> ends on <strong>${dateStr}</strong>.
          ${amountStr
            ? `On that date, the card on file will be charged <strong>${amountStr}</strong> for the ${planName} plan, and then every ${interval} after that.`
            : `On that date, your ${planName} subscription will begin.`}
        </p>
        <p style="color:#555;margin-bottom:24px">
          Want to make changes or cancel before then? Open Billing in your studio —
          or just reply to this email and we'll take care of it.
        </p>
        <a href="${STUDIO_URL}/studio?nav=billing"
           style="display:inline-block;background:#2563eb;color:#fff;font-weight:600;
                  padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px">
          Manage Billing →
        </a>
        <p style="color:#999;font-size:12px;margin-top:40px">
          LocalPod Studio · If you have questions, reply to this email.
        </p>
      </div>
    `,
  });
}

async function sendCancellationEmail({ to, showName, accessEndsDate }) {
  const dateStr = accessEndsDate
    ? accessEndsDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Your LocalPod subscription has been canceled`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:22px;font-weight:600;margin-bottom:8px">Your cancellation is confirmed.</h1>
        <p style="color:#555;margin-bottom:16px">
          We've canceled the subscription for <strong>${showName}</strong>.
          ${dateStr
            ? `You'll keep full access until <strong>${dateStr}</strong>, and you won't be charged again.`
            : `You won't be charged again.`}
        </p>
        <p style="color:#555;margin-bottom:24px">
          Changed your mind? You can resubscribe anytime from the billing page —
          or just reply to this email and we'll help.
        </p>
        <a href="${STUDIO_URL}/studio?nav=billing"
           style="display:inline-block;background:#2563eb;color:#fff;font-weight:600;
                  padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px">
          Manage Billing →
        </a>
        <p style="color:#999;font-size:12px;margin-top:40px">
          LocalPod Studio · If you have questions, reply to this email.
        </p>
      </div>
    `,
  });
}

async function sendCancellationAdminEmail({ orgName, showName, userEmail, accessEndsDate }) {
  const adminEmail = process.env.ADMIN_EMAIL || 'paul@localpod.co';
  const dateStr = accessEndsDate
    ? accessEndsDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'period end';
  await resend.emails.send({
    from: FROM,
    to: adminEmail,
    subject: `Subscription canceled — ${showName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:18px;font-weight:600;margin-bottom:8px">Subscription canceled</h1>
        <p style="color:#555;margin-bottom:8px"><strong>Org:</strong> ${orgName}</p>
        <p style="color:#555;margin-bottom:8px"><strong>Show:</strong> ${showName}</p>
        <p style="color:#555;margin-bottom:8px"><strong>Customer:</strong> ${userEmail}</p>
        <p style="color:#555;margin-bottom:24px"><strong>Access ends:</strong> ${dateStr}</p>
        <p style="color:#999;font-size:12px;margin-top:40px">LocalPod Studio</p>
      </div>
    `,
  });
}

async function sendAnalyticsReportRequest({ orgName, showName, userEmail }) {
  const adminEmail = process.env.ADMIN_EMAIL || 'paul@localpod.co';
  await resend.emails.send({
    from: FROM,
    to: adminEmail,
    subject: `Analytics report requested — ${showName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:18px;font-weight:600;margin-bottom:8px">Analytics report request</h1>
        <p style="color:#555;margin-bottom:8px"><strong>Org:</strong> ${orgName}</p>
        <p style="color:#555;margin-bottom:8px"><strong>Show:</strong> ${showName}</p>
        <p style="color:#555;margin-bottom:24px"><strong>Requested by:</strong> ${userEmail}</p>
        <p style="color:#999;font-size:12px;margin-top:40px">LocalPod Studio</p>
      </div>
    `,
  });
}

async function sendDistributionRequestAdmin({ orgName, showName, rssUrl, userEmail }) {
  const adminEmail = process.env.ADMIN_EMAIL || 'paul@localpod.co';
  await resend.emails.send({
    from: FROM,
    to: adminEmail,
    subject: `Directory submission requested — ${showName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:18px;font-weight:600;margin-bottom:8px">Directory submission request</h1>
        <p style="color:#555;margin-bottom:8px"><strong>Org:</strong> ${orgName}</p>
        <p style="color:#555;margin-bottom:8px"><strong>Show:</strong> ${showName}</p>
        <p style="color:#555;margin-bottom:8px"><strong>RSS:</strong> ${rssUrl}</p>
        <p style="color:#555;margin-bottom:24px"><strong>Requested by:</strong> ${userEmail}</p>
        <p style="color:#999;font-size:12px;margin-top:40px">LocalPod Studio</p>
      </div>
    `,
  });
}

async function sendDistributionRequestConfirmation({ to, showName }) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: `We're handling your directory submissions for ${showName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:22px;font-weight:600;margin-bottom:8px">We're on it.</h1>
        <p style="color:#555;margin-bottom:16px">
          We've received your request to submit <strong>${showName}</strong> to Apple Podcasts,
          Spotify, Amazon Music, and other major directories.
        </p>
        <p style="color:#555;margin-bottom:24px">
          Approvals are usually quick but can take up to 5 business days depending on the platform.
          We'll email you once everything is live.
        </p>
        <p style="color:#999;font-size:12px;margin-top:40px">
          LocalPod Studio · If you have questions, reply to this email.
        </p>
      </div>
    `,
  });
}

// Adds (or upserts) a contact into the Resend audience used for marketing/
// re-engagement email. Safe no-op if RESEND_AUDIENCE_ID isn't configured.
async function addContactToAudience({ email, firstName, lastName }) {
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!audienceId) {
    console.warn('RESEND_AUDIENCE_ID not set — skipping audience add for', email);
    return;
  }
  await resend.contacts.create({
    audienceId,
    email,
    unsubscribed: false,
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
  });
}

module.exports = { sendWelcomeEmail, sendTrialEndingEmail, sendCancellationEmail, sendCancellationAdminEmail, sendAnalyticsReportRequest, sendDistributionRequestConfirmation, sendDistributionRequestAdmin, addContactToAudience };
