const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const { URL } = require('url');

const execAsync = promisify(exec);

const authPath = path.join(__dirname, 'auth');
if (!fs.existsSync(authPath)) {
  fs.mkdirSync(authPath, { recursive: true });
}

// إنشاء مجلد للتحميلات المؤقتة
const downloadsPath = path.join(__dirname, 'temp_downloads');
if (!fs.existsSync(downloadsPath)) {
  fs.mkdirSync(downloadsPath, { recursive: true });
}

// Logger محسن
const customLogger = {
  level: 'warn',
  info: (message, ...args) => console.log('ℹ️', typeof message === 'string' ? message : message?.toString() || ''),
  warn: (message, ...args) => console.log('⚠️', typeof message === 'string' ? message : message?.toString() || ''),
  error: (message, ...args) => console.log('❌', typeof message === 'string' ? message : message?.toString() || ''),
  debug: () => {},
  trace: () => {},
  child: () => customLogger
};

// بيانات المستخدمين
const userSessions = new Map();
const commandsExecuted = new Map();

class UserSession {
  constructor(jid) {
    this.jid = jid;
    this.lastActive = Date.now();
    this.messageCount = 0;
    this.downloading = false;
  }
}

// نظام مكافحة التكرار
function canExecuteCommand(jid, command, cooldown = 2000) {
  const key = `${jid}_${command}`;
  const now = Date.now();
  const lastTime = commandsExecuted.get(key) || 0;
  
  if (now - lastTime < cooldown) {
    return false;
  }
  
  commandsExecuted.set(key, now);
  return true;
}

// دالة لاستخراج الروابط من النص
function extractLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
}

// دالة للتحقق من أن الرابط مدعوم
function isSupportedSocialMedia(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // قائمة المواقع المدعومة
    const supportedDomains = [
      'instagram.com', 'instagr.am',
      'twitter.com', 'x.com',
      'facebook.com', 'fb.watch',
      'tiktok.com',
      'youtube.com', 'youtu.be'
    ];
    
    return supportedDomains.some(domain => hostname.includes(domain));
  } catch (error) {
    return false;
  }
}

// دالة خاصة للتحقق من Instagram
function isInstagram(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase().includes('instagram.com') || 
           urlObj.hostname.toLowerCase().includes('instagr.am');
  } catch (error) {
    return false;
  }
}

