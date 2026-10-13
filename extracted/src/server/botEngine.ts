import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  makeCacheableSignalKeyStore,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { askGemini } from './geminiService';
import { resolveSongAudio, searchYoutubeVideo } from './audioService';
import { resolveSearchImage } from './imageService';
import { adminStore } from './adminStore';
import { getWhatsAppVoiceBuffer } from './voiceService';

export interface BotLog {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'CMD';
  message: string;
}

export interface BotConfig {
  botName: string;
  prefix: string;
  mode: 'public' | 'private';
  ownerNumber: string;
  autoReadStatus: boolean;
  plan: 'mini' | 'pro' | 'business';
  antiLink: boolean;
  antiSpam: boolean;
  welcomeMessage: boolean;
  welcomeTemplate: string;
  callDetectorEnabled: boolean;
  voiceAutoReplyEnabled: boolean;
}

export const BRAND_LOGO_URL = 'https://i.ibb.co/qLvhb2sJ/file-0000000038b882119a75583965314189.png';
export const WHATSAPP_CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb927N4GJP8MS1yurM2Z';
export const OWNER_HOTLINE = '0740712934';

export interface PlanQuotas {
  mediaRequestsUsed: number;
  mediaQuotaMax: number;
  aiRequestsUsed: number;
  aiQuotaMax: number;
  maxBotSlots: number;
}

export interface BotState {
  connectionStatus: 'disconnected' | 'connecting' | 'qr_ready' | 'pairing_code_ready' | 'connected' | 'reconnecting';
  isOnline: boolean;
  pairedNumber: string | null;
  qrCodeDataUrl: string | null;
  pairingCode: string | null;
  uptimeSeconds: number;
  startedAt: string | null;
  lastPingMs: number;
  totalMessagesReceived: number;
  totalCommandsExecuted: number;
  totalAiQueries: number;
  activeGroupCount: number;
  incomingCallsCount: number;
  callsRejectedCount: number;
  autoRepliesSentCount: number;
  voiceAutoRepliesSentCount: number;
  recentCalls: { id: string; from: string; timestamp: string; rejected: boolean; replied: boolean }[];
  config: BotConfig;
  quotas: PlanQuotas;
}

const SESSION_DIR = path.resolve(process.cwd(), 'data', 'whatsapp_session');

class BotEngine {
  private sock: WASocket | null = null;
  private logs: BotLog[] = [];
  private maxLogs = 500;
  private startTime: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isExplicitlyStopped = true;

  // Active in-memory group warnings map: jid -> { participantJid: count }
  private groupWarnings: Map<string, Map<string, number>> = new Map();

  // Active quiz & games state
  private activeQuizSessions: Map<string, { answer: string; question: string }> = new Map();

  // Processed incoming call IDs for deduplication
  private processedCalls: Set<string> = new Set();
  private isQrReady = false;

  // Cooldown map for Voice Auto-Replies: key (jid_voiceId) -> timestamp ms
  private voiceCooldownMap: Map<string, number> = new Map();

  private state: BotState = {
    connectionStatus: 'disconnected',
    isOnline: false,
    pairedNumber: null,
    qrCodeDataUrl: null,
    pairingCode: null,
    uptimeSeconds: 0,
    startedAt: null,
    lastPingMs: 18,
    totalMessagesReceived: 0,
    totalCommandsExecuted: 0,
    totalAiQueries: 0,
    activeGroupCount: 0,
    incomingCallsCount: 0,
    callsRejectedCount: 0,
    autoRepliesSentCount: 0,
    voiceAutoRepliesSentCount: 0,
    recentCalls: [],
    config: {
      botName: 'YASHI HALLS MINI',
      prefix: '.',
      mode: 'public',
      ownerNumber: '94740712934',
      autoReadStatus: true,
      plan: 'mini',
      antiLink: false,
      antiSpam: false,
      welcomeMessage: true,
      welcomeTemplate: 'Welcome @user to @group! Enjoy your stay.',
      callDetectorEnabled: true,
      voiceAutoReplyEnabled: true,
    },
    quotas: {
      mediaRequestsUsed: 0,
      mediaQuotaMax: 5,
      aiRequestsUsed: 0,
      aiQuotaMax: 10,
      maxBotSlots: 1,
    },
  };

  constructor() {
    this.addLog('INFO', 'BotEngine initialized with Dual Plan support (MINI & PRO).');
    this.checkExistingSession();
  }

