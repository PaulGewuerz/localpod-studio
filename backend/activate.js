require('dotenv').config();
const prisma = require('./src/prisma');
prisma.subscription.updateMany({
  data: { status: 'active', stripeCustomerId: 'bypass_dev' }
}).then(() => { console.log('done'); prisma.$disconnect(); });
