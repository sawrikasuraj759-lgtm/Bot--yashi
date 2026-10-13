import fs from 'fs';
import path from 'path';
import { seedDefaultVoiceFiles } from './voiceService';

export interface AdminCustomerRecord {
  id: string;
  email: string;
  username: string;
  plan: 'mini' | 'pro' | 'business';
  coins: number;
  isSuspended: boolean;
  botStatus: 'online' | 'offline' | 'none';
  createdAt: string;
  lastActive: string;
  lastHeartbeat?: string;
  isExplicitlyOffline?: boolean;
  adminNote?: string;
  mediaUsed: number;
  aiUsed: number;
  planActivatedAt?: string;
  planExpiresAt?: string;
  avatarUrl?: string;
}

export interface WalletTransactionRecord {
  id: string;
  customerId: string;
  customerEmail?: string;
  customerName?: string;
  adminId?: string;
  type: 'ADD' | 'DEDUCT' | 'PURCHASE' | 'SPENT' | 'REDEEM';
  amount: number;
  previousBalance: number;
  newBalance: number;
  reason: string;
  date: string;
  status: 'COMPLETED';
}

export interface PurchaseRequestRecord {
  id: string;
  referenceId: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  itemType: 'plan' | 'coin_pack';
  itemName: string;
  planId?: 'pro' | 'business';
  coinAmount?: number;
  priceLkr: number;
  priceFormatted: string;
  status: 'PENDING' | 'APPROVED' | 'FULFILLED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  updatedAt?: string;
  adminNote?: string;
  fulfilledBy?: string;
}

export interface AdminAuditRecord {
  id: string;
  timestamp: string;
  adminEmail: string;
  action: string;
  details: string;
  targetId?: string;
}

export interface SystemSettingsRecord {
  storeName: string;
  brandTagline: string;
  adminWhatsapp: string;
  maintenanceMode: boolean;
  allowPublicSignups: boolean;
  planPricesCoins: {
    mini: number;
    pro: number;
    business: number;
  };
  coinPackPricesLkr: {
    basic: number;
    popular: number;
    mega: number;
  };
}

export interface VoiceReplyRecord {
  id: string;
  name: string;
  triggers: string[];
  audioFileName: string;
  audioPath: string;
  audioUrl?: string;
  mimeType: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  durationSeconds?: number;
  language: 'Sinhala' | 'English' | 'Both';
  enabled: boolean;
  scope: 'GLOBAL' | 'CUSTOMER';
  customerId?: string;
  customerEmail?: string;
  createdAt: string;
  updatedAt?: string;
  playCount: number;
  lastPlayedAt?: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.resolve(DATA_DIR, 'admin_system_db.json');

interface SystemDatabase {
  customers: Record<string, AdminCustomerRecord>;
  purchaseRequests: PurchaseRequestRecord[];
  auditLogs: AdminAuditRecord[];
  settings: SystemSettingsRecord;
  voiceReplies: VoiceReplyRecord[];
  walletTransactions: WalletTransactionRecord[];
}

const DEFAULT_SETTINGS: SystemSettingsRecord = {
  storeName: 'YASHI HALLS Cloud Platform',
  brandTagline: 'Professional Cyber Multi-Device WhatsApp Engine',
  adminWhatsapp: '0740712934',
  maintenanceMode: false,
  allowPublicSignups: true,
  planPricesCoins: {
    mini: 0,
    pro: 10,
    business: 30,
  },
  coinPackPricesLkr: {
    basic: 450,
    popular: 1200,
    mega: 2800,
  },
};

const DEFAULT_DB: SystemDatabase = {
  customers: {
    'user-sawrikasuraj': {
      id: 'user-sawrikasuraj',
      email: 'sawrikasuraj759@gmail.com',
      username: 'Sawrika Suraj (Master Admin)',
      plan: 'business',
      coins: 500,
      isSuspended: false,
      botStatus: 'online',
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      lastActive: new Date().toISOString(),
      adminNote: 'Master Administrator & Owner Account',
      mediaUsed: 12,
      aiUsed: 45,
    },
  },
  purchaseRequests: [],
  auditLogs: [
    {
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      adminEmail: 'system',
      action: 'SYSTEM_BOOT',
      details: 'YASHI HALLS Admin Engine & Manual Purchase Management System initialised.',
    },
  ],
  settings: DEFAULT_SETTINGS,
  voiceReplies: [],
  walletTransactions: [],
};

class AdminStore {
  private db: SystemDatabase;