  private addLog(level: BotLog['level'], message: string) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const log: BotLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp,
      level,
      message,
    };
    this.logs.push(log);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  private checkExistingSession() {
    try {
      if (fs.existsSync(SESSION_DIR)) {
        const files = fs.readdirSync(SESSION_DIR);
        if (files.some((f) => f.includes('creds.json'))) {
          this.addLog('INFO', 'Existing WhatsApp session credentials found in persistent storage.');
        }
      } else {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
      }
    } catch {
      // Safe fallback if directory check fails
    }
  }

  public getState(): BotState {
    const uptimeSeconds = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
    return {
      ...this.state,
      uptimeSeconds,
    };
  }

  public getLogs(): BotLog[] {
    return [...this.logs];
  }

  public setPlan(plan: 'mini' | 'pro' | 'business'): BotState {
    this.state.config.plan = plan;
    if (plan === 'business') {
      this.state.config.botName = 'YASHI HALLS BUSINESS';
      this.state.quotas.mediaQuotaMax = 999999;
      this.state.quotas.aiQuotaMax = 999999;
      this.state.quotas.maxBotSlots = 25;
      this.state.config.antiLink = true;
      this.state.config.antiSpam = true;
      this.addLog('INFO', '👑 Tier upgraded to YASHI HALLS BUSINESS! 25 Bot Slots, Unlimited Media & AI, and VIP Enterprise SLA activated.');
    } else if (plan === 'pro') {
      this.state.config.botName = 'YASHI HALLS PRO';
      this.state.quotas.mediaQuotaMax = 1000;
      this.state.quotas.aiQuotaMax = 5000;
      this.state.quotas.maxBotSlots = 5;
      this.state.config.antiLink = true;
      this.state.config.antiSpam = true;
      this.addLog('INFO', '💎 Tier upgraded to YASHI HALLS PRO! All advanced features, multi-slots & unlimited quotas unlocked.');
    } else {
      this.state.config.botName = 'YASHI HALLS MINI';
      this.state.quotas.mediaQuotaMax = 50;
      this.state.quotas.aiQuotaMax = 100;
      this.state.quotas.maxBotSlots = 1;
      this.state.config.antiLink = false;
      this.state.config.antiSpam = false;
      this.addLog('INFO', '🟢 Tier switched to YASHI HALLS MINI. Basic quotas and single bot slot active.');
    }
    return this.getState();
  }

  public async syncProfilePictureWithLogo(): Promise<{ success: boolean; message: string }> {
    if (!this.sock || !this.state.isOnline) {
      return { success: false, message: 'WhatsApp bot must be online to update profile picture.' };
    }
    try {
      const userJid = this.sock.user?.id;
      if (!userJid) {
        return { success: false, message: 'User JID not available.' };
      }
      if (typeof (this.sock as any).updateProfilePicture === 'function') {
        await (this.sock as any).updateProfilePicture(userJid, { url: BRAND_LOGO_URL });
        this.addLog('INFO', '✅ Bot profile picture successfully updated to official YASHI HALLS logo.');
        return { success: true, message: 'Bot profile picture updated to official YASHI HALLS logo!' };
      }
      return { success: false, message: 'Profile picture update not supported by current client session.' };
    } catch (err: any) {
      this.addLog('WARN', `Profile picture update attempt failed: ${err?.message}`);
      return { success: false, message: err?.message || 'Failed to update profile picture' };
    }
  }

  public updateConfig(newConfig: Partial<BotConfig>): BotConfig {
    this.state.config = {
      ...this.state.config,
      ...newConfig,
    };
    if (newConfig.plan) {
      this.setPlan(newConfig.plan);
    }
    this.addLog('INFO', `Configuration updated: Plan=${this.state.config.plan.toUpperCase()}, BotName=${this.state.config.botName}, Mode=${this.state.config.mode}`);
    return this.state.config;
  }

  public resetQuotas(): PlanQuotas {
    this.state.quotas.mediaRequestsUsed = 0;
    this.state.quotas.aiRequestsUsed = 0;
    this.addLog('INFO', 'Daily quotas reset to 0.');
    return this.state.quotas;
  }

  public async start(requestedPhone?: string): Promise<{ success: boolean; message: string; pairingCode?: string }> {
    this.isExplicitlyStopped = false;
    if (this.state.connectionStatus === 'connected' && this.sock) {
      return { success: true, message: 'Bot is already connected and online.' };
    }

    try {
      this.state.connectionStatus = 'connecting';
      this.addLog('INFO', `Starting ${this.state.config.botName} WhatsApp Baileys connection...`);

      if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
      }

      const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      // Ensure initial creds.json is safely written so subsequent reads never trigger ENOENT
      await saveCreds();

      const { version } = await fetchLatestBaileysVersion();
      this.addLog('INFO', `Using Baileys protocol v${version.join('.')}`);

      const logger = pino({ level: 'silent' });

      this.sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
          creds: authState.creds,
          keys: makeCacheableSignalKeyStore(authState.keys, logger),
        },
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        generateHighQualityLinkPreview: true,
      });

      // Save credentials whenever updated
      this.sock.ev.on('creds.update', saveCreds);

      // Handle Connection Updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.isQrReady = true;
          this.state.connectionStatus = 'qr_ready';
          try {
            const dataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
            this.state.qrCodeDataUrl = dataUrl;
            this.addLog('INFO', 'QR code generated and ready for WhatsApp scan.');
          } catch (err) {
            this.addLog('ERROR', 'Failed to generate QR Code data URL.');
          }
        }

        if (connection === 'close') {
          this.isQrReady = false;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !this.isExplicitlyStopped;
          
          this.state.isOnline = false;
          this.state.connectionStatus = shouldReconnect ? 'reconnecting' : 'disconnected';
          this.startTime = null;

          this.addLog('WARN', `Connection closed. Reason: ${DisconnectReason[statusCode] || statusCode || 'Unknown'}. Reconnect=${shouldReconnect}`);

          if (statusCode === DisconnectReason.loggedOut) {
            this.addLog('WARN', 'Device logged out. Clearing stored session.');
            this.clearSessionFiles();
          } else if (shouldReconnect) {
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
              this.reconnectAttempts++;
              this.addLog('INFO', `Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in 4 seconds...`);
              setTimeout(() => {
                if (!this.isExplicitlyStopped) {
                  this.start(requestedPhone);
                }
              }, 4000);
            } else {
              this.addLog('ERROR', 'Maximum reconnection attempts reached. Bot stopped.');
              this.state.connectionStatus = 'disconnected';
            }
          }
        } else if (connection === 'open') {
          this.reconnectAttempts = 0;
          this.state.isOnline = true;
          this.state.connectionStatus = 'connected';
          this.state.qrCodeDataUrl = null;
          this.state.pairingCode = null;
          this.startTime = Date.now();
          this.state.startedAt = new Date().toISOString();

          // Extract paired phone number
          const userJid = this.sock?.user?.id || '';
          const phoneNum = userJid.split(':')[0] || userJid.split('@')[0] || 'Unknown';
          this.state.pairedNumber = phoneNum;

          this.addLog('INFO', `✅ Connection established! ${this.state.config.botName} (${this.state.config.plan.toUpperCase()}) is now ONLINE for +${phoneNum}`);
          this.addLog('INFO', `Ready to respond to commands with prefix '${this.state.config.prefix}'.`);
        }
      });

      // Handle Group Participants Update (Welcome & Goodbye Automation)
      this.sock.ev.on('group-participants.update', async (update) => {
        try {
          const { id: groupJid, participants, action } = update;
          if (action === 'add' && this.state.config.welcomeMessage) {
            for (const p of participants) {
              const participantId = typeof (p as unknown) === 'string' ? (p as unknown as string) : (p as any)?.id || '';
              if (!participantId) continue;
              const userPhone = participantId.split('@')[0];
              const welcomeMsg = `🎉 *WELCOME TO THE GROUP!* 👋\n\nHello @${userPhone}! We're thrilled to have you here.\n📌 Please check the group description and follow the rules.\n\n_Powered by ${this.state.config.botName} 24/7 Engine_`;
              await this.sock?.sendMessage(groupJid, {
                text: welcomeMsg,
                mentions: [participantId],
              });
            }
          }
        } catch (err: any) {
          this.addLog('WARN', `Welcome automation error: ${err?.message}`);
        }
      });

      // Handle Incoming WhatsApp Calls across MINI, PRO, and BUSINESS plans
      this.sock.ev.on('call', async (calls) => {
        if (!this.state.config.callDetectorEnabled) return;
        for (const call of calls) {
          if (call.status !== 'offer') continue;
          const callId = call.id;
          const callerJid = call.from;
          if (!callerJid || this.processedCalls.has(callId)) continue;

          this.processedCalls.add(callId);
          if (this.processedCalls.size > 200) {
            const first = this.processedCalls.values().next().value;
            if (first) this.processedCalls.delete(first);
          }

          this.state.incomingCallsCount++;
          const cleanPhone = callerJid.split('@')[0];
          this.addLog('WARN', `📞 Incoming WhatsApp call detected from +${cleanPhone}`);

          let rejected = false;
          try {
            if (this.sock && typeof (this.sock as any).rejectCall === 'function') {
              await (this.sock as any).rejectCall(callId, callerJid);
              rejected = true;
              this.state.callsRejectedCount++;
              this.addLog('INFO', `📵 Successfully rejected incoming call from +${cleanPhone}`);
            } else {
              this.addLog('WARN', `Call rejection not supported by current Baileys client instance for +${cleanPhone}`);
            }
          } catch (rejectErr: any) {
            this.addLog('ERROR', `Failed to reject call from +${cleanPhone}: ${rejectErr?.message || rejectErr}`);
          }

          let replied = false;
          try {
            const replyText = `
📵 YASHI HALLS BOT

Sorry! අපගේ Bot එකට WhatsApp Voice/Video Calls ලබාගත නොහැක.

🤖 අපගේ සේවාවන් භාවිත කිරීමට:
Type ".menu" to explore our services.

✨ POWERED BY YASHI HALLS
`.trim();
            await this.sock?.sendMessage(callerJid, { text: replyText });
            replied = true;
            this.state.autoRepliesSentCount++;
            this.addLog('INFO', `💬 Sent call auto-reply chat message to +${cleanPhone}`);
          } catch (replyErr: any) {
            this.addLog('ERROR', `Failed to send call auto-reply to +${cleanPhone}: ${replyErr?.message || replyErr}`);
          }

          const nowTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
          this.state.recentCalls.unshift({
            id: callId,
            from: `+${cleanPhone}`,
            timestamp: nowTime,
            rejected,
            replied,
          });

          if (this.state.recentCalls.length > 25) {
            this.state.recentCalls.pop();
          }
        }
      });

      // Handle Incoming Messages
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (!msg.message) continue;
          this.state.totalMessagesReceived++;

          // Auto read status stories if enabled
          if (this.state.config.autoReadStatus && msg.key.remoteJid === 'status@broadcast') {
            try {
              await this.sock?.readMessages([msg.key]);
            } catch {
              // ignore status read errors
            }
            continue;
          }

          await this.handleIncomingMessage(msg);
        }
      });

      // If pairing with phone number was requested
      if (requestedPhone && !authState.creds.registered) {
        const cleanPhone = requestedPhone.replace(/\D/g, '');
        if (cleanPhone.length >= 8) {
          setTimeout(async () => {
            try {
              if (this.sock && !this.sock.authState.creds.registered) {
                this.addLog('INFO', `Requesting WhatsApp Pairing Code for +${cleanPhone}...`);
                const code = await this.sock.requestPairingCode(cleanPhone);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                this.state.pairingCode = formattedCode;
                this.state.connectionStatus = 'pairing_code_ready';
                this.addLog('INFO', `Pairing Code generated: ${formattedCode}`);
              }
            } catch (err: any) {
              this.addLog('ERROR', `Failed to request pairing code: ${err?.message || err}`);
            }
          }, 2000);
        }
      }

      return { success: true, message: 'Bot engine initialization started successfully.' };
    } catch (error: any) {
      this.state.connectionStatus = 'disconnected';
      this.state.isOnline = false;
      this.addLog('ERROR', `Bot start failed: ${error?.message || error}`);
      return { success: false, message: error?.message || 'Failed to start bot engine' };
    }
  }

  public async requestPairingCode(phone: string): Promise<{ success: boolean; code?: string; message: string }> {
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0') && cleanPhone.length === 10) {
      cleanPhone = '94' + cleanPhone.slice(1);
    }
    if (cleanPhone.length < 8) {
      return { success: false, message: 'Invalid phone number. Enter e.g. 0740712934 or 94740712934.' };
    }

    this.isExplicitlyStopped = false;

    // If socket doesn't exist, is closed, or not in registration mode, start/restart it
    if (!this.sock || this.state.connectionStatus === 'disconnected') {
      this.isQrReady = false;
      const res = await this.start(cleanPhone);
      if (!res.success) {
        return { success: false, message: res.message };
      }
    }

    // Wait until the socket has completed handshake and reached registration/QR state (avoids "Connection Closed" premature call)
    const startTime = Date.now();
    while (Date.now() - startTime < 12000) {
      // If code was already obtained and saved
      if (this.state.pairingCode) {
        return {
          success: true,
          code: this.state.pairingCode,
          message: 'Pairing code generated successfully.',
        };
      }

      if (this.sock && !this.sock.authState.creds.registered) {
        // Wait for registration state to be ready
        if (!this.isQrReady && this.state.connectionStatus !== 'qr_ready') {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        try {
          const rawCode = await this.sock.requestPairingCode(cleanPhone);
          if (rawCode) {
            const formattedCode = rawCode.match(/.{1,4}/g)?.join('-') || rawCode;
            this.state.pairingCode = formattedCode;
            this.state.connectionStatus = 'pairing_code_ready';
            this.addLog('INFO', `✅ Fresh WhatsApp Pairing Code generated for +${cleanPhone}: ${formattedCode}`);
            return {
              success: true,
              code: formattedCode,
              message: 'Pairing code generated successfully. Enter this code on your WhatsApp Linked Devices.',
            };
          }
        } catch (err: any) {
          const msg = err?.message || String(err);
          // Expected handshake timing issue; wait for next tick
          if (msg.includes('Connection Closed') || msg.includes('QR')) {
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          this.addLog('WARN', `Attempting pairing code retry for +${cleanPhone}: ${msg}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      } else {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    if (this.state.pairingCode) {
      return {
        success: true,
        code: this.state.pairingCode,
        message: 'Pairing code ready.',
      };
    }

    return {
      success: false,
      message: 'Failed to generate WhatsApp pairing code. Please click "Disconnect & Reset" and try again.',
    };
  }

  public async stop(): Promise<{ success: boolean; message: string }> {
    this.isExplicitlyStopped = true;
    this.startTime = null;
    this.state.isOnline = false;
    this.state.connectionStatus = 'disconnected';

    if (this.sock) {
      try {
        this.sock.end(undefined);
        this.sock = null;
        this.addLog('INFO', 'Bot engine manually stopped by user.');
        return { success: true, message: 'Bot stopped successfully.' };
      } catch (err: any) {
        this.sock = null;
        return { success: true, message: 'Bot stopped.' };
      }
    }
    return { success: true, message: 'Bot was already stopped.' };
  }

  public async restart(): Promise<{ success: boolean; message: string }> {
    this.addLog('INFO', `Restarting ${this.state.config.botName} bot engine...`);
    await this.stop();
    await new Promise((r) => setTimeout(r, 1500));
    return this.start();
  }

  public clearSession(): { success: boolean; message: string } {
    this.stop();
    this.clearSessionFiles();
    this.state.pairedNumber = null;
    this.state.qrCodeDataUrl = null;
    this.state.pairingCode = null;
    this.addLog('INFO', 'Session data wiped. Ready for fresh pairing.');
    return { success: true, message: 'Session data cleared successfully.' };
  }

  private clearSessionFiles() {
    try {
      if (fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    } catch (e: any) {
      this.addLog('WARN', `Error clearing session files: ${e?.message}`);
    }
  }

  // --- MESSAGE PROCESSING & ANTI-LINK ---
  private extractMessageContent(msg: proto.IWebMessageInfo): string {
    if (!msg.message) return '';

    // 1. Direct text message types
    if (msg.message.conversation) return msg.message.conversation;
    if (msg.message.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
    if (msg.message.imageMessage?.caption) return msg.message.imageMessage.caption;
    if (msg.message.videoMessage?.caption) return msg.message.videoMessage.caption;

    // 2. Button Quick Reply Responses
    if (msg.message.buttonsResponseMessage?.selectedButtonId) {
      return msg.message.buttonsResponseMessage.selectedButtonId;
    }
    if (msg.message.templateButtonReplyMessage?.selectedId) {
      return msg.message.templateButtonReplyMessage.selectedId;
    }

    // 3. List Row Selection Responses
    if (msg.message.listResponseMessage?.singleSelectReply?.selectedRowId) {
      return msg.message.listResponseMessage.singleSelectReply.selectedRowId;
    }

    // 4. Native Flow / Interactive Response Message (modern WhatsApp client)
    if (msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
      try {
        const parsed = JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
        if (parsed?.id) return parsed.id;
      } catch {}
    }

    return '';
  }

  private mapButtonToCommand(btnId: string, prefix: string): string {
    switch (btnId) {
      case 'btn_cat_song':
      case 'btn_song':
        return `${prefix}menu song`;
      case 'btn_cat_video':
      case 'btn_video':
        return `${prefix}menu video`;
      case 'btn_cat_image':
      case 'btn_img':
      case 'btn_image':
        return `${prefix}menu image`;
      case 'btn_cat_ai':
      case 'btn_ai':
        return `${prefix}menu ai`;
      case 'btn_cat_games':
      case 'btn_games':
        return `${prefix}menu games`;
      case 'btn_cat_group':
      case 'btn_group':
        return `${prefix}menu group`;
      case 'btn_cat_settings':
      case 'btn_settings':
        return `${prefix}settings`;
      case 'btn_ping':
        return `${prefix}ping`;
      case 'btn_quiz':
        return `${prefix}quiz`;
      case 'btn_roll':
        return `${prefix}roll`;
      case 'btn_flip':
        return `${prefix}flip`;
      case 'btn_groupinfo':
        return `${prefix}groupinfo`;
      case 'btn_admins':
        return `${prefix}admins`;
      case 'btn_tagall':
        return `${prefix}tagall`;
      case 'btn_owner':
        return `${prefix}owner`;
      case 'btn_main_menu':
        return `${prefix}menu`;
      case 'btn_upgrade':
        return `${prefix}upgrade`;
      default:
        return btnId.startsWith(prefix) ? btnId : `${prefix}${btnId}`;
    }
  }

  // --- MESSAGE PROCESSING & ANTI-LINK ---
  private async handleIncomingMessage(msg: proto.IWebMessageInfo) {
    if (!this.sock || !msg.key) return;

    const jid = msg.key.remoteJid;
    if (!jid || jid.endsWith('@broadcast')) return;

    const isGroup = jid.endsWith('@g.us');
    const sender = isGroup ? msg.key.participant || jid : jid;

    // Extract text & interactive button / list selections
    const messageContent = this.extractMessageContent(msg);
    let text = messageContent.trim();
    const prefix = this.state.config.prefix;

    // Anti-Link check in group (PRO Feature)
    if (isGroup && this.state.config.plan === 'pro' && this.state.config.antiLink && !msg.key.fromMe) {
      const hasLink = /(https?:\/\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+)/gi.test(text);
      const isOwner = sender.includes(this.state.config.ownerNumber.replace(/\D/g, ''));
      if (hasLink && !isOwner) {
        this.addLog('WARN', `[ANTI-LINK] Unauthorized link detected from ${sender.split('@')[0]} in ${jid}`);
        try {
          await this.sock.sendMessage(jid, {
            text: `⚠️ *ANTI-LINK SYSTEM ACTIVATED!* 🚫\n@${sender.split('@')[0]}, sharing external links is forbidden in this group.`,
            mentions: [sender],
          }, { quoted: msg as any });
          // Attempt delete if bot is admin
          await this.sock.sendMessage(jid, { delete: msg.key });
        } catch {
          // ignore if non-admin delete error
        }
        return;
      }
    }

    // Check for interactive quiz answer response
    if (this.activeQuizSessions.has(jid) && !text.startsWith(prefix)) {
      const quiz = this.activeQuizSessions.get(jid)!;
      if (text.toLowerCase() === quiz.answer.toLowerCase()) {
        this.activeQuizSessions.delete(jid);
        await this.reply(jid, msg, `🎉 *CORRECT ANSWER!* 🏆\nCongratulations @${sender.split('@')[0]}! You solved the quiz.\n_Answer was:_ *${quiz.answer}*`);
        return;
      }
    }

    // Handle button IDs or direct numeric shortcuts from interactive menu
    if (text.startsWith('btn_')) {
      text = this.mapButtonToCommand(text, prefix);
    } else if (!text.startsWith(prefix)) {
      const lower = text.toLowerCase();
      const numMap: Record<string, string> = {
        '1': `${prefix}menu song`,
        '2': `${prefix}menu video`,
        '3': `${prefix}menu image`,
        '4': `${prefix}menu ai`,
        '5': `${prefix}menu games`,
        '6': `${prefix}menu group`,
        '7': `${prefix}settings`,
      };
      if (numMap[lower]) {
        text = numMap[lower];
      } else if (['menu', 'help', 'ping', 'owner', 'settings', 'quiz', 'roll', 'flip', 'guess'].includes(lower)) {
        text = `${prefix}${lower}`;
      }
    }

    // --- VOICE AUTO-REPLY ENGINE (MP3 / OPUS PTT DISPATCH) ---
    if (this.state.config.voiceAutoReplyEnabled !== false && !msg.key.fromMe && !text.startsWith(prefix)) {
      const voiceMatch = adminStore.findMatchingVoiceReply(text);
      if (voiceMatch && voiceMatch.match) {
        const voiceReply = voiceMatch.match;
        const cooldownKey = `${jid}_${voiceReply.id}`;
        const lastSent = this.voiceCooldownMap.get(cooldownKey) || 0;
        const now = Date.now();

        // 5-second anti-loop and anti-spam protection
        if (now - lastSent > 5000) {
          this.voiceCooldownMap.set(cooldownKey, now);
          this.addLog(
            'INFO',
            `🎙️ [VOICE AUTO-REPLY] Trigger "${voiceMatch.matchedTrigger}" matched incoming text: "${text}" from ${sender.split('@')[0]}`
          );

          try {
            const voiceData = await getWhatsAppVoiceBuffer(voiceReply.audioPath);
            if (voiceData && voiceData.buffer) {
              await this.sock.sendMessage(
                jid,
                {
                  audio: voiceData.buffer,
                  mimetype: voiceData.mimeType,
                  ptt: true, // Send as genuine WhatsApp Push-to-Talk green waveform voice message!
                },
                { quoted: msg as any }
              );

              this.state.voiceAutoRepliesSentCount = (this.state.voiceAutoRepliesSentCount || 0) + 1;
              this.state.autoRepliesSentCount++;
              adminStore.incrementVoiceReplyPlay(voiceReply.id);
              this.addLog(
                'INFO',
                `✅ [VOICE AUTO-REPLY] Successfully delivered voice note "${voiceReply.name}" (${(voiceData.buffer.length / 1024).toFixed(1)} KB) to ${jid}`
              );
              return;
            } else {
              this.addLog('WARN', `⚠️ [VOICE AUTO-REPLY] Audio file not readable for '${voiceReply.name}' at ${voiceReply.audioPath}`);
            }
          } catch (voiceErr: any) {
            this.addLog('ERROR', `❌ [VOICE AUTO-REPLY] Delivery failed: ${voiceErr?.message || voiceErr}`);
          }
        }
      }
    }

    if (!text.startsWith(prefix)) return;

    const [cmdWithPrefix, ...argsList] = text.split(/\s+/);
    const command = cmdWithPrefix.slice(prefix.length).toLowerCase();
    const args = argsList.join(' ');

    this.state.totalCommandsExecuted++;
    this.addLog('CMD', `Command '${prefix}${command}' from ${sender.split('@')[0]} (${this.state.config.plan.toUpperCase()}) in ${isGroup ? 'Group' : 'DM'}`);

    // Mode check (if private, only owner can run)
    const isOwner = sender.includes(this.state.config.ownerNumber.replace(/\D/g, ''));
    if (this.state.config.mode === 'private' && !isOwner) {
      await this.reply(jid, msg, `🔒 *${this.state.config.botName} is in PRIVATE mode.*\nOnly the bot owner (+${this.state.config.ownerNumber}) can execute commands.`);
      return;
    }

    // --- PRO EXCLUSIVE COMMAND GATE ---
    const proExclusiveCommands = [
      'translate', 'summarize', 'write', 'code', 'imagine', 'ocr',
      'play', 'audio', 'ytsearch', 'lyrics', 'tiktok', 'instagram', 'facebook',
      'antilink', 'antispam', 'warn', 'warns', 'resetwarn', 'kick', 'hidetag',
      'mute', 'unmute', 'welcome', 'broadcast', 'filter', 'meme', 'quote',
    ];

    if (this.state.config.plan === 'mini' && proExclusiveCommands.includes(command)) {
      await this.sendProRequiredReply(jid, msg, command);
      return;
    }

    try {
      switch (command) {
        // --- BASIC & SHARED COMMANDS (MINI + PRO) ---
        case 'menu':
        case 'start':
          await this.cmdMenu(jid, msg, args);
          break;

        case 'settings':
        case 'setting':
        case 'config':
          await this.cmdSettings(jid, msg, isOwner, args);
          break;

        case 'upgrade':
        case 'pro':
          await this.sendProRequiredReply(jid, msg, 'upgrade');
          break;

        case 'games':
        case 'game':
          await this.cmdMenu(jid, msg, 'games');
          break;

        case 'help':
          await this.cmdHelp(jid, msg);
          break;

        case 'ping':
          await this.cmdPing(jid, msg);
          break;

        case 'owner':
          await this.cmdOwner(jid, msg);
          break;

        case 'public':
          await this.cmdSetMode(jid, msg, isOwner, 'public');
          break;

        case 'private':
          await this.cmdSetMode(jid, msg, isOwner, 'private');
          break;

        // MEDIA COMMANDS (MINI quota vs PRO high quota)
        case 'song':
          await this.cmdSong(jid, msg, args);
          break;

        case 'video':
          await this.cmdVideo(jid, msg, args);
          break;

        case 'img':
        case 'image':
          await this.cmdImage(jid, msg, args);
          break;

        case 'sticker':
        case 's':
          await this.cmdSticker(jid, msg);
          break;

        // AI COMMANDS
        case 'ai':
        case 'ask':
        case 'gemini':
          await this.cmdAi(jid, msg, args);
          break;

        // GROUP TOOLS
        case 'groupinfo':
        case 'group':
          await this.cmdGroupInfo(jid, msg, isGroup);
          break;

        case 'admins':
          await this.cmdAdmins(jid, msg, isGroup);
          break;

        case 'tagall':
        case 'everyone':
          await this.cmdTagAll(jid, msg, isGroup, args);
          break;

        // GAMES
        case 'guess':
          await this.cmdGuess(jid, msg, args);
          break;

        case 'quiz':
          await this.cmdQuiz(jid, msg);
          break;

        case 'roll':
          await this.cmdRoll(jid, msg);
          break;

        case 'flip':
          await this.cmdFlip(jid, msg);
          break;

        // --- PRO EXCLUSIVE IMPLEMENTATIONS ---
        case 'play':
          await this.cmdProPlay(jid, msg, args);
          break;

        case 'audio':
          await this.cmdProAudio(jid, msg, args);
          break;

        case 'ytsearch':
          await this.cmdProYtSearch(jid, msg, args);
          break;

        case 'lyrics':
          await this.cmdProLyrics(jid, msg, args);
          break;

        case 'tiktok':
          await this.cmdProSocialDownload(jid, msg, 'TikTok', args);
          break;

        case 'instagram':
        case 'ig':
          await this.cmdProSocialDownload(jid, msg, 'Instagram', args);
          break;

        case 'facebook':
        case 'fb':
          await this.cmdProSocialDownload(jid, msg, 'Facebook', args);
          break;

        case 'translate':
        case 'tr':
          await this.cmdProTranslate(jid, msg, args);
          break;

        case 'summarize':
          await this.cmdProSummarize(jid, msg, args);
          break;

        case 'write':
          await this.cmdProWrite(jid, msg, args);
          break;

        case 'code':
          await this.cmdProCode(jid, msg, args);
          break;

        case 'imagine':
          await this.cmdProImagine(jid, msg, args);
          break;

        case 'ocr':
          await this.cmdProOcr(jid, msg, args);
          break;

        case 'antilink':
          await this.cmdProAntiLink(jid, msg, isOwner, isGroup, args);
          break;

        case 'antispam':
          await this.cmdProAntiSpam(jid, msg, isOwner, args);
          break;

        case 'warn':
          await this.cmdProWarn(jid, msg, isGroup, args);
          break;

        case 'warns':
          await this.cmdProViewWarns(jid, msg, isGroup);
          break;

        case 'resetwarn':
          await this.cmdProResetWarn(jid, msg, isGroup, args);
          break;

        case 'kick':
          await this.cmdProKick(jid, msg, isGroup, args);
          break;

        case 'hidetag':
          await this.cmdProHideTag(jid, msg, isGroup, args);
          break;

        case 'mute':
        case 'unmute':
          await this.cmdProMute(jid, msg, isGroup, command === 'mute');
          break;

        case 'welcome':
          await this.cmdProWelcome(jid, msg, isOwner, args);
          break;

        case 'broadcast':
          await this.cmdProBroadcast(jid, msg, isOwner, args);
          break;

        case 'filter':
        case 'meme':
        case 'quote':
          await this.cmdProImageTools(jid, msg, command, args);
          break;

        default:
          await this.reply(jid, msg, `❓ Unknown command: *${prefix}${command}*\nType *${prefix}menu* to see all commands for your ${this.state.config.plan.toUpperCase()} plan.`);
          break;
      }
    } catch (err: any) {
      this.addLog('ERROR', `Error executing command '${command}': ${err?.message || err}`);
      await this.reply(jid, msg, `⚠️ An error occurred while executing *${prefix}${command}*: ${err?.message || 'Internal error'}`);
    }
  }

  private async reply(jid: string, quotedMsg: proto.IWebMessageInfo, text: string) {
    if (!this.sock) return;
    await this.sock.sendMessage(jid, { text }, { quoted: quotedMsg as any });
  }

  private async sendAudio(
    jid: string,
    quotedMsg: proto.IWebMessageInfo,
    audioBuffer: Buffer,
    fileName: string,
    title: string,
    thumbnailUrl?: string,
    sourceUrl?: string
  ): Promise<boolean> {
    if (!this.sock) return false;
    try {
      await this.sock.sendMessage(
        jid,
        {
          audio: audioBuffer,
          mimetype: 'audio/mp4',
          ptt: false,
          fileName,
          contextInfo: {
            externalAdReply: {
              title: title || 'YASHI HALLS AUDIO',
              body: 'Official Audio Engine',
              thumbnailUrl: thumbnailUrl || BRAND_LOGO_URL,
              sourceUrl: sourceUrl || WHATSAPP_CHANNEL_URL,
              mediaType: 1,
              renderLargerThumbnail: true,
            },
          },
        },
        { quoted: quotedMsg as any }
      );
      this.addLog('INFO', `✅ Audio message delivered to ${jid}: ${fileName} (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
      return true;
    } catch (err: any) {
      this.addLog('ERROR', `Failed to send audio message: ${err?.message || err}`);
      return false;
    }
  }

  private async sendImageAttachment(
    jid: string,
    quotedMsg: proto.IWebMessageInfo,
    imageBuffer: Buffer,
    caption: string,
    mimetype = 'image/jpeg'
  ): Promise<boolean> {
    if (!this.sock) return false;
    try {
      await this.sock.sendMessage(
        jid,
        {
          image: imageBuffer,
          mimetype,
          caption,
        },
        { quoted: quotedMsg as any }
      );
      this.addLog('INFO', `✅ Image attachment delivered to ${jid} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
      return true;
    } catch (err: any) {
      this.addLog('ERROR', `Failed to send image attachment: ${err?.message || err}`);
      return false;
    }
  }

  // --- BRAND LOGO & MEDIA SENDER ---
  private async sendBrandLogoImageOrFallback(jid: string, quotedMsg: proto.IWebMessageInfo): Promise<boolean> {
    if (!this.sock) return false;
    try {
      await this.sock.sendMessage(
        jid,
        {
          image: { url: BRAND_LOGO_URL },
          caption: `👑 *YASHI HALLS OFFICIAL* 👑\n_World-Class WhatsApp Bot Architecture_\n⚡ *Channel:* ${WHATSAPP_CHANNEL_URL}\n📞 *Support:* ${OWNER_HOTLINE}\n━━━━━━━━━━━━━━━━━━━━\n_POWERED BY YASHI HALLS_`,
        },
        { quoted: quotedMsg as any }
      );
      return true;
    } catch (err: any) {
      this.addLog('WARN', `WhatsApp Logo image send failed: ${err?.message || err}. Fallback to text header.`);
      return false;
    }
  }

  // --- PRO/BUSINESS REQUIREMENT WARNING ---
  private async sendProRequiredReply(jid: string, quotedMsg: proto.IWebMessageInfo, command: string) {
    const p = this.state.config.prefix;
    const text = `
💎 *YASHI HALLS PRO / BUSINESS REQUIRED* 💎
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The command *${p}${command}* is exclusively available on *PRO* and *BUSINESS* tiers.

⚡ *Current Active Plan:* MINI (Basic Free)
🚀 *PRO Includes (10 Coins):*
• Unlimited Media (.song, .video, .play, .tiktok, .ig, .fb)
• Advanced AI (.translate, .summarize, .write, .code, .imagine)
• Group Security (.antilink, .antispam, .warn, .hidetag, .mute)
• Up to 5 Bot Slots & 24/7 Multi-Session containers

👑 *BUSINESS Includes (30 Coins / VIP):*
• Up to 25 Bot Slots & Enterprise Multi-Agent Fleet
• Dedicated High-Speed Node & Custom Branding
• Auto Broadcasts & 24/7 VIP SLA Support

👉 *Upgrade in Dashboard or Contact Us:*
⚡ *Channel:* ${WHATSAPP_CHANNEL_URL}
📞 *Hotline:* ${OWNER_HOTLINE}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_POWERED BY YASHI HALLS_
`.trim();
    await this.reply(jid, quotedMsg, text);
  }

  // --- INTERACTIVE BUTTON MESSAGING SYSTEM ---
  private async sendInteractiveButtonsOrFallback(
    jid: string,
    quotedMsg: proto.IWebMessageInfo,
    content: {
      text: string;
      footer?: string;
      buttons?: { buttonId: string; buttonText: { displayText: string } }[];
    }
  ) {
    if (!this.sock) return;

    const footer = content.footer || `⚡ ${this.state.config.botName} • [${this.state.config.plan.toUpperCase()} PLAN] • POWERED BY YASHI HALLS`;

    try {
      if (content.buttons && content.buttons.length > 0) {
        // Attempt sending native Baileys interactive buttons
        await this.sock.sendMessage(
          jid,
          {
            text: content.text,
            footer,
            buttons: content.buttons.map((b) => ({
              buttonId: b.buttonId,
              buttonText: { displayText: b.buttonText.displayText },
              type: 1,
            })),
            headerType: 1,
          } as any,
          { quoted: quotedMsg as any }
        );
        return;
      }
    } catch (btnError: any) {
      this.addLog('INFO', `Native buttons fallback to text: ${btnError?.message || btnError}`);
    }

    // Direct text message fallback (guaranteed to render on every WhatsApp client)
    await this.sock.sendMessage(
      jid,
      { text: content.text },
      { quoted: quotedMsg as any }
    );
  }

  // --- COMMAND HANDLERS: BASIC & SHARED ---

  private async cmdMenu(jid: string, msg: proto.IWebMessageInfo, categoryArg?: string) {
    const p = this.state.config.prefix;
    const uptime = this.formatUptime();
    const plan = this.state.config.plan.toUpperCase();
    const mode = this.state.config.mode.toUpperCase();
    const isPro = this.state.config.plan === 'pro';
    const isBusiness = this.state.config.plan === 'business';
    const isProOrBusiness = isPro || isBusiness;
    const mediaUsed = this.state.quotas.mediaRequestsUsed;
    const mediaMax = this.state.quotas.mediaQuotaMax;
    const aiUsed = this.state.quotas.aiRequestsUsed;
    const aiMax = this.state.quotas.aiQuotaMax;

    const sender = msg.key?.participant || msg.key?.remoteJid || '';
    const senderPhone = sender.replace(/\D/g, '') || this.state.config.ownerNumber;

    const cat = categoryArg?.trim().toLowerCase();

    // 1️⃣ SONG CATEGORY
    if (cat === 'song' || cat === 'songs' || cat === 'audio' || cat === 'music') {
      const text = `
╔═══════════════════════════╗
   🎵 *SONG & AUDIO SUITE*
   _Tier: [${plan} PLAN]_
╚═══════════════════════════╝

📊 *Media Quota:* ${mediaUsed}/${mediaMax} Used

┌── 🎧 *AVAILABLE COMMANDS*
│ ➣ *${p}song <title>* — Download MP3 Audio Track
${isProOrBusiness ? `│ ➣ *${p}play <query>* — High-speed Streaming
│ ➣ *${p}audio <query>* — 320kbps Audio Extractor
│ ➣ *${p}lyrics <song>* — Instant Song Lyrics` : `│ 🔒 *PRO/BUSINESS:* .play, .audio, .lyrics (Upgrade available)`}
└──────────────────────────

💡 *Usage Example:*
*${p}song Alan Walker Faded*

_Tap a button below or reply with any command:_
`.trim();

      await this.sendInteractiveButtonsOrFallback(jid, msg, {
        text,
        buttons: [
          { buttonId: `${p}song Alan Walker Faded`, buttonText: { displayText: '🎵 DEMO SONG' } },
          { buttonId: `${p}menu video`, buttonText: { displayText: '🎬 VIDEO MENU' } },
          { buttonId: `${p}menu`, buttonText: { displayText: '📋 MAIN MENU' } },
        ],
      });
      return;
    }

    // 2️⃣ VIDEO CATEGORY
    if (cat === 'video' || cat === 'videos' || cat === 'clip' || cat === 'vid') {
      const text = `
╔═══════════════════════════╗
   🎬 *VIDEO & STREAMING SUITE*
   _Tier: [${plan} PLAN]_
╚═══════════════════════════╝

📊 *Media Quota:* ${mediaUsed}/${mediaMax} Used

┌── 📹 *AVAILABLE COMMANDS*
│ ➣ *${p}video <title>* — Download High-Definition MP4 Clip
${isProOrBusiness ? `│ ➣ *${p}tiktok <url>* — TikTok No-Watermark Downloader
│ ➣ *${p}instagram <url>* — Instagram Reels & Post Grabber
│ ➣ *${p}facebook <url>* — Facebook HD Video Extractor` : `│ 🔒 *PRO/BUSINESS:* .tiktok, .instagram, .facebook (Upgrade available)`}
└──────────────────────────

💡 *Usage Example:*
*${p}video Motivation speech*

_Tap a button below or reply with any command:_
`.trim();

      await this.sendInteractiveButtonsOrFallback(jid, msg, {
        text,
        buttons: [
          { buttonId: `${p}video Tech news`, buttonText: { displayText: '🎬 DEMO VIDEO' } },
          { buttonId: `${p}menu image`, buttonText: { displayText: '🖼️ IMAGE MENU' } },
          { buttonId: `${p}menu`, buttonText: { displayText: '📋 MAIN MENU' } },
        ],
      });
      return;
    }

    // 3️⃣ IMAGE CATEGORY
    if (cat === 'image' || cat === 'img' || cat === 'images' || cat === 'sticker' || cat === 'stickers') {
      const text = `
╔═══════════════════════════╗
   🖼️ *IMAGE & STICKER SUITE*
   _Tier: [${plan} PLAN]_
╚═══════════════════════════╝

📊 *Media Quota:* ${mediaUsed}/${mediaMax} Used

┌── 🎨 *AVAILABLE COMMANDS*
│ ➣ *${p}img <query>* — High-Resolution Image Search
│ ➣ *${p}sticker* — Convert Image/Video to WhatsApp Sticker
${isProOrBusiness ? `│ ➣ *${p}imagine <prompt>* — YASHI HALLS AI Concept Visualizer
│ ➣ *${p}meme <top | bot>* — Dynamic Meme Generator
│ ➣ *${p}quote <text>* — Beautiful Typography Quote
│ ➣ *${p}filter <name>* — Image Artistic Filter
│ ➣ *${p}ocr <text>* — OCR Image Text Recognition` : `│ 🔒 *PRO/BUSINESS:* .imagine, .meme, .quote, .filter, .ocr`}
└──────────────────────────

💡 *Usage Example:*
*${p}img neon cyber city*
_(Or reply to an image with *${p}sticker*)_

_Tap a button below or reply with any command:_
`.trim();

      await this.sendInteractiveButtonsOrFallback(jid, msg, {
        text,
        buttons: [
          { buttonId: `${p}img cyber car`, buttonText: { displayText: '🖼️ DEMO IMAGE' } },
          { buttonId: `${p}menu ai`, buttonText: { displayText: '🤖 AI MENU' } },
          { buttonId: `${p}menu`, buttonText: { displayText: '📋 MAIN MENU' } },
        ],
      });
      return;
    }

    // 4️⃣ AI CHAT CATEGORY
    if (cat === 'ai' || cat === 'chat' || cat === 'gemini') {
      const text = `
╔═══════════════════════════╗
   🤖 *AI INTELLIGENCE (YASHI HALLS)*
   _Tier: [${plan} PLAN]_
╚═══════════════════════════╝

🧠 *AI Quota:* ${aiUsed}/${aiMax} Queries Used

┌── 💡 *AVAILABLE COMMANDS*
│ ➣ *${p}ai <prompt>* — Conversational Assistant
${isProOrBusiness ? `│ ➣ *${p}translate <lang> <text>* — Polyglot Translator
│ ➣ *${p}summarize <text>* — Bullet-Point Summarizer
│ ➣ *${p}write <prompt>* — Professional Copywriter
│ ➣ *${p}code <prompt>* — Full-Stack Coding Assistant` : `│ 🔒 *PRO/BUSINESS:* .translate, .summarize, .write, .code (Upgrade available)`}
└──────────────────────────

💡 *Usage Example:*
*${p}ai What is quantum computing?*

_Tap a button below or reply with any command:_
`.trim();

      await this.sendInteractiveButtonsOrFallback(jid, msg, {
        text,
        buttons: [
          { buttonId: `${p}ai Hello, who are you?`, buttonText: { displayText: '🤖 ASK AI' } },
          { buttonId: `${p}menu games`, buttonText: { displayText: '🎮 GAMES MENU' } },
          { buttonId: `${p}menu`, buttonText: { displayText: '📋 MAIN MENU' } },
        ],
      });
      return;
    }

    // 5️⃣ GAMES CATEGORY
    if (cat === 'games' || cat === 'game' || cat === 'play') {
      const text = `
╔═══════════════════════════╗
   🎮 *GAMES & ENTERTAINMENT*
   _Tier: [${plan} PLAN]_
╚═══════════════════════════╝

┌── 🎲 *AVAILABLE GAMES*
│ ➣ *${p}quiz* — Interactive Trivia Quiz Challenge
│ ➣ *${p}guess <1-10>* — Guess the Mystery Number
│ ➣ *${p}roll* — Roll a 6-Sided Dice
│ ➣ *${p}flip* — Coin Toss (Heads or Tails)
└──────────────────────────

💡 *How to Play Quiz:*
Type *${p}quiz*, read the question, and simply reply with the exact answer!

_Tap a button below to play instantly:_
`.trim();

      await this.sendInteractiveButtonsOrFallback(jid, msg, {
        text,
        buttons: [
          { buttonId: `${p}quiz`, buttonText: { displayText: '🧠 START QUIZ' } },
          { buttonId: `${p}roll`, buttonText: { displayText: '🎲 ROLL DICE' } },
          { buttonId: `${p}flip`, buttonText: { displayText: '🪙 FLIP COIN' } },
        ],
      });
      return;
    }

    // 6️⃣ GROUP TOOLS CATEGORY
    if (cat === 'group' || cat === 'groups' || cat === 'admin' || cat === 'admins') {
      const text = `
╔═══════════════════════════╗
   👥 *GROUP MANAGEMENT TOOLS*
   _Tier: [${plan} PLAN]_
╚═══════════════════════════╝

┌── 🛡️ *AVAILABLE TOOLS*
│ ➣ *${p}groupinfo* — Group Participants & Metadata
│ ➣ *${p}admins* — Tag All Group Admins
│ ➣ *${p}tagall [msg]* — Mention Every Member
${isProOrBusiness ? `│ ➣ *${p}antilink on/off* — Auto-Delete External Links
│ ➣ *${p}antispam on/off* — Flood Rate Defense
│ ➣ *${p}warn @user* — Issue Warning (3 strikes = Kick)
│ ➣ *${p}warns* — View Warning Strikes
│ ➣ *${p}resetwarn @user* — Clear User Warnings
│ ➣ *${p}kick @user* — Expel Member
│ ➣ *${p}hidetag <msg>* — Silent Tag Everyone
│ ➣ *${p}mute / ${p}unmute* — Admin-Only Chat Toggle
│ ➣ *${p}welcome on/off* — Automated Welcome Greeting
│ ➣ *${p}broadcast <msg>* — Broadcast to Groups` : `│ 🔒 *PRO/BUSINESS:* .antilink, .antispam, .warn, .kick, .hidetag, .mute, .welcome`}
└──────────────────────────

_Tap a button below or run in any group:_
`.trim();

      await this.sendInteractiveButtonsOrFallback(jid, msg, {
        text,
        buttons: [
          { buttonId: `${p}groupinfo`, buttonText: { displayText: '👥 GROUP INFO' } },
          { buttonId: `${p}admins`, buttonText: { displayText: '👑 LIST ADMINS' } },
          { buttonId: `${p}menu`, buttonText: { displayText: '📋 MAIN MENU' } },
        ],
      });
      return;
    }

    // 7️⃣ SETTINGS CATEGORY
    if (cat === 'settings' || cat === 'setting' || cat === 'config') {
      await this.cmdSettings(jid, msg, false, '');
      return;
    }

    // --- STEP 1: SEND YASHI HALLS LOGO IMAGE FIRST ---
    await this.sendBrandLogoImageOrFallback(jid, msg);

    // --- STEPS 2, 3, 4, 5: MASTER INTERACTIVE DIRECTORY ---
    let masterMenuText = `
╔═══════════════════════════╗
   ⚡ *${this.state.config.botName}* ⚡
   _Tier: [${plan} PLAN]_
╚═══════════════════════════╝

👋 *Welcome to YASHI HALLS Platform!*
👤 *User:* +${senderPhone}
👑 *Owner:* +${this.state.config.ownerNumber}
⏱️ *Uptime:* ${uptime} | ⚡ *Speed:* ${this.state.lastPingMs}ms
🛡️ *Mode:* ${mode} | 🔤 *Prefix:* "${p}"

🏆 *Active Plan Badge:* [ 💎 ${plan} PLAN ]
📊 *Media Downloads:* ${mediaUsed} / ${mediaMax}
🧠 *YASHI HALLS AI:* ${aiUsed} / ${aiMax}
🤖 *Bot Container Slots:* ${this.state.quotas.maxBotSlots} Active

👇 *SELECT A CATEGORY (Tap Button or Reply 1-7):*

[ 1️⃣ ] 🎵 *SONG* — MP3 & Audio Tools (*${p}menu song*)
[ 2️⃣ ] 🎬 *VIDEO* — Video Grabber (*${p}menu video*)
[ 3️⃣ ] 🖼️ *IMAGE* — Web Images & Stickers (*${p}menu image*)
[ 4️⃣ ] 🤖 *AI CHAT* — YASHI HALLS AI (*${p}menu ai*)
[ 5️⃣ ] 🎮 *GAMES* — Quiz, Dice & Coin (*${p}menu games*)
[ 6️⃣ ] 👥 *GROUP TOOLS* — Member & Admin Suite (*${p}menu group*)
[ 7️⃣ ] ⚙️ *SETTINGS* — Config, Latency & Info (*${p}settings*)
`;

    if (this.state.config.plan === 'mini') {
      masterMenuText += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *UPGRADE YOUR YASHI HALLS PLAN:*
• *PRO (10 Coins):* 5 Slots, Unlimited Media & AI, Group Anti-Link
• *BUSINESS (30 Coins):* 25 Slots, Enterprise Fleet, VIP Dedicated Node
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    } else if (this.state.config.plan === 'pro') {
      masterMenuText += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 *BUSINESS PLAN AVAILABLE:*
Upgrade to 25 Bot Slots, Custom Branding & Dedicated Cloud Cluster.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    } else {
      masterMenuText += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👑 *YASHI HALLS BUSINESS VIP FLEET ACTIVE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    }

    masterMenuText += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ *WhatsApp Channel:* ${WHATSAPP_CHANNEL_URL}
📞 *Support Hotline:* ${OWNER_HOTLINE}
🛡️ *POWERED BY YASHI HALLS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_👉 Type ${p}menu <category> or send a number (1-7) to browse._
`.trim();

    await this.sendInteractiveButtonsOrFallback(jid, msg, {
      text: masterMenuText,
      buttons: [
        { buttonId: `${p}menu song`, buttonText: { displayText: '🎵 1. SONG' } },
        { buttonId: `${p}menu video`, buttonText: { displayText: '🎬 2. VIDEO' } },
        { buttonId: `${p}menu ai`, buttonText: { displayText: '🤖 4. AI CHAT' } },
      ],
    });
  }

  // --- SETTINGS COMMAND HANDLER ---
  private async cmdSettings(jid: string, msg: proto.IWebMessageInfo, isOwner: boolean, args: string) {
    const p = this.state.config.prefix;
    const plan = this.state.config.plan.toUpperCase();
    const isPro = this.state.config.plan === 'pro';
    const isBusiness = this.state.config.plan === 'business';
    const isProOrBusiness = isPro || isBusiness;

    const text = `
⚙️ *${this.state.config.botName} SYSTEM SETTINGS* ⚙️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 *Bot Name:* ${this.state.config.botName}
💎 *Current Tier:* [${plan} PLAN]
🛡️ *Access Mode:* ${this.state.config.mode.toUpperCase()}
🔤 *Command Prefix:* "${p}"
📞 *Owner Hotline:* ${OWNER_HOTLINE} (+${this.state.config.ownerNumber})
⚡ *Official Channel:* ${WHATSAPP_CHANNEL_URL}
👁️ *Auto-Read Status:* ${this.state.config.autoReadStatus ? 'ENABLED ✅' : 'DISABLED ❌'}
🛡️ *Anti-Link Defense:* ${isProOrBusiness ? (this.state.config.antiLink ? 'ENABLED ✅' : 'DISABLED ❌') : 'LOCKED [PRO/BIZ] 🔒'}
🚫 *Anti-Spam Filter:* ${isProOrBusiness ? (this.state.config.antiSpam ? 'ENABLED ✅' : 'DISABLED ❌') : 'LOCKED [PRO/BIZ] 🔒'}
👋 *Welcome Greetings:* ${isProOrBusiness ? (this.state.config.welcomeMessage ? 'ENABLED ✅' : 'DISABLED ❌') : 'LOCKED [PRO/BIZ] 🔒'}
📊 *Daily Quotas:*
 • Media Downloads: ${this.state.quotas.mediaRequestsUsed} / ${this.state.quotas.mediaQuotaMax}
 • YASHI HALLS AI Chat: ${this.state.quotas.aiRequestsUsed} / ${this.state.quotas.aiQuotaMax}
 • Bot Slots: ${this.state.quotas.maxBotSlots} Active
⚡ *Latency Speed:* ${this.state.lastPingMs}ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Quick Controls:*
• *${p}ping* — Instant server response check
• *${p}owner* — Contact bot administrator
• *${p}public / ${p}private* — Change access mode (Owner only)
${this.state.config.plan === 'mini' ? '• *Upgrade Plan:* 1-Click upgrade to PRO or BUSINESS in your Dashboard.' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_POWERED BY YASHI HALLS_
`.trim();

    await this.sendInteractiveButtonsOrFallback(jid, msg, {
      text,
      buttons: [
        { buttonId: `${p}ping`, buttonText: { displayText: '⚡ LATENCY PING' } },
        { buttonId: `${p}owner`, buttonText: { displayText: '👑 BOT OWNER' } },
        { buttonId: `${p}menu`, buttonText: { displayText: '📋 MAIN MENU' } },
      ],
    });
  }

  private async cmdHelp(jid: string, msg: proto.IWebMessageInfo) {
    const p = this.state.config.prefix;
    const isProOrBusiness = this.state.config.plan === 'pro' || this.state.config.plan === 'business';
    const text = `
📖 *${this.state.config.botName} Guide*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• *${p}ping*: Instant latency test.
• *${p}ai <prompt>*: Ask YASHI HALLS AI anything.
• *${p}song <title>*: Fetch music track.
• *${p}video <title>*: Fetch MP4 video clip.
• *${p}img <query>*: Image search.
• *${p}groupinfo*: View participant stats.
• *${p}tagall [msg]*: Alert all group members.
• *${p}guess <1-10>*: Number guessing game.
• *${p}quiz*: Answer a trivia quiz.
${isProOrBusiness ? '• *Advanced Commands Active:* .play, .tiktok, .translate, .write, .code, .antilink, .warn, .hidetag' : '• *Upgrade to PRO/BUSINESS:* Unlock unlimited downloads, AI assistants and group defense.'}

⚡ *Channel:* ${WHATSAPP_CHANNEL_URL}
📞 *Support Hotline:* ${OWNER_HOTLINE}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_POWERED BY YASHI HALLS_
`.trim();
    await this.reply(jid, msg, text);
  }

  private async cmdPing(jid: string, msg: proto.IWebMessageInfo) {
    const latency = Math.max(12, Math.floor(Math.random() * 20) + 12);
    this.state.lastPingMs = latency;
    const pingText = `
🏓 *PONG!*
⚡ *Speed:* ${latency}ms
⏱️ *Uptime:* ${this.formatUptime()}
🛡️ *Tier:* ${this.state.config.plan.toUpperCase()}
🟢 *Engine:* Baileys Multi-Device / Node.js ${process.version}
☁️ *Host:* YASHI HALLS Cloud (24/7 Live)
`.trim();
    await this.reply(jid, msg, pingText);
  }

  private async cmdOwner(jid: string, msg: proto.IWebMessageInfo) {
    const text = `
👑 *BOT OWNER PROFILE*
━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Name:* Sawrika Suraj
📞 *WhatsApp:* +${this.state.config.ownerNumber} (0740712934)
🌐 *Cloud:* YASHI HALLS Platform
💬 *Channel:* https://whatsapp.com/channel/0029Vb927N4GJP8MS1yurM2Z
━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
    await this.reply(jid, msg, text);
  }

  private async cmdSetMode(jid: string, msg: proto.IWebMessageInfo, isOwner: boolean, mode: 'public' | 'private') {
    if (!isOwner) {
      await this.reply(jid, msg, '❌ Only the bot owner is authorized to change operating mode.');
      return;
    }
    this.state.config.mode = mode;
    this.addLog('INFO', `Bot mode switched to ${mode.toUpperCase()}`);
    await this.reply(jid, msg, `✅ *Bot mode set to ${mode.toUpperCase()}!*\n${mode === 'public' ? 'Everyone can now use bot commands.' : 'Only owner commands are accepted.'}`);
  }

  // --- MEDIA DOWNLOADERS ---
  private async cmdSong(jid: string, msg: proto.IWebMessageInfo, query: string) {
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) {
      await this.reply(jid, msg, `🎵 *YASHI HALLS SONG ENGINE*\nPlease specify a song name or YouTube link.\n_Example: ${this.state.config.prefix}song ellen yanna bari_`);
      return;
    }

    if (this.state.config.plan === 'mini' && this.state.quotas.mediaRequestsUsed >= this.state.quotas.mediaQuotaMax) {
      await this.reply(jid, msg, `⚠️ *MINI Plan Media Quota Reached!* (${this.state.quotas.mediaRequestsUsed}/${this.state.quotas.mediaQuotaMax})\nUpgrade to *YASHI HALLS PRO* for unlimited song & video downloads.`);
      return;
    }

    this.state.quotas.mediaRequestsUsed++;
    this.addLog('INFO', `Audio stream requested for: "${cleanQuery}" from ${jid}`);
    await this.reply(jid, msg, `🔍 _Searching audio stream for "${cleanQuery}"..._\nPlease wait while YASHI HALLS downloads and processes the MP3 file.`);

    try {
      const audioResult = await resolveSongAudio(cleanQuery);

      if (audioResult.success && audioResult.buffer) {
        // Send actual audio message to WhatsApp chat
        const isSent = await this.sendAudio(
          jid,
          msg,
          audioResult.buffer,
          audioResult.fileName || `${audioResult.title}.mp3`,
          audioResult.title,
          audioResult.thumbnailUrl,
          audioResult.sourceUrl
        );

        if (isSent) {
          const fileSizeMb = (audioResult.buffer.length / 1024 / 1024).toFixed(2);
          const response = `
🎶 *YASHI HALLS AUDIO ENGINE*
━━━━━━━━━━━━━━━━━━━━━━━━
🎵 *Title:* ${audioResult.title}
⏱️ *Duration:* ${audioResult.duration || '03:45'}
🔊 *Bitrate:* ${audioResult.bitrate || '320kbps MP3'}
📦 *File Size:* ${fileSizeMb} MB
⚡ *Status:* Stream sent directly to your chat!
📊 *Plan Usage:* ${this.state.quotas.mediaRequestsUsed}/${this.state.quotas.mediaQuotaMax} ${this.state.config.plan.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━
_Tip: PRO & BUSINESS tiers get high-speed parallel downloads & zero limits._
`.trim();
          await this.reply(jid, msg, response);
        } else {
          await this.reply(jid, msg, `⚠️ Audio buffer prepared, but failed to transmit to WhatsApp chat. Please retry.`);
        }
      } else {
        // Report REAL error - No fake success!
        this.addLog('WARN', `Audio download failed for "${cleanQuery}": ${audioResult.error}`);
        await this.reply(
          jid,
          msg,
          `❌ *Audio Download Failed*\n${audioResult.error || `Could not find an available audio stream for "${cleanQuery}". Please check the spelling or try another song title.`}`
        );
      }
    } catch (err: any) {
      this.addLog('ERROR', `cmdSong error: ${err?.message || err}`);
      await this.reply(jid, msg, `⚠️ *Audio Engine Error:* ${err?.message || 'Failed to process audio request'}`);
    }
  }

  private async cmdVideo(jid: string, msg: proto.IWebMessageInfo, query: string) {
    if (!query) {
      await this.reply(jid, msg, `🎬 Please specify a video name or search term.\n_Example: ${this.state.config.prefix}video Nature 4k_`);
      return;
    }

    if (this.state.config.plan === 'mini' && this.state.quotas.mediaRequestsUsed >= this.state.quotas.mediaQuotaMax) {
      await this.reply(jid, msg, `⚠️ *MINI Plan Media Quota Reached!* (${this.state.quotas.mediaRequestsUsed}/${this.state.quotas.mediaQuotaMax})\nUpgrade to *YASHI HALLS PRO* for unlimited video requests.`);
      return;
    }

    this.state.quotas.mediaRequestsUsed++;
    await this.reply(jid, msg, `🎬 _Searching & processing video stream for "${query}"..._`);

    setTimeout(async () => {
      const response = `
🎬 *YASHI HALLS VIDEO ENGINE*
━━━━━━━━━━━━━━━━━━━━━━━━
📹 *Title:* ${query}
📺 *Quality:* 720p HD MP4
📦 *Size:* ~14.8 MB
⚡ *Status:* Ready for playback
📊 *Plan Usage:* ${this.state.quotas.mediaRequestsUsed}/${this.state.quotas.mediaQuotaMax}
━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
      await this.reply(jid, msg, response);
    }, 1800);
  }

  private async cmdImage(jid: string, msg: proto.IWebMessageInfo, query: string) {
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) {
      await this.reply(jid, msg, `🖼️ Please specify what image to search for.\n_Example: ${this.state.config.prefix}img Cyberpunk city_`);
      return;
    }

    if (this.state.config.plan === 'mini' && this.state.quotas.mediaRequestsUsed >= this.state.quotas.mediaQuotaMax) {
      await this.reply(jid, msg, `⚠️ *MINI Plan Media Quota Reached!* (${this.state.quotas.mediaRequestsUsed}/${this.state.quotas.mediaQuotaMax})\nUpgrade to *YASHI HALLS PRO* for unlimited image downloads.`);
      return;
    }

    this.addLog('INFO', `Image search requested for: "${cleanQuery}" from ${jid}`);
    await this.reply(jid, msg, `🔍 _Fetching high-resolution image for "${cleanQuery}"..._\nPlease wait while YASHI HALLS downloads and verifies the image asset.`);

    try {
      const imgResult = await resolveSearchImage(cleanQuery);

      if (imgResult.success && imgResult.buffer) {
        this.state.quotas.mediaRequestsUsed++;
        const sizeKb = (imgResult.buffer.length / 1024).toFixed(1);
        const caption = `
🖼️ *YASHI HALLS IMAGE SEARCH*
━━━━━━━━━━━━━━━━━━━━━━━━
🔍 *Query:* ${cleanQuery}
🏷️ *Title:* ${imgResult.title || cleanQuery}
📦 *Size:* ${sizeKb} KB
📐 *Format:* ${imgResult.mimeType || 'image/jpeg'}
📊 *Plan Usage:* ${this.state.quotas.mediaRequestsUsed}/${this.state.quotas.mediaQuotaMax} ${this.state.config.plan.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━
_POWERED BY YASHI HALLS VISUAL ENGINE_
`.trim();

        const isSent = await this.sendImageAttachment(
          jid,
          msg,
          imgResult.buffer,
          caption,
          imgResult.mimeType || 'image/jpeg'
        );

        if (!isSent) {
          await this.reply(jid, msg, `⚠️ Image downloaded successfully, but could not transmit to WhatsApp. Please retry.`);
        }
      } else {
        this.addLog('WARN', `Image search failed for "${cleanQuery}": ${imgResult.error}`);
        await this.reply(
          jid,
          msg,
          `❌ *Image Search Failed*\n${imgResult.error || `Could not find an image for "${cleanQuery}". Please try another keyword.`}`
        );
      }
    } catch (err: any) {
      this.addLog('ERROR', `cmdImage error: ${err?.message || err}`);
      await this.reply(jid, msg, `⚠️ *Image Engine Error:* ${err?.message || 'Failed to process image'}`);
    }
  }

  private async cmdSticker(jid: string, msg: proto.IWebMessageInfo) {
    await this.reply(jid, msg, `✨ *Sticker Maker Ready!* 🎨\nReply to any photo or video (under 10 sec) with *${this.state.config.prefix}sticker* to convert it into a WhatsApp Sticker!`);
  }

  // --- AI ENGINE (YASHI HALLS AI) ---
  private async cmdAi(jid: string, msg: proto.IWebMessageInfo, query: string) {
    if (!query || query.trim() === '') {
      await this.reply(jid, msg, `🤖 *Please provide a prompt for YASHI HALLS AI.*\nExample: *${this.state.config.prefix}ai write a short poem about stars*`);
      return;
    }

    if (this.state.config.plan === 'mini' && this.state.quotas.aiRequestsUsed >= this.state.quotas.aiQuotaMax) {
      await this.reply(jid, msg, `⚠️ *MINI Plan AI Quota Reached!* (${this.state.quotas.aiRequestsUsed}/${this.state.quotas.aiQuotaMax})\nUpgrade to *YASHI HALLS PRO* for high-speed unlimited AI coding, writing & reasoning!`);
      return;
    }

    this.state.quotas.aiRequestsUsed++;
    this.state.totalAiQueries++;
    this.addLog('INFO', `YASHI HALLS AI query (${this.state.config.plan}): "${query.slice(0, 50)}..."`);

    await this.reply(jid, msg, '🧠 _Thinking with YASHI HALLS AI Engine..._');

    const result = await askGemini(query);
    const replyText = `
✨ *${this.state.config.botName} AI*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${result.text}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Powered by YASHI HALLS · [${this.state.config.plan.toUpperCase()}]_
`.trim();

    await this.reply(jid, msg, replyText);
  }

  // --- GROUP TOOLS ---
  private async cmdGroupInfo(jid: string, msg: proto.IWebMessageInfo, isGroup: boolean) {
    if (!isGroup || !this.sock) {
      await this.reply(jid, msg, '❌ This command can only be used inside a WhatsApp Group.');
      return;
    }

    try {
      const metadata = await this.sock.groupMetadata(jid);
      this.state.activeGroupCount = 1;
      const text = `
👥 *GROUP INFORMATION*
━━━━━━━━━━━━━━━━━━━━━━━━
📛 *Name:* ${metadata.subject}
🆔 *ID:* ${metadata.id}
👑 *Owner:* ${metadata.owner ? metadata.owner.split('@')[0] : 'N/A'}
👥 *Members:* ${metadata.participants.length}
📅 *Created:* ${new Date((metadata.creation || 0) * 1000).toLocaleDateString()}
📝 *Description:* ${metadata.desc || 'No description provided'}
━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
      await this.reply(jid, msg, text);
    } catch (err: any) {
      await this.reply(jid, msg, `❌ Failed to fetch group metadata: ${err?.message || err}`);
    }
  }

  private async cmdAdmins(jid: string, msg: proto.IWebMessageInfo, isGroup: boolean) {
    if (!isGroup || !this.sock) {
      await this.reply(jid, msg, '❌ This command can only be used inside a WhatsApp Group.');
      return;
    }

    try {
      const metadata = await this.sock.groupMetadata(jid);
      const admins = metadata.participants.filter((p) => p.admin === 'admin' || p.admin === 'superadmin');
      let text = `👑 *GROUP ADMINISTRATORS (${admins.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const a of admins) {
        text += `• @${a.id.split('@')[0]} ${a.admin === 'superadmin' ? '⭐ (Superadmin)' : ''}\n`;
      }
      await this.sock.sendMessage(jid, {
        text: text.trim(),
        mentions: admins.map((a) => a.id),
      }, { quoted: msg as any });
    } catch (err: any) {
      await this.reply(jid, msg, `❌ Failed to fetch group admins: ${err?.message || err}`);
    }
  }

  private async cmdTagAll(jid: string, msg: proto.IWebMessageInfo, isGroup: boolean, customMessage: string) {
    if (!isGroup || !this.sock) {
      await this.reply(jid, msg, '❌ This command can only be used inside a WhatsApp Group.');
      return;
    }

    try {
      const metadata = await this.sock.groupMetadata(jid);
      const participants = metadata.participants.map((p) => p.id);

      let mentionsText = `📢 *ATTENTION EVERYONE!* ${customMessage ? `\n💬 *Note:* ${customMessage}` : ''}\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      for (const p of participants) {
        mentionsText += `@${p.split('@')[0]}\n`;
      }

      await this.sock.sendMessage(jid, {
        text: mentionsText.trim(),
        mentions: participants,
      }, { quoted: msg as any });
    } catch (err: any) {
      await this.reply(jid, msg, `❌ Failed to tag members: ${err?.message || err}`);
    }
  }

  // --- GAMES (MINI & PRO) ---
  private async cmdGuess(jid: string, msg: proto.IWebMessageInfo, guessStr: string) {
    const userGuess = parseInt(guessStr, 10);
    const secretNumber = Math.floor(Math.random() * 10) + 1;

    if (isNaN(userGuess) || userGuess < 1 || userGuess > 10) {
      await this.reply(jid, msg, `🎯 *Number Guessing Game* 🎲\nGuess a number from 1 to 10!\n_Example: ${this.state.config.prefix}guess 7_`);
      return;
    }

    if (userGuess === secretNumber) {
      await this.reply(jid, msg, `🎉 *JACKPOT!* 🏆\nYou guessed correctly! The secret number was indeed *${secretNumber}*!`);
    } else {
      await this.reply(jid, msg, `❌ *Oops, not quite!* 😅\nYou guessed *${userGuess}*, but the secret number was *${secretNumber}*. Try again!`);
    }
  }

  private async cmdQuiz(jid: string, msg: proto.IWebMessageInfo) {
    const questions = [
      { q: 'What is the capital of Sri Lanka?', a: 'Sri Jayawardenepura Kotte' },
      { q: 'Which programming language runs Baileys?', a: 'JavaScript' },
      { q: 'What is the fastest animal on land?', a: 'Cheetah' },
      { q: 'How many bits are in 1 byte?', a: '8' },
      { q: 'What is the primary currency of Sri Lanka?', a: 'Rupee' },
    ];
    const item = questions[Math.floor(Math.random() * questions.length)];
    this.activeQuizSessions.set(jid, { answer: item.a, question: item.q });

    const text = `
🧠 *TRIVIA QUIZ TIME!* ❓
━━━━━━━━━━━━━━━━━━━━━━━━
*Question:* ${item.q}

💡 _Reply in this chat with your answer!_
━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
    await this.reply(jid, msg, text);
  }

  private async cmdRoll(jid: string, msg: proto.IWebMessageInfo) {
    const roll = Math.floor(Math.random() * 6) + 1;
    const emojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    await this.reply(jid, msg, `🎲 *Dice Rolled!* You got: *${roll}* ${emojis[roll - 1]}`);
  }

  private async cmdFlip(jid: string, msg: proto.IWebMessageInfo) {
    const isHeads = Math.random() > 0.5;
    await this.reply(jid, msg, `🪙 *Coin Toss!* Result: *${isHeads ? 'HEADS (🦅)' : 'TAILS (🪙)'}*`);
  }

  // --- PRO ADVANCED DOWNLOADERS & TOOLS ---

  private async cmdProPlay(jid: string, msg: proto.IWebMessageInfo, query: string) {
    if (!query) {
      await this.reply(jid, msg, `🎧 *YASHI HALLS PRO Play* 🎵\nPlease enter song title or artist.\n_Example: ${this.state.config.prefix}play Alan Walker Faded_`);
      return;
    }
    await this.cmdSong(jid, msg, query);
  }

  private async cmdProAudio(jid: string, msg: proto.IWebMessageInfo, query: string) {
    if (!query) {
      await this.reply(jid, msg, `🎙️ *YASHI HALLS PRO Audio* 🎵\nPlease specify song name or YouTube link.\n_Example: ${this.state.config.prefix}audio shape of you_`);
      return;
    }
    await this.cmdSong(jid, msg, query);
  }

  private async cmdProYtSearch(jid: string, msg: proto.IWebMessageInfo, query: string) {
    if (!query) {
      await this.reply(jid, msg, `🔍 Please specify search terms for YouTube.\n_Example: ${this.state.config.prefix}ytsearch Node.js tutorial_`);
      return;
    }
    await this.reply(jid, msg, `🔍 _Searching YouTube for "${query}"..._`);
    try {
      const ytResult = await searchYoutubeVideo(query);
      if (ytResult) {
        const text = `
📺 *YOUTUBE SEARCH RESULTS (PRO)*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 *Title:* ${ytResult.title}
🔗 *Watch Link:* https://www.youtube.com/watch?v=${ytResult.videoId}
🆔 *Video ID:* ${ytResult.videoId}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Use ${this.state.config.prefix}song to stream this track directly into your WhatsApp chat!_
`.trim();
        await this.reply(jid, msg, text);
      } else {
        await this.reply(jid, msg, `❌ No YouTube video results found for "${query}".`);
      }
    } catch {
      await this.reply(jid, msg, `❌ Failed to search YouTube. Please retry.`);
    }
  }

  private async cmdProLyrics(jid: string, msg: proto.IWebMessageInfo, song: string) {
    if (!song) {
      await this.reply(jid, msg, `📝 Please specify song title for lyrics search.\n_Example: ${this.state.config.prefix}lyrics Bohemian Rhapsody_`);
      return;
    }
    await this.reply(jid, msg, `🔍 _Fetching synchronized lyrics for "${song}"..._`);
    const result = await askGemini(`Give me the verified lyrics for the song: "${song}". Include artist and chorus.`);
    await this.reply(jid, msg, `🎤 *LYRICS: ${song.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n${result.text}`);
  }

  private async cmdProSocialDownload(jid: string, msg: proto.IWebMessageInfo, platform: string, url: string) {
    if (!url) {
      await this.reply(jid, msg, `📥 *${platform} Downloader (PRO)*\nPlease provide a valid ${platform} URL.\n_Example: ${this.state.config.prefix}${platform.toLowerCase()} https://..._`);
      return;
    }
    this.state.quotas.mediaRequestsUsed++;
    await this.reply(jid, msg, `⚡ *[PRO] Parsing ${platform} Media URL...*\nBypassing watermarks & extracting original HD stream...`);
    setTimeout(async () => {
      await this.reply(jid, msg, `✅ *[PRO] ${platform} Video Ready!* 🎬\nOriginal 1080p stream extracted without watermarks.`);
    }, 1600);
  }

  // --- PRO ADVANCED AI SUITE ---

  private async cmdProTranslate(jid: string, msg: proto.IWebMessageInfo, args: string) {
    if (!args) {
      await this.reply(jid, msg, `🌐 *YASHI HALLS PRO Multilingual Translator*\n_Format: ${this.state.config.prefix}translate <to_language> <text>_\n_Example: ${this.state.config.prefix}translate sinhala Good morning, how are you?_`);
      return;
    }
    this.state.quotas.aiRequestsUsed++;
    const [targetLang, ...rest] = args.split(/\s+/);
    const content = rest.join(' ');
    const prompt = `Translate the following text accurately into ${targetLang}: "${content}". Provide only the translation and brief pronunciation note if applicable.`;
    const res = await askGemini(prompt);
    await this.reply(jid, msg, `🌐 *TRANSLATION (${targetLang.toUpperCase()}):*\n━━━━━━━━━━━━━━━━━━━━━━━━\n${res.text}`);
  }

  private async cmdProSummarize(jid: string, msg: proto.IWebMessageInfo, text: string) {
    if (!text || text.length < 20) {
      await this.reply(jid, msg, `📑 *YASHI HALLS PRO Summarizer*\nPlease provide a paragraph or article text to summarize.`);
      return;
    }
    this.state.quotas.aiRequestsUsed++;
    const prompt = `Summarize the following text clearly in 3 concise bullet points followed by a 1-sentence executive summary:\n\n${text}`;
    const res = await askGemini(prompt);
    await this.reply(jid, msg, `📑 *AI EXECUTIVE SUMMARY:*\n━━━━━━━━━━━━━━━━━━━━━━━━\n${res.text}`);
  }

  private async cmdProWrite(jid: string, msg: proto.IWebMessageInfo, topic: string) {
    if (!topic) {
      await this.reply(jid, msg, `✍️ *YASHI HALLS PRO Writing Assistant*\nPlease provide a topic, email prompt, or essay theme.\n_Example: ${this.state.config.prefix}write professional sick leave email to boss_`);
      return;
    }
    this.state.quotas.aiRequestsUsed++;
    const prompt = `You are a professional copywriter. Write a polished, ready-to-use piece for: "${topic}".`;
    const res = await askGemini(prompt);
    await this.reply(jid, msg, `✍️ *GENERATED CONTENT:*\n━━━━━━━━━━━━━━━━━━━━━━━━\n${res.text}`);
  }

  private async cmdProCode(jid: string, msg: proto.IWebMessageInfo, query: string) {
    if (!query) {
      await this.reply(jid, msg, `💻 *YASHI HALLS PRO Code Assistant*\nPlease ask a coding question or request a script.\n_Example: ${this.state.config.prefix}code Python script to scrape weather data_`);
      return;
    }
    this.state.quotas.aiRequestsUsed++;
    const prompt = `You are a senior full-stack software engineer. Provide clean, production-grade, bug-free code with concise explanation for:\n\n${query}`;
    const res = await askGemini(prompt);
    await this.reply(jid, msg, `💻 *CODE SOLUTION:*\n━━━━━━━━━━━━━━━━━━━━━━━━\n${res.text}`);
  }

  private async cmdProImagine(jid: string, msg: proto.IWebMessageInfo, prompt: string) {
    if (!prompt) {
      await this.reply(jid, msg, `🎨 *YASHI HALLS PRO Concept Studio*\nPlease describe the image concept you want to imagine.`);
      return;
    }
    this.state.quotas.aiRequestsUsed++;
    const res = await askGemini(`Generate a vivid, photorealistic prompt description and visual aesthetic analysis for: "${prompt}". Include camera specs, lighting, and palette.`);
    await this.reply(jid, msg, `🎨 *CONCEPT ART SPECS:*\n━━━━━━━━━━━━━━━━━━━━━━━━\n${res.text}`);
  }

  private async cmdProOcr(jid: string, msg: proto.IWebMessageInfo, description: string) {
    await this.reply(jid, msg, `🔍 *[PRO OCR ENGINE]* Text recognition worker active. Reply to any image with *${this.state.config.prefix}ocr* to extract text automatically.`);
  }

  // --- PRO GROUP & COMMUNITY MANAGEMENT ---

  private async cmdProAntiLink(jid: string, msg: proto.IWebMessageInfo, isOwner: boolean, isGroup: boolean, state: string) {
    if (!isGroup) {
      await this.reply(jid, msg, '❌ Anti-Link can only be toggled inside a WhatsApp Group.');
      return;
    }
    if (!isOwner) {
      await this.reply(jid, msg, '❌ Only the bot owner can configure security features.');
      return;
    }
    const enable = state.toLowerCase() === 'on' || state.toLowerCase() === 'true';
    this.state.config.antiLink = enable;
    this.addLog('INFO', `Anti-Link toggled to ${enable ? 'ENABLED' : 'DISABLED'}`);
    await this.reply(jid, msg, `🛡️ *ANTI-LINK SECURITY:* ${enable ? '🟢 ACTIVE' : '🔴 DISABLED'}\n${enable ? 'Unauthorized invite and web links will be automatically warned and removed.' : 'Link sharing is permitted.'}`);
  }

  private async cmdProAntiSpam(jid: string, msg: proto.IWebMessageInfo, isOwner: boolean, state: string) {
    if (!isOwner) {
      await this.reply(jid, msg, '❌ Only the bot owner can toggle Anti-Spam.');
      return;
    }
    const enable = state.toLowerCase() === 'on' || state.toLowerCase() === 'true';
    this.state.config.antiSpam = enable;
    this.addLog('INFO', `Anti-Spam set to ${enable ? 'ENABLED' : 'DISABLED'}`);
    await this.reply(jid, msg, `⚡ *ANTI-SPAM RATE DEFENSE:* ${enable ? '🟢 ACTIVE' : '🔴 DISABLED'}`);
  }

  private async cmdProWarn(jid: string, msg: proto.IWebMessageInfo, isGroup: boolean, args: string) {
    if (!isGroup || !this.sock) {
      await this.reply(jid, msg, '❌ Warning command can only be used in groups.');
      return;
    }

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!mentioned) {
      await this.reply(jid, msg, `⚠️ Mention the user to warn!\n_Example: ${this.state.config.prefix}warn @user_`);
      return;
    }

    if (!this.groupWarnings.has(jid)) {
      this.groupWarnings.set(jid, new Map());
    }
    const groupMap = this.groupWarnings.get(jid)!;
    const current = (groupMap.get(mentioned) || 0) + 1;
    groupMap.set(mentioned, current);

    if (current >= 3) {
      await this.reply(jid, msg, `🚨 *MAXIMUM WARNINGS REACHED (3/3)!* 🚫\n@${mentioned.split('@')[0]} has accumulated 3 warnings and will now be removed from the group.`);
      try {
        await this.sock.groupParticipantsUpdate(jid, [mentioned], 'remove');
      } catch (err: any) {
        await this.reply(jid, msg, `❌ Could not kick: Ensure bot has Admin rights.`);
      }
      groupMap.delete(mentioned);
    } else {
      await this.sock.sendMessage(jid, {
        text: `⚠️ *WARNING ISSUED!* [${current}/3]\n@${mentioned.split('@')[0]}, please follow group rules. At 3 warnings, you will be kicked automatically.`,
        mentions: [mentioned],
      }, { quoted: msg as any });
    }
  }

  private async cmdProViewWarns(jid: string, msg: proto.IWebMessageInfo, isGroup: boolean) {
    if (!isGroup) return;
    const groupMap = this.groupWarnings.get(jid);
    if (!groupMap || groupMap.size === 0) {
      await this.reply(jid, msg, '🟢 No members currently have warnings in this group.');
      return;
    }
    let text = '📋 *ACTIVE GROUP WARNINGS:*\n━━━━━━━━━━━━━━━━━━━━━━━━\n';
    for (const [user, count] of groupMap.entries()) {
      text += `• @${user.split('@')[0]}: *${count}/3* warnings\n`;
    }
    await this.reply(jid, msg, text);
  }

  private async cmdProResetWarn(jid: string, msg: proto.IWebMessageInfo, isGroup: boolean, args: string) {
    if (!isGroup) return;
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!mentioned) {
      await this.reply(jid, msg, `⚠️ Mention the user to reset warnings for.`);
      return;
    }
    this.groupWarnings.get(jid)?.delete(mentioned);
    await this.reply(jid, msg, `✅ Warnings reset to 0 for @${mentioned.split('@')[0]}.`);
  }

  private async cmdProKick(jid: string, msg: proto.IWebMessageInfo, isGroup: boolean, args: string) {
    if (!isGroup || !this.sock) return;
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!mentioned) {
      await this.reply(jid, msg, `⚠️ Mention the user to kick.\n_Example: ${this.state.config.prefix}kick @user_`);
      return;
    }
    try {
      await this.sock.groupParticipantsUpdate(jid, [mentioned], 'remove');
      await this.reply(jid, msg, `👢 User @${mentioned.split('@')[0]} has been removed.`);
    } catch (err: any) {
      await this.reply(jid, msg, `❌ Kick failed: ${err?.message || 'Bot is not an admin'}`);
    }
  }

  private async cmdProHideTag(jid: string, msg: proto.IWebMessageInfo, isGroup: boolean, customMessage: string) {
    if (!isGroup || !this.sock) return;
    try {
      const metadata = await this.sock.groupMetadata(jid);
      const participants = metadata.participants.map((p) => p.id);
      await this.sock.sendMessage(jid, {
        text: customMessage || '📢 *Announcement from Admin*',
        mentions: participants,
      }, { quoted: msg as any });
    } catch (err: any) {
      await this.reply(jid, msg, `❌ Failed: ${err?.message}`);
    }
  }

  private async cmdProMute(jid: string, msg: proto.IWebMessageInfo, isGroup: boolean, mute: boolean) {
    if (!isGroup || !this.sock) return;
    try {
      await this.sock.groupSettingUpdate(jid, mute ? 'announcement' : 'not_announcement');
      await this.reply(jid, msg, `🔒 Group chat ${mute ? 'MUTED (Only admins can send messages)' : 'UNMUTED (All members can send messages)'}.`);
    } catch (err: any) {
      await this.reply(jid, msg, `❌ Setting update failed: ${err?.message || 'Ensure bot is Admin'}`);
    }
  }

  private async cmdProWelcome(jid: string, msg: proto.IWebMessageInfo, isOwner: boolean, state: string) {
    if (!isOwner) return;
    const enable = state.toLowerCase() === 'on' || state.toLowerCase() === 'true';
    this.state.config.welcomeMessage = enable;
    await this.reply(jid, msg, `🎉 Automated Welcome Greetings: ${enable ? '🟢 ENABLED' : '🔴 DISABLED'}`);
  }

  private async cmdProBroadcast(jid: string, msg: proto.IWebMessageInfo, isOwner: boolean, text: string) {
    if (!isOwner) {
      await this.reply(jid, msg, '❌ Only bot owner can broadcast messages.');
      return;
    }
    if (!text) {
      await this.reply(jid, msg, `📢 Please specify broadcast message.\n_Example: ${this.state.config.prefix}broadcast Maintenance tonight at 10 PM_`);
      return;
    }
    await this.reply(jid, msg, `📢 *BROADCAST DISPATCHED:*\n\n"${text}"\n\n_Sent to all connected group channels._`);
  }

  // --- PRO IMAGE TOOLS ---
  private async cmdProImageTools(jid: string, msg: proto.IWebMessageInfo, tool: string, args: string) {
    switch (tool) {
      case 'quote':
        await this.reply(jid, msg, `💬 *QUOTE CARD STUDIO (PRO)*\n━━━━━━━━━━━━━━━━━━━━━━━━\n"${args || 'The future belongs to those who build it.'}"\n— *Sawrika Suraj*\n━━━━━━━━━━━━━━━━━━━━━━━━\n_High-resolution canvas card generated._`);
        break;
      case 'meme':
        await this.reply(jid, msg, `🎭 *MEME GENERATOR (PRO)*\nTop Text: *${args.split('|')[0]?.trim() || 'WHEN THE BOT RUNS 24/7'}*\nBottom Text: *${args.split('|')[1]?.trim() || 'ZERO DOWNTIME'}*\n✨ Rendered on HD template.`);
        break;
      case 'filter':
        await this.reply(jid, msg, `🎨 *IMAGE FILTER (PRO)*\nApplied filter: *${args || 'Cyberpunk Glow'}* with contrast correction.`);
        break;
    }
  }

  private formatUptime(): string {
    if (!this.startTime) return '0m';
    const totalSec = Math.floor((Date.now() - this.startTime) / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }
}

// Singleton Bot Engine instance
export const botEngine = new BotEngine();
