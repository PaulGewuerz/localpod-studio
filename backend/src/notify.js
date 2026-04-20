const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendSMS(body) {
  await client.messages.create({
    body,
    from: process.env.TWILIO_FROM,
    to: process.env.ALERT_PHONE,
  });
}

module.exports = { sendSMS };