  constructor() {
    this.ensureDataDir();
    this.db = this.loadDatabase();
    this.initDefaultVoiceReplies();
  }

  private ensureDataDir() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch {
      // ignore
    }
  }

  private async initDefaultVoiceReplies() {
    if (!this.db.voiceReplies || this.db.voiceReplies.length === 0) {
      try {
        const seedPaths = await seedDefaultVoiceFiles();
        this.db.voiceReplies = [
          {
            id: 'voice-greeting-hi',
            name: 'Welcome & Greeting Voice (හායි / Hello)',
            triggers: ['hi', 'hello', 'හායි', 'hey', 'hello yashi'],
            audioFileName: 'seed_hi.mp3',
            audioPath: seedPaths.hi,
            audioUrl: '/api/voice-replies/audio/voice-greeting-hi',
            mimeType: 'audio/mpeg',
            fileSizeBytes: 12582,
            fileSizeFormatted: '12.3 KB',
            durationSeconds: 2,
            language: 'Both',
            enabled: true,
            scope: 'GLOBAL',
            createdAt: new Date().toISOString(),
            playCount: 14,
          },
          {
            id: 'voice-morning-greeting',
            name: 'Morning Greeting Voice (සුබ උදෑසනක්)',
            triggers: ['good morning', 'සුබ උදෑසනක්', 'morning', 'gm'],
            audioFileName: 'seed_good_morning.mp3',
            audioPath: seedPaths.morning,
            audioUrl: '/api/voice-replies/audio/voice-morning-greeting',
            mimeType: 'audio/mpeg',
            fileSizeBytes: 15400,
            fileSizeFormatted: '15.0 KB',
            durationSeconds: 2,
            language: 'Both',
            enabled: true,
            scope: 'GLOBAL',
            createdAt: new Date().toISOString(),
            playCount: 8,
          },
          {
            id: 'voice-night-greeting',
            name: 'Good Night Voice (සුබ රාත්‍රියක්)',
            triggers: ['good night', 'සුබ රාත්‍රියක්', 'gn', 'sweet dreams'],
            audioFileName: 'seed_good_night.mp3',
            audioPath: seedPaths.night,
            audioUrl: '/api/voice-replies/audio/voice-night-greeting',
            mimeType: 'audio/mpeg',
            fileSizeBytes: 14200,
            fileSizeFormatted: '13.9 KB',
            durationSeconds: 2,
            language: 'Both',
            enabled: true,
            scope: 'GLOBAL',
            createdAt: new Date().toISOString(),
            playCount: 5,
          },
          {
            id: 'voice-how-are-you',
            name: 'How Are You Voice (කොහොමද / How Are You)',
            triggers: ['how are you', 'කොහොමද', 'how r u', 'සැප සනීප කොහොමද'],
            audioFileName: 'seed_how_are_you.mp3',
            audioPath: seedPaths.howAreYou,
            audioUrl: '/api/voice-replies/audio/voice-how-are-you',
            mimeType: 'audio/mpeg',
            fileSizeBytes: 13800,
            fileSizeFormatted: '13.5 KB',
            durationSeconds: 2,
            language: 'Both',
            enabled: true,
            scope: 'GLOBAL',
            createdAt: new Date().toISOString(),
            playCount: 11,
          },
        ];
        this.saveDatabase(this.db);
      } catch (err) {
        console.error('Failed to seed default voice replies:', err);
      }
    }
  }

