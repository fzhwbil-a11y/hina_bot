const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(__dirname));

app.get('/image', (req, res) => {
  res.sendFile(path.join(__dirname, 'generated-icon.png'));
});

app.get('/card', (req, res) => {
  const domain = `https://${req.get('host')}`;
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ليلى</title>
      <style>
        body { margin: 0; padding: 20px; background: #f0f0f0; font-family: Arial, sans-serif; }
        .card { 
          max-width: 400px; 
          margin: 0 auto; 
          background: white; 
          border-radius: 15px; 
          overflow: hidden; 
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .card img { width: 100%; height: auto; display: block; }
        .card-content { padding: 20px; text-align: center; }
        .card-content h2 { margin: 10px 0; color: #333; }
        .card-content p { color: #666; margin: 10px 0; }
        .emoji { font-size: 30px; }
      </style>
    </head>
    <body>
      <div class="card">
        <img src="${domain}/image" alt="ليلى">
        <div class="card-content">
          <h2>مرحبا ليلى</h2>
          <p>تحت الخدمة شو بدك؟</p>
          <p class="emoji">💞🙂</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 خادم الويب يعمل على: http://localhost:${PORT}`);
});