// استخراج معرف من رابط Instagram
function extractInstagramId(url) {
  try {
    // أنماط مختلفة لروابط Instagram
    const patterns = [
      /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/,
      /instagr\.am\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// دالة لاستخدام Instagram API
async function downloadInstagramWithAPI(url, outputDir, senderName) {
  try {
    const postId = extractInstagramId(url);
    if (!postId) {
      throw new Error('لا يمكن استخراج معرف المنشور');
    }
    
    console.log(`🔍 معرف Instagram: ${postId}`);
    
    // استخدام خدمة API مجانية (مثال: savefrom.net API)
    const apiUrl = `https://api.savefrom.net/v1/source/instagram`;
    
    const response = await axios.post(apiUrl, {
      url: url
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    if (response.data && response.data.data) {
      const mediaItems = response.data.data;
      const downloadedFiles = [];
      
      for (let i = 0; i < Math.min(mediaItems.length, 10); i++) { // حد أقصى 10 ملفات
        const item = mediaItems[i];
        const mediaUrl = item.url;
        
        if (mediaUrl) {
          try {
            const mediaResponse = await axios({
              url: mediaUrl,
              method: 'GET',
              responseType: 'arraybuffer',
              timeout: 60000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            
            const contentType = mediaResponse.headers['content-type'];
            const isVideo = contentType.includes('video') || mediaUrl.includes('.mp4') || mediaUrl.includes('.mov');
            const isImage = contentType.includes('image');
            
            const timestamp = Date.now();
            const index = i + 1;
            let filename, filepath;
            
            if (isVideo) {
              filename = `instagram_video_${senderName}_${timestamp}_${index}.mp4`;
            } else if (isImage) {
              filename = `instagram_image_${senderName}_${timestamp}_${index}.jpg`;
            } else {
              filename = `instagram_media_${senderName}_${timestamp}_${index}.bin`;
            }
            
            filepath = path.join(outputDir, filename);
            fs.writeFileSync(filepath, mediaResponse.data);
            
            downloadedFiles.push({
              path: filepath,
              isVideo: isVideo,
              isImage: isImage,
              filename: filename,
              index: index
            });
            
            console.log(`✅ تم تحميل: ${filename} (${isVideo ? 'فيديو' : 'صورة'})`);
            
          } catch (mediaError) {
            console.error(`❌ خطأ في تحميل الوسائط ${i + 1}:`, mediaError.message);
          }
        }
      }
      
      return downloadedFiles.map(item => item.path);
    }
    
    throw new Error('لم يتم العثور على وسائط في الاستجابة');
    
  } catch (error) {
    console.error('❌ خطأ في Instagram API:', error.message);
    
    // محاولة استخدام خدمة بديلة
    return await downloadInstagramAlternative(url, outputDir, senderName);
  }
}

// طريقة بديلة لتحميل Instagram
async function downloadInstagramAlternative(url, outputDir, senderName) {
  try {
    console.log('🔄 استخدام خدمة بديلة لـ Instagram');
    
    // استخدام خدمة أخرى مثل: snappea
    const snappeaUrl = `https://snappea.com/v1/instagram`;
    
    const response = await axios.post(snappeaUrl, {
      url: url,
      format: 'json'
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 30000
    });
    
    if (response.data && response.data.media) {
      const mediaUrls = Array.isArray(response.data.media) ? 
                       response.data.media : [response.data.media];
      
      const downloadedFiles = [];
      
      for (let i = 0; i < Math.min(mediaUrls.length, 10); i++) {
        const mediaUrl = mediaUrls[i];
        
        try {
          const mediaResponse = await axios({
            url: mediaUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: 60000
          });
          
          const timestamp = Date.now();
          const filename = `instagram_${senderName}_${timestamp}_${i + 1}.${mediaUrl.includes('.mp4') ? 'mp4' : 'jpg'}`;
          const filepath = path.join(outputDir, filename);
          
          fs.writeFileSync(filepath, mediaResponse.data);
          downloadedFiles.push(filepath);
          
        } catch (mediaError) {
          console.error(`❌ خطأ في تحميل الوسيط ${i + 1}:`, mediaError.message);
        }
      }
      
      if (downloadedFiles.length > 0) {
        return downloadedFiles;
      }
    }
    
    throw new Error('فشل في تحميل Instagram بالطريقة البديلة');
    
  } catch (error) {
    console.error('❌ خطأ في الطريقة البديلة:', error.message);
    
    // آخر محاولة: استخدام yt-dlp مع إعدادات خاصة
    return await downloadInstagramWithYtdlp(url, outputDir, senderName);
  }
}

// استخدام yt-dlp مع إعدادات خاصة لـ Instagram
async function downloadInstagramWithYtdlp(url, outputDir, senderName) {
  try {
    console.log('🔧 استخدام yt-dlp لـ Instagram');
    
    const timestamp = Date.now();
    const outputTemplate = path.join(outputDir, `ig_${senderName}_${timestamp}_%(title)s.%(ext)s`);
    
    // أمر yt-dlp مع خيارات متقدمة لـ Instagram
    const command = `yt-dlp --no-check-certificate --ignore-errors --no-playlist --format "best[height<=1080]" --merge-output-format mp4 --output "${outputTemplate}" "${url}"`;
    
    const { stdout, stderr } = await execAsync(command, { timeout: 300000 });
    
    const files = fs.readdirSync(outputDir);
    const downloadedFiles = files.filter(file => file.includes(`ig_${senderName}_${timestamp}`));
    
    if (downloadedFiles.length > 0) {
      return downloadedFiles.map(file => path.join(outputDir, file));
    }
    
    throw new Error('فشل yt-dlp في تحميل Instagram');
  } catch (error) {
    console.error('❌ خطأ في yt-dlp:', error.message);
    throw error;
  }
}

// دالة للتحميل المباشر (لغير Instagram)
async function downloadDirectMedia(url, outputDir) {
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const contentType = response.headers['content-type'];
    const timestamp = Date.now();
    let extension = 'bin';
    
    if (contentType.includes('video')) extension = 'mp4';
    else if (contentType.includes('image/jpeg')) extension = 'jpg';
    else if (contentType.includes('image/png')) extension = 'png';
    else if (contentType.includes('image/gif')) extension = 'gif';
    else if (contentType.includes('image/webp')) extension = 'webp';
    
    const filename = `direct_${timestamp}.${extension}`;
    const filepath = path.join(outputDir, filename);
    
    fs.writeFileSync(filepath, response.data);
    return [filepath];
  } catch (error) {
    console.error('❌ خطأ في التحميل المباشر:', error.message);
    throw error;
  }
}

// دالة رئيسية للتحميل
async function downloadContent(url, outputDir, senderName) {
  try {
    // إذا كان رابط Instagram، استخدم API
    if (isInstagram(url)) {
      return await downloadInstagramWithAPI(url, outputDir, senderName);
    }
    
    // لبقية المواقع، استخدم yt-dlp
    const timestamp = Date.now();
    const outputTemplate = path.join(outputDir, `dl_${senderName}_${timestamp}_%(title)s.%(ext)s`);
    
    const command = `yt-dlp --no-check-certificate --ignore-errors --no-playlist --format "best[height<=720]" --output "${outputTemplate}" "${url}"`;
    
    console.log(`📥 جاري تحميل: ${url}`);
    const { stdout, stderr } = await execAsync(command, { timeout: 300000 });
    
    const files = fs.readdirSync(outputDir);
    const downloadedFiles = files.filter(file => file.includes(`dl_${senderName}_${timestamp}`));
    
    if (downloadedFiles.length > 0) {
      return downloadedFiles.map(file => path.join(outputDir, file));
    }
    
    throw new Error('لم يتم العثور على ملفات بعد التحميل');
  } catch (error) {
    console.error('❌ خطأ في التحميل:', error.message);
    
    // محاولة تحميل مباشر
    return await downloadDirectMedia(url, outputDir);
  }
}

// دالة للتعامل مع إرسال الملفات
async function handleLinkDownload(sock, from, url, senderName) {
  const session = userSessions.get(from);
  if (session?.downloading) {
    await sock.sendMessage(from, { 
      text: '⏳ لديك عملية تحميل قيد التنفيذ، يرجى الانتظار...' 
    });
    return;
  }
  
  session.downloading = true;
  const userDir = path.join(downloadsPath, from.split('@')[0]);
  
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  try {
    // إرسال رسالة بدء التحميل
    const loadingMsg = await sock.sendMessage(from, { 
      text: `📥 جاري تحميل المحتوى...\n🔗 ${url}\n⏳ قد يستغرق ذلك دقيقة واحدة`
    });
    
    let downloadedFiles = await downloadContent(url, userDir, senderName);
    
    if (downloadedFiles.length === 0) {
      throw new Error('لم يتم تحميل أي ملفات');
    }
    
    // إرسال الملفات
    let successCount = 0;
    let imageCount = 0;
    let videoCount = 0;
    
    // إرسال كل ملف على حدة
    for (let i = 0; i < downloadedFiles.length; i++) {
      const filepath = downloadedFiles[i];
      try {
        const filename = path.basename(filepath);
        const ext = path.extname(filename).toLowerCase();
        
        // تحديد نوع الملف
        const isVideo = ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext);
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
        
        if (isVideo) {
          // إرسال فيديو
          await sock.sendMessage(from, {
            video: fs.readFileSync(filepath),
            caption: `🎬 ${senderName}\nالملف ${i + 1}/${downloadedFiles.length}\nتم التحميل من: ${url}`
          });
          videoCount++;
          successCount++;
        } else if (isImage) {
          // إرسال صورة
          await sock.sendMessage(from, {
            image: fs.readFileSync(filepath),
            caption: `🖼️ ${senderName}\nالصورة ${i + 1}/${downloadedFiles.length}\nتم التحميل من: ${url}`
          });
          imageCount++;
          successCount++;
        }
        
        // حذف الملف بعد الإرسال الناجح
        fs.unlinkSync(filepath);
        console.log(`✅ تم إرسال وحذف: ${filename}`);
        
        // تأخير بين الإرسالات
        if (downloadedFiles.length > 1 && i < downloadedFiles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (sendError) {
        console.error('❌ خطأ في إرسال الملف:', sendError.message);
      }
    }
    
    // حذف رسالة التحميل
    if (loadingMsg && loadingMsg.key) {
      try {
        await sock.sendMessage(from, { delete: loadingMsg.key });
      } catch (e) {}
    }
    
    // إرسال تقرير النجاح
    let report = `✅ **اكتمل التحميل!**\n\n`;
    if (downloadedFiles.length > 1) {
      report += `📦 **عدد الملفات**: ${successCount}\n`;
    }
    if (imageCount > 0) {
      report += `🖼️ **الصور**: ${imageCount}\n`;
    }
    if (videoCount > 0) {
      report += `🎬 **الفيديوهات**: ${videoCount}\n`;
    }
    report += `🧹 تم تنظيف الملفات تلقائياً.`;
    
    await sock.sendMessage(from, { text: report });
    
  } catch (error) {
    console.error('❌ خطأ في تحميل الرابط:', error.message);
    
    let errorMessage = '❌ **فشل في تحميل المحتوى**\n\n';
    
    if (isInstagram(url)) {
      errorMessage += '**مشكلة Instagram**:\n';
      errorMessage += '• قد يكون المحتوى محذوفاً أو خاصاً\n';
      errorMessage += '• جرب رابطاً مختلفاً\n';
      errorMessage += '• Instagram يحمي محتواه بشكل صارم\n\n';
      errorMessage += '💡 **الحلول المقترحة**:\n';
      errorMessage += '1. تأكد أن الرابط عام وليس خاصاً\n';
      errorMessage += '2. جرب تحميل الصور يدوياً\n';
      errorMessage += '3. استخدم مواقع بديلة مثل Twitter/X';
    } else {
      errorMessage += '**الأسباب المحتملة**:\n';
      errorMessage += '• الرابط غير مدعوم\n';
      errorMessage += '• المحتوى محذوف\n';
      errorMessage += '• مشكلة في الخادم\n';
      errorMessage += '• الحساب خاص';
    }
    
    await sock.sendMessage(from, { text: errorMessage });
  } finally {
    session.downloading = false;
    
    // تنظيف المجلد الفارغ
    try {
      const files = fs.readdirSync(userDir);
      if (files.length === 0) {
        fs.rmdirSync(userDir);
      }
    } catch (cleanError) {
      // تجاهل أخطاء التنظيف
    }
  }
}

// دالة لاختبار روابط Instagram
async function testInstagramLinks() {
  const testLinks = [
    'https://www.instagram.com/p/C8QZQYvJz7A/', // صورة واحدة
    'https://www.instagram.com/p/C8QZQYvJz7A/?img_index=1', // كاروسيل
    'https://www.instagram.com/reel/C8QZQYvJz7A/' // فيديو
  ];
  
  console.log('🧪 **اختبار روابط Instagram**:');
  for (const link of testLinks) {
    const postId = extractInstagramId(link);
    console.log(`   ${link} -> ${postId || 'غير معروف'}`);
  }
}

// الأوامر
const commands = {
  'اوامر': {
    description: 'عرض جميع الأوامر',
    handler: async () => {
      return `📋 **أوامر البوت**:\n\n` +
             `🔗 **تحميل الروابط**:\n` +
             `• أرسل رابط Instagram/Twitter/Facebook/TikTok\n` +
             `• يدعم الصور المتعددة (كاروسيل)\n` +
             `• يدعم الفيديوهات\n` +
             `• الملفات تحذف بعد الإرسال\n\n` +
             `⚙️ **الأوامر الأخرى**:\n` +
             `• .test - اختبار روابط Instagram\n` +
             `• .stats - إحصائيات\n` +
             `• .ping - فحص الاستجابة`;
    }
  },
  
  'test': {
    description: 'اختبار روابط Instagram',
    handler: async () => {
      await testInstagramLinks();
      return '✅ تم اختبار روابط Instagram، انظر الـ console';
    }
  },
  
  'ping': {
    description: 'فحص استجابة البوت',
    handler: async () => {
      return `🏓 Pong!\n🕐 ${new Date().toLocaleString('ar-SA')}`;
    }
  }
};

const startBot = async () => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: customLogger,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      retryRequestDelayMs: 1000,
      connectTimeoutMs: 60000
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log('\n📱 **مسح رمز QR للاتصال**:');
        qrcode.generate(qr, { small: true });
      }
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log(`🔄 جاري إعادة الاتصال...`);
        
        if (shouldReconnect) {
          setTimeout(() => startBot(), 5000);
        }
      } 
      else if (connection === 'open') {
        console.log('✅ **بوت التحميل الذكي جاهز!**');
        console.log(`🤖 الإصدار: v4.0 - Instagram Fix`);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      try {
        const message = messages[0];
        if (!message?.message || message.key.fromMe) return;

        const from = message.key.remoteJid;
        const senderName = message.pushName || 'مستخدم';
        
        // تحديث جلسة المستخدم
        let session = userSessions.get(from);
        if (!session) {
          session = new UserSession(from);
          userSessions.set(from, session);
        }
        session.lastActive = Date.now();
        session.messageCount++;

        // استخراج النص
        let text = '';
        if (message.message.conversation) {
          text = message.message.conversation;
        } else if (message.message.extendedTextMessage?.text) {
          text = message.message.extendedTextMessage.text;
        }

        const originalText = text.trim();
        
        console.log(`📨 ${senderName}: ${originalText.substring(0, 100)}`);

        // اكتشاف الروابط
        const links = extractLinks(originalText);
        if (links.length > 0) {
          const supportedLink = links.find(link => isSupportedSocialMedia(link));
          
          if (supportedLink) {
            if (session.downloading) {
              await sock.sendMessage(from, { 
                text: '⏳ لديك عملية تحميل قيد التنفيذ...' 
              });
              return;
            }
            
            // إرسال رسالة تأكيد
            await sock.sendMessage(from, { 
              text: `🔍 **تم اكتشاف رابط**:\n${supportedLink}\n\n📥 جاري بدء التحميل...`
            });
            
            await handleLinkDownload(sock, from, supportedLink, senderName);
            return;
          } else {
            await sock.sendMessage(from, { 
              text: '❌ **هذا الرابط غير مدعوم**\n\nالمدعوم: Instagram, Twitter/X, Facebook, TikTok'
            });
            return;
          }
        }

        // معالجة الأوامر
        if (originalText.startsWith('.')) {
          const [command, ...args] = originalText.substring(1).split(' ');
          const cmdKey = command.toLowerCase();
          
          if (commands[cmdKey]) {
            if (!canExecuteCommand(from, cmdKey, 1000)) return;
            
            try {
              const response = await commands[cmdKey].handler(sock, from, args);
              await sock.sendMessage(from, { text: response });
            } catch (error) {
              console.error('خطأ في الأمر:', error);
            }
          }
          return;
        }

      } catch (error) {
        console.error('❌ خطأ في معالجة الرسالة:', error.message);
      }
    });

    // تنظيف دوري للملفات القديمة
    setInterval(() => {
      const now = Date.now();
      try {
        if (fs.existsSync(downloadsPath)) {
          fs.readdirSync(downloadsPath).forEach(folder => {
            const folderPath = path.join(downloadsPath, folder);
            if (fs.statSync(folderPath).isDirectory()) {
              const files = fs.readdirSync(folderPath);
              if (files.length === 0 && now - fs.statSync(folderPath).mtimeMs > 3600000) {
                fs.rmdirSync(folderPath);
              }
            }
          });
        }
      } catch (error) {
        // تجاهل أخطاء التنظيف
      }
    }, 1800000);

    sock.ev.on('creds.update', saveCreds);

  } catch (error) {
    console.error('❌ خطأ فادح:', error.message);
    setTimeout(() => startBot(), 10000);
  }
};

console.log('🚀 **جاري تشغيل بوت التحميل الذكي...**');
console.log('='.repeat(60));
console.log('🔧 **الإصلاحات الجديدة**:');
console.log('• حل مشكلة Instagram API');
console.log('• دعم الصور المتعددة (الكاروسيل)');
console.log('• فصل الصور عن الفيديوهات');
console.log('• إصلاح مشكلة تحويل الفيديو إلى صورة');
console.log('• استخدام واجهات برمجة متعددة');
console.log('• تحسين رسائل الخطأ');
console.log('='.repeat(60));

console.log('💡 **ملاحظات مهمة**:');
console.log('1. Instagram قد يكون صعباً بسبب الحماية');
console.log('2. الروابط العامة تعمل أفضل من الخاصة');
console.log('3. بعض المحتوى قد يحتاج إلى انتظار');
console.log('4. اختبر الرابط أولاً: .test');

// اختبار yt-dlp
exec('yt-dlp --version', (error, stdout) => {
  if (error) {
    console.log('⚠️  yt-dlp غير مثبت. بعض المواقع قد لا تعمل.');
  } else {
    console.log(`✅ yt-dlp ${stdout.trim()} مثبت`);
  }
});

startBot();

process.on('SIGINT', () => {
  console.log('\n👋 **إيقاف البوت...**');
  
  // تنظيف الملفات المؤقتة
  try {
    if (fs.existsSync(downloadsPath)) {
      fs.rmSync(downloadsPath, { recursive: true, force: true });
      console.log('🧹 تم تنظيف الملفات المؤقتة');
    }
  } catch (error) {
    console.log('⚠️  خطأ في التنظيف');
  }
  
  process.exit(0);
});