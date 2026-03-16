require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/generate', require('./routes/generate'));

app.use('/auth', require('./routes/auth'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`LocalPod backend running on http://localhost:${PORT}`);
});