  private loadDatabase(): SystemDatabase {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_DB,
          ...parsed,
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
          voiceReplies: Array.isArray(parsed.voiceReplies) ? parsed.voiceReplies : [],
        };
      }
    } catch (e) {
      console.error('Failed to load admin db file, using defaults:', e);
    }
    this.saveDatabase(DEFAULT_DB);
    return DEFAULT_DB;
  }

  private saveDatabase(data: SystemDatabase) {
    try {
      this.ensureDataDir();
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save admin system db:', err);
    }
  }

  public getSettings(): SystemSettingsRecord {
    return { ...this.db.settings };
  }

  public updateSettings(partial: Partial<SystemSettingsRecord>, adminEmail: string): SystemSettingsRecord {
    this.db.settings = { ...this.db.settings, ...partial };
    this.addAuditLog(adminEmail, 'UPDATE_SETTINGS', `Updated system configuration: ${Object.keys(partial).join(', ')}`);
    this.saveDatabase(this.db);
    return this.getSettings();
  }

  public getCustomers(): AdminCustomerRecord[] {
    return Object.values(this.db.customers);
  }

  public getCustomer(idOrEmail: string): AdminCustomerRecord | undefined {
    const key = Object.keys(this.db.customers).find(
      (k) =>
        this.db.customers[k].id.toLowerCase() === idOrEmail.toLowerCase() ||
        this.db.customers[k].email.toLowerCase() === idOrEmail.toLowerCase()
    );
    return key ? this.db.customers[key] : undefined;
  }

  public syncCustomer(
    id: string,
    email: string,
    username: string,
    plan?: 'mini' | 'pro' | 'business',
    coins?: number
  ): AdminCustomerRecord {
    const existing = this.getCustomer(id) || this.getCustomer(email);
    if (existing) {
      existing.email = email;
      existing.username = username || existing.username;
      if (plan) existing.plan = plan;
      if (typeof coins === 'number') existing.coins = coins;
      existing.lastActive = new Date().toISOString();
      this.saveDatabase(this.db);
      return existing;
    }

    const newCust: AdminCustomerRecord = {
      id: id || `cust-${Date.now()}`,
      email,
      username: username || email.split('@')[0],
      plan: plan || 'mini',
      coins: typeof coins === 'number' ? coins : 10,
      isSuspended: false,
      botStatus: 'none',
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      mediaUsed: 0,
      aiUsed: 0,
    };
    this.db.customers[newCust.id] = newCust;
    this.saveDatabase(this.db);
    return newCust;
  }

  public setCustomerSuspended(id: string, suspended: boolean, adminEmail: string): AdminCustomerRecord | null {
    const cust = this.getCustomer(id);
    if (!cust) return null;
    cust.isSuspended = suspended;
    this.addAuditLog(adminEmail, suspended ? 'SUSPEND_CUSTOMER' : 'UNSUSPEND_CUSTOMER', `Customer: ${cust.email}`, cust.id);
    this.saveDatabase(this.db);
    return cust;
  }

  public updateCustomerNote(id: string, note: string, adminEmail: string): AdminCustomerRecord | null {
    const cust = this.getCustomer(id);
    if (!cust) return null;
    cust.adminNote = note;
    this.addAuditLog(adminEmail, 'UPDATE_CUSTOMER_NOTE', `Note updated for ${cust.email}`, cust.id);
    this.saveDatabase(this.db);
    return cust;
  }

  public deleteCustomer(id: string, adminEmail: string): boolean {
    const cust = this.getCustomer(id);
    if (!cust) return false;
    delete this.db.customers[cust.id];
    this.addAuditLog(adminEmail, 'DELETE_CUSTOMER', `Permanently deleted customer: ${cust.email}`, cust.id);
    this.saveDatabase(this.db);
    return true;
  }

  public modifyCoins(
    customerIdOrEmail: string,
    action: 'ADD' | 'DEDUCT',
    amount: number,
    reason: string,
    adminEmail: string
  ): { success: boolean; newBalance?: number; message: string } {
    if (amount <= 0) {
      return { success: false, message: 'Amount must be greater than zero.' };
    }

    const cust = this.getCustomer(customerIdOrEmail);
    if (!cust) {
      return { success: false, message: 'Customer not found.' };
    }

    const prevBalance = cust.coins;
    let newBalance = prevBalance;

    if (action === 'ADD') {
      newBalance = prevBalance + amount;
    } else {
      if (prevBalance < amount) {
        return {
          success: false,
          message: `Cannot deduct ${amount} coins. Customer only has ${prevBalance} coins. Balance cannot be negative.`,
        };
      }
      newBalance = prevBalance - amount;
    }

    cust.coins = newBalance;

    const txId = `tx-admin-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const tx = {
      id: txId,
      customerId: cust.id,
      adminId: adminEmail,
      type: action,
      amount,
      previousBalance: prevBalance,
      newBalance,
      reason: reason || `Manual adjustment by ${adminEmail}`,
      date: new Date().toISOString(),
      status: 'COMPLETED' as const,
    };
    this.db.walletTransactions.unshift(tx);

    this.addAuditLog(
      adminEmail,
      `COIN_${action}`,
      `${action} ${amount} coins for ${cust.email}. Prev: ${prevBalance}, New: ${newBalance}. Reason: ${reason}`,
      cust.id
    );

    this.saveDatabase(this.db);
    return { success: true, newBalance, message: `Successfully ${action === 'ADD' ? 'added' : 'deducted'} ${amount} coins.` };
  }

  public getWalletTransactions(customerId?: string) {
    if (customerId) {
      return this.db.walletTransactions.filter((t) => t.customerId === customerId);
    }
    return this.db.walletTransactions;
  }

  public createPurchaseRequest(
    data: Omit<PurchaseRequestRecord, 'id' | 'referenceId' | 'status' | 'createdAt'>
  ): PurchaseRequestRecord {
    const referenceId = `REQ-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    const newReq: PurchaseRequestRecord = {
      ...data,
      id: `req-${Date.now()}`,
      referenceId,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    this.db.purchaseRequests.unshift(newReq);
    this.saveDatabase(this.db);
    return newReq;
  }

  public getPurchaseRequests(status?: string): PurchaseRequestRecord[] {
    if (status && status !== 'ALL') {
      return this.db.purchaseRequests.filter((r) => r.status === status);
    }
    return this.db.purchaseRequests;
  }

  public fulfillPurchaseRequest(
    requestId: string,
    action: 'APPROVE' | 'REJECT',
    adminEmail: string,
    adminNote?: string
  ): { success: boolean; message: string; request?: PurchaseRequestRecord } {
    const req = this.db.purchaseRequests.find((r) => r.id === requestId || r.referenceId === requestId);
    if (!req) {
      return { success: false, message: 'Purchase request not found.' };
    }

    if (req.status === 'FULFILLED' || req.status === 'APPROVED') {
      return { success: false, message: 'This purchase request has already been approved and fulfilled!' };
    }

    if (action === 'REJECT') {
      req.status = 'REJECTED';
      req.updatedAt = new Date().toISOString();
      req.adminNote = adminNote || 'Rejected by Admin';
      req.fulfilledBy = adminEmail;
      this.addAuditLog(adminEmail, 'REJECT_PURCHASE', `Rejected request ${req.referenceId} for ${req.customerEmail}`);
      this.saveDatabase(this.db);
      return { success: true, message: 'Request rejected.', request: req };
    }

    // APPROVE & FULFILL
    const cust = this.getCustomer(req.customerId) || this.getCustomer(req.customerEmail);
    if (!cust) {
      return { success: false, message: 'Target customer account not found for fulfillment.' };
    }

    if (req.itemType === 'coin_pack' && req.coinAmount) {
      cust.coins += req.coinAmount;
      const tx = {
        id: `tx-fulfill-${Date.now()}`,
        customerId: cust.id,
        adminId: adminEmail,
        type: 'ADD' as const,
        amount: req.coinAmount,
        previousBalance: cust.coins - req.coinAmount,
        newBalance: cust.coins,
        reason: `Purchase fulfilled: ${req.itemName} (Ref: ${req.referenceId})`,
        date: new Date().toISOString(),
        status: 'COMPLETED' as const,
      };
      this.db.walletTransactions.unshift(tx);
    } else if (req.itemType === 'plan' && req.planId) {
      cust.plan = req.planId;
    }

    req.status = 'FULFILLED';
    req.updatedAt = new Date().toISOString();
    req.fulfilledBy = adminEmail;
    req.adminNote = adminNote || `Approved & Fulfilled by ${adminEmail}`;

    this.addAuditLog(
      adminEmail,
      'APPROVE_PURCHASE',
      `Approved and fulfilled ${req.itemName} (Ref: ${req.referenceId}) for ${req.customerEmail}`,
      req.id
    );

    this.saveDatabase(this.db);
    return { success: true, message: `Successfully fulfilled ${req.itemName}!`, request: req };
  }

  public addAuditLog(adminEmail: string, action: string, details: string, targetId?: string) {
    this.db.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      timestamp: new Date().toISOString(),
      adminEmail,
      action,
      details,
      targetId,
    });
    if (this.db.auditLogs.length > 300) {
      this.db.auditLogs.pop();
    }
    this.saveDatabase(this.db);
  }

  public getAuditLogs(): AdminAuditRecord[] {
    return this.db.auditLogs;
  }

  public getOverviewStats() {
    const customers = Object.values(this.db.customers);
    const plans = { mini: 0, pro: 0, business: 0 };
    let totalCoins = 0;
    let activeCust = 0;

    customers.forEach((c) => {
      plans[c.plan] = (plans[c.plan] || 0) + 1;
      totalCoins += c.coins || 0;
      if (!c.isSuspended) activeCust++;
    });

    const requests = this.db.purchaseRequests;
    const pendingPurchases = requests.filter((r) => r.status === 'PENDING').length;
    const completedPurchases = requests.filter((r) => r.status === 'FULFILLED' || r.status === 'APPROVED').length;
    const failedPurchases = requests.filter((r) => r.status === 'REJECTED' || r.status === 'CANCELLED').length;

    return {
      totalCustomers: customers.length,
      activeCustomers: activeCust,
      activeBots: 1, // Baileys engine cluster
      offlineBots: 0,
      planDistribution: plans,
      totalCoinsInCirculation: totalCoins,
      pendingPurchases,
      completedPurchases,
      failedPurchases,
      systemHealth: 'OPERATIONAL 100%',
    };
  }

  // --- VOICE AUTO-REPLY MANAGEMENT ---

  public getVoiceReplies(scope?: string, customerId?: string): VoiceReplyRecord[] {
    let list = this.db.voiceReplies || [];
    if (scope) {
      list = list.filter((v) => v.scope === scope);
    }
    if (customerId) {
      list = list.filter((v) => v.customerId === customerId || v.scope === 'GLOBAL');
    }
    return list;
  }

  public getVoiceReply(id: string): VoiceReplyRecord | undefined {
    return (this.db.voiceReplies || []).find((v) => v.id === id);
  }

  public createVoiceReply(
    data: Omit<VoiceReplyRecord, 'id' | 'createdAt' | 'playCount'>,
    adminEmail: string
  ): VoiceReplyRecord {
    const id = `voice-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const record: VoiceReplyRecord = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
      playCount: 0,
      audioUrl: `/api/voice-replies/audio/${id}`,
    };
    if (!this.db.voiceReplies) this.db.voiceReplies = [];
    this.db.voiceReplies.unshift(record);
    this.addAuditLog(
      adminEmail,
      'CREATE_VOICE_REPLY',
      `Created voice reply '${record.name}' with triggers: ${record.triggers.join(', ')}`,
      record.id
    );
    this.saveDatabase(this.db);
    return record;
  }

  public updateVoiceReply(
    id: string,
    updates: Partial<VoiceReplyRecord>,
    adminEmail: string
  ): VoiceReplyRecord | null {
    const item = this.getVoiceReply(id);
    if (!item) return null;
    Object.assign(item, updates, { updatedAt: new Date().toISOString() });
    this.addAuditLog(adminEmail, 'UPDATE_VOICE_REPLY', `Updated voice reply '${item.name}'`, item.id);
    this.saveDatabase(this.db);
    return item;
  }

  public toggleVoiceReply(id: string, enabled: boolean, adminEmail: string): VoiceReplyRecord | null {
    const item = this.getVoiceReply(id);
    if (!item) return null;
    item.enabled = enabled;
    item.updatedAt = new Date().toISOString();
    this.addAuditLog(
      adminEmail,
      'TOGGLE_VOICE_REPLY',
      `${enabled ? 'Enabled' : 'Disabled'} voice auto-reply '${item.name}'`,
      item.id
    );
    this.saveDatabase(this.db);
    return item;
  }

  public deleteVoiceReply(id: string, adminEmail: string): boolean {
    const idx = (this.db.voiceReplies || []).findIndex((v) => v.id === id);
    if (idx === -1) return false;
    const removed = this.db.voiceReplies.splice(idx, 1)[0];
    this.addAuditLog(adminEmail, 'DELETE_VOICE_REPLY', `Deleted voice reply '${removed.name}'`, id);
    this.saveDatabase(this.db);
    return true;
  }

  public incrementVoiceReplyPlay(id: string): void {
    const item = this.getVoiceReply(id);
    if (item) {
      item.playCount = (item.playCount || 0) + 1;
      item.lastPlayedAt = new Date().toISOString();
      this.saveDatabase(this.db);
    }
  }

  /**
   * Matches incoming text message against registered triggers
   */
  public findMatchingVoiceReply(
    incomingText: string,
    customerId?: string
  ): { match: VoiceReplyRecord | null; matchedTrigger?: string } {
    if (!incomingText || typeof incomingText !== 'string') return { match: null };

    // Clean text: lower-case, remove leading symbols like ! or .
    const cleanText = incomingText.trim().toLowerCase().replace(/^[!./#]+/, '').trim();
    if (!cleanText) return { match: null };

    const replies = this.db.voiceReplies || [];

    // Prioritize customer-specific first, then global
    const sorted = [
      ...replies.filter((v) => v.enabled && v.scope === 'CUSTOMER' && customerId && v.customerId === customerId),
      ...replies.filter((v) => v.enabled && v.scope === 'GLOBAL'),
    ];

    // Phase 1: Check exact match first across all replies (highest precedence)
    const strippedText = cleanText.replace(/[?!.,~*_-]+/g, '').trim();
    for (const reply of sorted) {
      for (const trigger of reply.triggers) {
        const cleanTrigger = trigger.trim().toLowerCase();
        if (!cleanTrigger) continue;
        if (cleanText === cleanTrigger || strippedText === cleanTrigger) {
          return { match: reply, matchedTrigger: trigger };
        }
      }
    }

    // Phase 2: Check phrase boundary match, prioritizing longer triggers
    for (const reply of sorted) {
      const triggersSorted = [...reply.triggers].sort((a, b) => b.length - a.length);
      for (const trigger of triggersSorted) {
        const cleanTrigger = trigger.trim().toLowerCase();
        if (!cleanTrigger || cleanTrigger.length < 3) continue;

        if (
          cleanText.startsWith(`${cleanTrigger} `) ||
          cleanText.endsWith(` ${cleanTrigger}`) ||
          cleanText.includes(` ${cleanTrigger} `)
        ) {
          return { match: reply, matchedTrigger: trigger };
        }
      }
    }

    return { match: null };
  }
}

export const adminStore = new AdminStore();
